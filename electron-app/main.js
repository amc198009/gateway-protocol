/**
 * Gateway Protocol V2 — Electron Main Process
 * ───────────────────────────────────────────────────────────────
 * Replaces the V1 proxy.js entirely. All HTTPS calls to ElevenLabs,
 * OpenAI, and Anthropic happen here in Node-land, eliminating CORS,
 * eliminating the terminal step, and giving us encrypted key storage.
 *
 * IPC contract (matches preload.js exposure as window.gp.*):
 *   elevenlabs-tts({ text, voiceId, model, stability, similarity })  → ArrayBuffer
 *   openai-tts   ({ text, voice, model, speed })                     → ArrayBuffer
 *   mirror       ({ entry })                                         → Anthropic JSON
 *   keys.get(name)  / keys.set(name, value) / keys.clear()           → string | void
 *
 * Keys are pulled from electron-store on each call so the renderer
 * never has to ship them across IPC. The renderer manages key entry
 * UI; main.js owns persistence + transport.
 * ───────────────────────────────────────────────────────────────
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const https = require('https');

// electron-store is ESM-only since v9; pin to v8 CommonJS (see package.json)
const Store = require('electron-store');
const store = new Store({
  name: 'gateway-protocol-keys',
  // electron-store encrypts at rest when encryptionKey is set. The key
  // itself isn't a secret from a determined attacker on the same machine,
  // but it stops casual `cat` of the JSON.
  encryptionKey: 'gateway-protocol-v2-local-only',
});

// ── BrowserWindow ──────────────────────────────────────────────
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#000000',
    title: 'Gateway Protocol',
    titleBarStyle: 'hiddenInset', // macOS: traffic lights over content
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // electron-store needs fs access in preload? we keep it in main only, so we could enable sandbox — but disable for now to keep preload simple
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // External links open in the default browser, not inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── HTTPS helpers ──────────────────────────────────────────────

/**
 * POST JSON to an HTTPS endpoint, resolve with { status, buffer }.
 * Used for TTS (we want raw audio bytes) and Anthropic (we want JSON bytes).
 */
function httpsPost({ hostname, path: urlPath, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path: urlPath, method: 'POST', headers },
      (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () =>
          resolve({ status: res.statusCode, buffer: Buffer.concat(chunks) })
        );
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── IPC: ElevenLabs TTS ────────────────────────────────────────
ipcMain.handle('gp:elevenlabs-tts', async (_evt, opts) => {
  const key = store.get('elevenlabs');
  if (!key) throw new Error('Missing ElevenLabs API key — set it in voice settings');

  const { text, voiceId, model, stability, similarity } = opts;
  const body = JSON.stringify({
    text,
    model_id: model || 'eleven_multilingual_v2',
    voice_settings: {
      stability: stability ?? 0.72,
      similarity_boost: similarity ?? 0.82,
      style: 0,
      use_speaker_boost: true,
    },
  });

  const { status, buffer } = await httpsPost({
    hostname: 'api.elevenlabs.io',
    path: `/v1/text-to-speech/${voiceId}/stream`,
    headers: {
      'xi-api-key': key,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });

  if (status !== 200) {
    throw new Error(`ElevenLabs ${status}: ${buffer.toString().slice(0, 200)}`);
  }
  // Transfer the underlying ArrayBuffer across IPC (structured-clone safe).
  // Slice to the exact view in case Buffer's underlying pool is larger.
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
});

// ── IPC: OpenAI TTS ────────────────────────────────────────────
ipcMain.handle('gp:openai-tts', async (_evt, opts) => {
  const key = store.get('openai');
  if (!key) throw new Error('Missing OpenAI API key — set it in voice settings');

  const { text, voice, model, speed } = opts;
  const body = JSON.stringify({
    model: model || 'tts-1',
    input: text,
    voice: voice || 'nova',
    speed: speed ?? 0.78,
    response_format: 'mp3',
  });

  const { status, buffer } = await httpsPost({
    hostname: 'api.openai.com',
    path: '/v1/audio/speech',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });

  if (status !== 200) {
    throw new Error(`OpenAI ${status}: ${buffer.toString().slice(0, 200)}`);
  }
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
});

// ── IPC: Quantum Mirror (Anthropic) ────────────────────────────
const MIRROR_SYSTEM_PROMPT = `You are the Council of Five — five of the greatest minds ever assembled on consciousness, healing, and human potential: Robert Monroe (Gateway Process pioneer), Dr. Bruce Lipton (Biology of Belief, subconscious reprogramming), Dr. Joe Dispenza (neuroscience of transformation), Nikola Tesla (frequency and resonance), and Carl Jung (depth psychology, shadow work).

A practitioner has just completed a Gateway Protocol journal entry. Read it carefully. Speak as one unified voice — the distilled wisdom of all five — and return a JSON object with exactly these fields:

{
  "stateAssessment": "2-3 sentences identifying the dominant consciousness frequency this person is operating from — not what they said, but what their words reveal about their current vibrational state",
  "shadowObservation": "1-2 sentences on what is unspoken, avoided, or lurking beneath the surface — Jung's perspective",
  "transmission": "3-4 sentences of direct guidance — what this person needs to hear right now, spoken with authority and compassion",
  "wave": "The single most important Gateway Wave for this person to work with next (Wave I through Wave VII) — name and one sentence why",
  "frequency": "The single Solfeggio frequency most aligned with their current need — Hz number and one sentence why",
  "code": "The single activation code most relevant right now (55515, 1111, 528 Hz, 432 Hz, 888, 369, Gateway) — just the code and one sentence why",
  "practice": "One specific practice to do in the next 24 hours — concrete, actionable, 1-2 sentences"
}

Return ONLY valid JSON. No preamble. No markdown fences. No text outside the JSON object.`;

ipcMain.handle('gp:mirror', async (_evt, { entry }) => {
  const key = store.get('anthropic');
  if (!key) throw new Error('Missing Anthropic API key — set it in the Quantum Mirror panel');

  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: cacheableSystem(MIRROR_SYSTEM_PROMPT),
    messages: [{ role: 'user', content: `Here is my journal entry:\n\n${entry}` }],
  });

  const { status, buffer } = await httpsPost({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });

  const text = buffer.toString();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Anthropic ${status}: non-JSON response`); }

  if (status !== 200) {
    const msg = json.error?.message || json.error || `HTTP ${status}`;
    throw new Error(`Anthropic: ${msg}`);
  }
  return json;
});

// ── IPC: Adaptive Session Engine ───────────────────────────────
// The Council reads the last ≤7 journal entries and recommends a wave,
// frequency, breath, and intention for the next session. Different from
// gp:mirror — that responds to ONE entry's state. This one finds patterns
// ACROSS entries (recurring shadow themes, energetic arc, what's been
// over- or under-practiced) and returns actionable guidance.
const PRE_SESSION_SYSTEM_PROMPT = `You are the Council of Five — Monroe, Lipton, Dispenza, Tesla, Jung — preparing a practitioner for their next Gateway Protocol session.

You are given their last journal entries in chronological order (oldest first, most recent last). Read for patterns ACROSS entries, not just the most recent one:
- What state are they cycling through?
- What shadow theme keeps resurfacing?
- What have they been over-practicing or avoiding?
- What is the next true edge — the practice that would meet them where they actually are, not where they want to be?

Then return a JSON object with EXACTLY these fields:

{
  "recommendedWave": <integer 1-7>,         // Gateway Wave: I=Discovery/Focus10, II=Threshold/Focus12, III=Freedom/Focus15, IV=Colleagues, V=Stations, VI=Patterns, VII=23-27
  "recommendedFreq": <integer Hz>,           // ONE of: 174, 285, 396, 417, 432, 528, 639, 741, 852, 963
  "recommendedBreath": <string>,             // ONE of: "Coherence 5-5", "Gateway 5-5-5", "Box 4-4-4-4", "Dispenza 4-0-8", "Tesla 3-6-9", "Pranayama 4-7-8"
  "intention": <string>,                      // 1 sentence in second person. The seed for this session. Speak directly to them.
  "rationale": <string>                       // 2-3 sentences. Why THIS wave + freq + breath for THIS person right now, based on the pattern you read across their entries.
}

Return ONLY valid JSON. No preamble. No markdown fences. No text outside the JSON object.`;

ipcMain.handle('gp:pre-session', async (_evt, { entries }) => {
  const key = store.get('anthropic');
  if (!key) throw new Error('Missing Anthropic API key — set it in the Quantum Mirror panel');
  if (!Array.isArray(entries) || entries.length < 2) {
    throw new Error('Need at least 2 journal entries for the Council to read patterns');
  }

  // Format entries as a chronological dossier the Council can scan
  const dossier = entries.map((e, i) => {
    const num = i + 1;
    const when = e.date || 'unknown date';
    const ctx = e.session ? ` (during ${e.session})` : '';
    const body = (e.data || []).map(d => `  ${d.prompt}: ${d.response}`).join('\n');
    return `─── Entry ${num} · ${when}${ctx} ───\n${body}`;
  }).join('\n\n');

  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: cacheableSystem(PRE_SESSION_SYSTEM_PROMPT),
    messages: [{ role: 'user', content: `Here are my last ${entries.length} journal entries:\n\n${dossier}` }],
  });

  const { status, buffer } = await httpsPost({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });

  const text = buffer.toString();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Anthropic ${status}: non-JSON response`); }

  if (status !== 200) {
    const msg = json.error?.message || json.error || `HTTP ${status}`;
    throw new Error(`Anthropic: ${msg}`);
  }

  // Parse the JSON the model returned (its `content[0].text`)
  const raw = json.content?.[0]?.text || '';
  let recommendation;
  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    recommendation = JSON.parse(clean);
  } catch {
    throw new Error('Council response could not be parsed as JSON');
  }
  return recommendation;
});

// ── Shared Anthropic call helpers ──────────────────────────────
// V5a: All Council system prompts are static across a session — we wrap
// each one as a cacheable content block via `cache_control: ephemeral`.
// The 5-minute TTL covers a typical practice session, giving us ~90%
// cost reduction and ~50% latency reduction on every call after the
// first one in any 5-minute window.
function cacheableSystem(text) {
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}

// Wraps the boilerplate: get key, build envelope, POST, parse inner JSON.
// Returns the parsed JSON the model produced in content[0].text, or throws.
async function anthropicJSONCall({ systemPrompt, userContent, maxTokens=1024 }) {
  const key = store.get('anthropic');
  if (!key) throw new Error('Missing Anthropic API key — set it in the Quantum Mirror panel');

  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    system: cacheableSystem(systemPrompt),
    messages: [{ role: 'user', content: userContent }],
  });

  const { status, buffer } = await httpsPost({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });

  const text = buffer.toString();
  let env;
  try { env = JSON.parse(text); }
  catch { throw new Error(`Anthropic ${status}: non-JSON response`); }
  if (status !== 200) {
    const msg = env.error?.message || env.error || `HTTP ${status}`;
    throw new Error(`Anthropic: ${msg}`);
  }

  const raw = env.content?.[0]?.text || '';
  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    throw new Error('Council response could not be parsed as JSON');
  }
}

// Variant for non-JSON responses (multi-turn shadow dialogue returns free text)
async function anthropicTextCall({ systemPrompt, messages, maxTokens=1024 }) {
  const key = store.get('anthropic');
  if (!key) throw new Error('Missing Anthropic API key — set it in the Quantum Mirror panel');

  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    system: cacheableSystem(systemPrompt),
    messages,
  });

  const { status, buffer } = await httpsPost({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });

  const text = buffer.toString();
  let env;
  try { env = JSON.parse(text); }
  catch { throw new Error(`Anthropic ${status}: non-JSON response`); }
  if (status !== 200) {
    const msg = env.error?.message || env.error || `HTTP ${status}`;
    throw new Error(`Anthropic: ${msg}`);
  }
  return env.content?.[0]?.text || '';
}

// ── IPC: V4a · Monthly Pattern Recognition ─────────────────────
const MONTHLY_PATTERNS_PROMPT = `You are the Council of Five — Monroe, Lipton, Dispenza, Tesla, Jung — performing a deep month-scale pattern reading.

You are given a practitioner's journal entries from the last 30 days. Read for:
- Recurring shadow themes (what keeps coming up that they haven't integrated)
- Breakthroughs (real shifts in state, not just hopes)
- Energetic arc (where did they start, where are they now, where is the trajectory pointing)
- What is being avoided or under-practiced

Return JSON with EXACTLY these fields:

{
  "themes": [<string>, ...],              // 3-5 recurring themes, each one short phrase
  "breakthroughs": [<string>, ...],        // 0-3 genuine shifts you can see in the entries
  "shadows": [<string>, ...],              // 1-3 unintegrated patterns asking for attention
  "coherenceArc": <string>,                // 2-3 sentences on the trajectory month-over-month
  "suggestion": <string>                   // 1-2 sentences: the single most important next move
}

Return ONLY valid JSON. No preamble. No markdown fences.`;

ipcMain.handle('gp:monthly-patterns', async (_evt, { entries }) => {
  if (!Array.isArray(entries) || entries.length < 3) {
    throw new Error('Need at least 3 journal entries for monthly pattern analysis');
  }
  const dossier = entries.map((e, i) => {
    const when = e.date || 'unknown';
    const lines = (e.data || []).map(d => `  ${d.prompt}: ${d.response}`).join('\n');
    return `─── Entry ${i+1} · ${when} ───\n${lines}`;
  }).join('\n\n');
  return await anthropicJSONCall({
    systemPrompt: MONTHLY_PATTERNS_PROMPT,
    userContent: `Practitioner's last ${entries.length} entries:\n\n${dossier}`,
    maxTokens: 1500,
  });
});

// ── IPC: V4b · Custom Affirmation Generator ────────────────────
const AFFIRMATION_PROMPT = `You are the Council of Five writing a custom activation affirmation for a Gateway practitioner.

The practitioner has given you an intention (what they want) and chosen an activation code (the energetic frequency: 55515, 1111, 528 Hz, 432 Hz, 888, 369, Focus 15, Shadow, Gateway). Write a single affirmation that:
- Is spoken in first person, present tense ("I am" / "I have" — not "I will")
- Embodies the energetic signature of the chosen code
- Speaks to their specific intention
- Is 1-3 sentences, no longer
- Is precise, not vague spiritual platitude
- Has rhythmic, almost incantatory quality when spoken aloud

Return JSON:
{
  "affirmation": <the affirmation text>,
  "intent": <one short phrase summarizing what it activates, e.g. "Wealth · Freedom · Life Upgrade">
}

Return ONLY valid JSON. No markdown fences.`;

ipcMain.handle('gp:generate-affirmation', async (_evt, { intention, code }) => {
  if (!intention || !code) throw new Error('Intention and code are required');
  return await anthropicJSONCall({
    systemPrompt: AFFIRMATION_PROMPT,
    userContent: `Intention: ${intention}\nActivation code: ${code}\n\nWrite the affirmation.`,
    maxTokens: 512,
  });
});

// ── IPC: V4c · Shadow Work Dialogue (multi-turn) ───────────────
const SHADOW_DIALOGUE_PROMPT = `You are Carl Jung speaking through the Council of Five, holding a shadow work dialogue with a practitioner.

Your method:
- Open with one short, direct question that goes immediately beneath the surface of whatever they've brought.
- Each turn, ask ONE question. Never two. Never a paragraph of teaching.
- The question should reveal the next layer they haven't seen yet — not what they want to talk about, but what they're avoiding.
- Use their own words and images back to them. Notice what they emphasize, what they minimize, what they joke about.
- Track for resistance: if they deflect, name the deflection gently and re-ask.
- After roughly 6-8 exchanges, when a genuine integration moment arrives (recognition, grief, embodied yes), name what you've seen and offer a single practice to anchor it.

Format every reply as JSON:
{
  "reply": <your message, 1-3 sentences max, ending in either a question or — at integration — a closing practice>,
  "isComplete": <true only when you've named the integration and offered a closing practice; otherwise false>
}

Return ONLY valid JSON. No markdown fences.`;

ipcMain.handle('gp:shadow-dialogue', async (_evt, { history, message }) => {
  // history: array of {role:'user'|'assistant', content:string} representing past turns
  const messages = Array.isArray(history) ? history.slice() : [];
  messages.push({ role: 'user', content: message || '(beginning)' });
  const raw = await anthropicTextCall({
    systemPrompt: SHADOW_DIALOGUE_PROMPT,
    messages,
    maxTokens: 512,
  });
  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    // If parsing fails, return the raw text as the reply
    return { reply: raw.trim() || 'Tell me more.', isComplete: false };
  }
});

// ── IPC: V4d · Synchronicity Pattern Analysis ──────────────────
const SYNCHRONICITY_PROMPT = `You are the Council of Five analyzing a practitioner's synchronicity log.

Synchronicities are meaningful coincidences — number sequences (11:11, 333, 444), repeated symbols, dream/waking echoes, "right person/right time" events. They are the visible edge of the field reorganizing around the practitioner.

Read the log for:
- Recurring symbols or numbers
- Time-of-day clustering (do most syncs happen morning/afternoon/evening/night?)
- Themes the syncs are pointing to
- What the field is trying to tell them

Return JSON:
{
  "recurringSymbols": [<string>, ...],     // 0-5 symbols/numbers appearing more than once
  "timeClusters": <string>,                // 1 sentence on when they tend to happen
  "themes": [<string>, ...],               // 1-4 themes the syncs collectively point to
  "fieldMessage": <string>                  // 2-3 sentences: what the field is showing them
}

Return ONLY valid JSON. No markdown fences.`;

ipcMain.handle('gp:analyze-synchronicities', async (_evt, { syncs }) => {
  if (!Array.isArray(syncs) || syncs.length < 3) {
    throw new Error('Need at least 3 synchronicity entries for pattern analysis');
  }
  const log = syncs.map((s, i) => {
    const when = s.date || 'unknown';
    return `${i+1}. [${when}] ${s.text}`;
  }).join('\n');
  return await anthropicJSONCall({
    systemPrompt: SYNCHRONICITY_PROMPT,
    userContent: `Practitioner's synchronicity log (${syncs.length} entries):\n\n${log}`,
    maxTokens: 1024,
  });
});

// ── IPC: V4f · Practice Reminders (Electron native notifications) ──
const { Notification } = require('electron');
const REMINDER_KEY = 'reminders';
let reminderTimers = [];

function clearReminderTimers() {
  reminderTimers.forEach(t => clearTimeout(t));
  reminderTimers = [];
}

// Schedule the next firing of each enabled time-of-day reminder. Re-runs
// itself daily because setTimeout can't reliably span >24h.
function scheduleReminders() {
  clearReminderTimers();
  const cfg = store.get(REMINDER_KEY) || { enabled: false };
  if (!cfg.enabled) return;
  const times = cfg.times || { morning: '07:30', midday: '13:00', evening: '21:00' };
  const titles = {
    morning: 'Morning Activation',
    midday: 'Midday Reset',
    evening: 'Evening Integration',
  };
  const bodies = {
    morning: 'Set the field. Choose the state. The Council is here.',
    midday: 'Three deep breaths. One conscious return to center.',
    evening: 'Anchor today. Journal one shift before you sleep.',
  };
  const now = new Date();
  for (const key of Object.keys(times)) {
    const [h, m] = (times[key] || '07:30').split(':').map(Number);
    const next = new Date();
    next.setHours(h, m || 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next - now;
    const timer = setTimeout(() => {
      try {
        new Notification({ title: '◈ ' + titles[key], body: bodies[key] }).show();
      } catch (e) { console.warn('Notification failed:', e); }
      // Re-schedule the day after
      scheduleReminders();
    }, delay);
    reminderTimers.push(timer);
  }
}

ipcMain.handle('gp:reminders-get', () => store.get(REMINDER_KEY) || { enabled: false, times: { morning:'07:30', midday:'13:00', evening:'21:00' } });
ipcMain.handle('gp:reminders-set', (_evt, cfg) => {
  store.set(REMINDER_KEY, cfg || { enabled: false });
  scheduleReminders();
  return true;
});

// Schedule on app ready (after createWindow)
app.whenReady().then(scheduleReminders);

// ── IPC: V7 · Network config (server URL for Practice Rooms + Feed) ──
const NETWORK_KEY = 'network';
ipcMain.handle('gp:network-get', () => store.get(NETWORK_KEY) || { serverUrl: '', autoJoinFeed: false });
ipcMain.handle('gp:network-set', (_evt, cfg) => {
  store.set(NETWORK_KEY, cfg || { serverUrl: '', autoJoinFeed: false });
  return true;
});

// ── IPC: V7c · OpenAI embeddings (for semantic journal memory) ───────
ipcMain.handle('gp:embed', async (_evt, { text }) => {
  const key = store.get('openai');
  if (!key) throw new Error('Missing OpenAI API key — needed for semantic journal memory');
  if (!text || !text.trim()) throw new Error('text required');

  const body = JSON.stringify({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000), // model max ~8191 tokens; this is a safe cap
  });
  const { status, buffer } = await httpsPost({
    hostname: 'api.openai.com',
    path: '/v1/embeddings',
    headers: {
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });
  const env = JSON.parse(buffer.toString());
  if (status !== 200) throw new Error('OpenAI embeddings: ' + (env.error?.message || status));
  return { vector: env.data[0].embedding, model: env.model, dim: env.data[0].embedding.length };
});

// ── IPC: V7c · Mirror with retrieved context (semantic memory enabled) ─
// Variant of gp:mirror that takes pre-retrieved past entries and weaves
// them into the user content so the Council can reference long-term history.
ipcMain.handle('gp:mirror-with-context', async (_evt, { entry, pastEntries }) => {
  const key = store.get('anthropic');
  if (!key) throw new Error('Missing Anthropic API key');

  let userContent = '';
  if (Array.isArray(pastEntries) && pastEntries.length) {
    userContent += 'BACKGROUND — semantically-relevant past entries from this practitioner:\n\n';
    pastEntries.forEach((p, i) => {
      userContent += `[${i+1}] ${p.date}${p.session ? ' · ' + p.session : ''}\n`;
      (p.data || []).forEach(d => { userContent += `   ${d.prompt}: ${d.response}\n`; });
      userContent += '\n';
    });
    userContent += '── Reference these only if genuinely relevant. The practitioner does not need to be told about every entry — only weave them in when they reveal a pattern. ──\n\n';
  }
  userContent += `Here is my current journal entry:\n\n${entry}`;

  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: cacheableSystem(MIRROR_SYSTEM_PROMPT),
    messages: [{ role: 'user', content: userContent }],
  });
  const { status, buffer } = await httpsPost({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });
  const env = JSON.parse(buffer.toString());
  if (status !== 200) throw new Error('Anthropic: ' + (env.error?.message || status));
  return env;
});

// ── IPC: Key storage ───────────────────────────────────────────
const ALLOWED_KEYS = new Set(['elevenlabs', 'openai', 'anthropic']);

ipcMain.handle('gp:key-get', (_evt, name) => {
  if (!ALLOWED_KEYS.has(name)) throw new Error('Unknown key: ' + name);
  return store.get(name) || '';
});

ipcMain.handle('gp:key-set', (_evt, name, value) => {
  if (!ALLOWED_KEYS.has(name)) throw new Error('Unknown key: ' + name);
  if (typeof value !== 'string') throw new Error('Key value must be a string');
  if (value) store.set(name, value);
  else store.delete(name);
});

ipcMain.handle('gp:key-has', (_evt, name) => {
  if (!ALLOWED_KEYS.has(name)) throw new Error('Unknown key: ' + name);
  return !!store.get(name);
});
