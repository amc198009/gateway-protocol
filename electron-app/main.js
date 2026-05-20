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
    system: MIRROR_SYSTEM_PROMPT,
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
