// ═══════════════════════ V2 ELECTRON BRIDGE + WEB BYOK ═══════════════════════
// Three runtime modes, feature-detected:
//   • Electron desktop — window.gp.* IPC → main.js holds encrypted keys and
//     calls the providers. Renderer is loaded over file://.
//   • Hosted web (PWA) — served over http(s) from the Fly server. There is no
//     window.gp and no localhost proxy, and we can't ship a server key to the
//     browser, so the BROWSER holds the *user's own* provider key
//     (localStorage) and sends it per request as X-BYOK-Key to the same-origin
//     /byok/* passthrough; the server forwards to the provider and never
//     stores the key. Contract: server/MOBILE.md §"The /byok/* passthrough".
//   • Bare file:// without Electron — no transport; calls throw a clear error.
const GP_ELECTRON = (typeof window !== 'undefined') && !!window.gp;

// ── Web BYOK transport (non-Electron) ───────────────────────────────────────
// Unlike the old V1 proxy (which built provider request bodies server-side),
// the /byok/* routes are stateless provider passthroughs — so the web client
// builds the full Anthropic / OpenAI bodies itself, exactly as main.js does in
// Electron. Same model, same prompts, same shapes → identical transmissions.
const COUNCIL_MODEL = 'claude-sonnet-4-20250514';
const cacheableSystem = (text) => [{ type:'text', text, cache_control:{ type:'ephemeral' } }];
// Lenient Council-JSON parse: strip ```fences, else grab the first {...} block
// (handles the model adding preamble despite the prompt). Mirrors main.js.
const tryParseCouncil = (raw) => {
  if(!raw) return null;
  try{ return JSON.parse(String(raw).replace(/```json|```/g,'').trim()); }catch(e){}
  const m=String(raw).match(/\{[\s\S]*\}/);
  if(m){ try{ return JSON.parse(m[0]); }catch(e){} }
  return null;
};
const BYOK = {
  // Same-origin only — the server serves the renderer at /app, so /byok/* is a
  // sibling path. Empty when opened as bare file:// (no Electron) → callers throw.
  origin(){ return (typeof location!=='undefined' && /^https?:$/.test(location.protocol)) ? location.origin : ''; },
  // The user's own keys live in the same localStorage slots the V1 browser
  // build already used; QM / VOICE mirror them into memory once initialized.
  anthropicKey(){
    if(typeof QM!=='undefined' && QM._key) return QM._key;
    try{ return localStorage.getItem('gp_anthropic_key')||''; }catch(e){ return ''; }
  },
  openaiKey(){
    if(typeof VOICE!=='undefined' && VOICE.oaiKey) return VOICE.oaiKey;
    try{ return JSON.parse(localStorage.getItem('gp_voice')||'{}').oaiKey||''; }catch(e){ return ''; }
  },
  async _fetch(route, provider, body, audio){
    const origin=this.origin();
    if(!origin) throw new Error('Web mode requires the hosted app — open it over http(s), not as a file.');
    const key = provider==='anthropic' ? this.anthropicKey() : this.openaiKey();
    if(!key) throw new Error('Missing '+(provider==='anthropic'?'Anthropic':'OpenAI')+' API key — add it in settings.');
    const res = await fetch(origin+route,{
      method:'POST',
      // X-Gateway-Client forces a CORS preflight (CSRF parity); X-BYOK-Key
      // carries the user's own provider key, used once and never stored.
      headers:{ 'Content-Type':'application/json', 'X-Gateway-Client':'1', 'X-BYOK-Key':key },
      body:JSON.stringify(body),
    });
    if(audio){
      if(!res.ok){
        let m=''; try{ const j=await res.json(); m=j.error?.message||j.error||''; }catch(e){}
        throw new Error('Server '+res.status+(m?': '+m:''));
      }
      return await res.blob();
    }
    const data=await res.json().catch(()=>({error:'non-JSON response from server'}));
    if(!res.ok || data.error) throw new Error(data.error?.message||data.error||('Server '+res.status));
    return data; // raw Anthropic / OpenAI envelope
  },
  // Single-turn Anthropic Messages call → raw envelope {content:[{text}]}.
  anthropic(systemPrompt, content, maxTokens){
    return this._fetch('/byok/anthropic/messages','anthropic',{
      model:COUNCIL_MODEL, max_tokens:maxTokens||1024,
      system:cacheableSystem(systemPrompt),
      messages:[{ role:'user', content }],
    },false);
  },
  // Multi-turn (shadow dialogue) → raw envelope; caller parses.
  anthropicMessages(systemPrompt, messages, maxTokens){
    return this._fetch('/byok/anthropic/messages','anthropic',{
      model:COUNCIL_MODEL, max_tokens:maxTokens||1024,
      system:cacheableSystem(systemPrompt),
      messages,
    },false);
  },
  // Council call expecting structured JSON → parsed inner object, with one
  // JSON-only retry (parity with main.js anthropicJSONCall; the system prompt
  // is unchanged so the retry stays prompt-cache-warm).
  async councilJSON(systemPrompt, content, maxTokens){
    const env1=await this.anthropic(systemPrompt, content, maxTokens);
    const first=tryParseCouncil(env1.content?.[0]?.text||'');
    if(first) return first;
    const env2=await this.anthropic(systemPrompt, content+'\n\n[System reminder: return ONLY valid JSON. No markdown fences. No commentary.]', maxTokens);
    const second=tryParseCouncil(env2.content?.[0]?.text||'');
    if(second) return second;
    throw new Error('Council returned unstructured text.');
  },
};

const gpNum = (v) => Number(v);
const gpSetText = (id, text) => {
  const el=document.getElementById(id);
  if(el) el.textContent=text;
};
const GP_ACTIONS = {
  'cinematic-exit': () => CINEMATIC.exit(),
  'focus-toggle': () => FOCUS.toggle(),
  'orbital-close': () => ORBITAL.close(),
  'arrival-skip': () => ARRIVAL.skip(),
  'arrival-complete': () => ARRIVAL.complete(),
  show: (el) => show(el.dataset.arg, el),
  'show-screen': (el, e) => { e.preventDefault(); showScreen(el.dataset.arg); },
  'mood-save': () => MOOD.save(),
  'apply-preset': (el) => applyPreset(el.dataset.arg),
  'setup-goal': (el) => SETUP.pickGoal(el.dataset.arg),
  'setup-next': () => SETUP.next(),
  'setup-finish': () => SETUP.finish(),
  'voice-affect-start': () => VOICE_AFFECT.start(),
  'voice-affect-consent': () => { VOICE_AFFECT.grantConsent(); VOICE_AFFECT.start(); },
  'voice-affect-confirm': () => VOICE_AFFECT.confirm(),
  'voice-affect-discard': () => VOICE_AFFECT.discard(),
  'camera-affect-start': () => CAMERA_AFFECT.start(),
  'camera-affect-consent': () => { CAMERA_AFFECT.grantConsent(); CAMERA_AFFECT.start(); },
  'camera-affect-confirm': () => CAMERA_AFFECT.confirm(),
  'camera-affect-discard': () => CAMERA_AFFECT.discard(),
  'palette-open': () => PALETTE.open(),
  'import-data': () => IMPORT.trigger(),
  'import-data-file': (el) => IMPORT.handle(el),
  'delete-affect': () => DELETE_AFFECT.run(),
  'tip-toggle': (el) => {
    const t = document.getElementById(el.getAttribute('aria-controls'));
    if(!t) return;
    const opening = t.hasAttribute('hidden');
    if(opening){ t.removeAttribute('hidden'); el.setAttribute('aria-expanded','true'); }
    else { t.setAttribute('hidden',''); el.setAttribute('aria-expanded','false'); }
  },
  'open-pairing-link': (el, e) => openPairingLink(e, el),
  'ambient-noise': (el) => AMBIENT.setNoise(+el.value),
  'ambient-solfeggio': (el) => AMBIENT.setSolfeggio(+el.value),
  'ambient-binaural': (el) => AMBIENT.setBinaural(+el.value),
  'ambient-preview': () => AMBIENT.preview(),
  'ambient-stop': () => AMBIENT.stop(),
  'toggle-timer': () => toggleTimer(),
  'reset-timer': () => resetTimer(),
  'voice-toggle': () => VOICE.toggle(),
  'toggle-breath': () => toggleBreath(),
  'stop-breath': () => stopBreath(),
  'protobuild-add-phase': () => PROTOBUILD.addPhase(),
  'protobuild-save': () => PROTOBUILD.save(),
  'protobuild-import-file': () => PROTOBUILD.importFile(),
  'protobuild-handle-import': (el) => PROTOBUILD.handleImport(el),
  'protobuild-run': (el) => PROTOBUILD.run(gpNum(el.dataset.id)),
  'protobuild-export-one': (el) => PROTOBUILD.exportOne(gpNum(el.dataset.id)),
  'protobuild-remove': (el) => PROTOBUILD.remove(gpNum(el.dataset.id)),
  'prev-affirm': () => prevAffirm(),
  'next-affirm': () => nextAffirm(),
  'affirm-generate': () => AFFIRM_GEN.generate(),
  'affirm-save': () => AFFIRM_GEN.save(),
  'save-journal': () => saveJournal(),
  'invoke-quantum-mirror': () => invokeQuantumMirror(),
  'network-save-share-consent': () => NETWORK.saveShareConsent(),
  'keys-set': (el) => KEYS.set(el.dataset.arg, el.value, el),
  'qm-toggle-speak': () => QM.toggleSpeak(),
  'qm-stop-speak': () => QM.stopSpeak(),
  'mirror-dismiss': () => { document.getElementById('mirror-output').style.display='none'; },
  'patterns-analyze': () => PATTERNS.analyze(),
  'tt-save-desire': (el) => TT.saveDesire(el.value),
  'tt-mark-slot': (el) => TT.markSlot(gpNum(el.dataset.day), el.dataset.slot),
  'mark-day': () => markDay(),
  'toggle-day': (el) => toggleDay(gpNum(el.dataset.id)),
  'sync-add': () => SYNC.add(),
  'sync-analyze': () => SYNC.analyze(),
  'sync-remove': (el, e) => { e.preventDefault(); SYNC.remove(gpNum(el.dataset.id)); },
  'network-join-room': () => NETWORK.joinRoom(),
  'network-generate-code': () => NETWORK.generateCode(),
  'network-leave-room': () => NETWORK.leaveRoom(),
  'network-load-feed': () => NETWORK.loadFeed(),
  'network-load-feed-change': () => NETWORK.loadFeed(),
  'network-save-config-blur': () => NETWORK.saveConfig(),
  'network-save-config-change': () => NETWORK.saveConfig(),
  'network-use-hosted': () => NETWORK.useHosted(),
  'network-use-local': () => NETWORK.useLocal(),
  'network-clear-server': () => NETWORK.clearServer(),
  'visuals-set-quality': (el) => VISUALS.setQuality(el.dataset.arg),
  'visuals-set-motion': (el) => VISUALS.setMotion(el.dataset.arg),
  'visuals-set-readable': (el) => VISUALS.setReadable(el.dataset.arg),
  'reminders-save': () => REMINDERS.save(),
  'bio-add': () => BIO.add(),
  'export-download': () => EXPORT.download(),
  'confirm-reset': () => confirmReset(),
  'shadow-open': () => SHADOW.open(),
  'shadow-close': () => SHADOW.close(),
  'shadow-send': () => SHADOW.send(),
  'toggle-wave': (el) => toggleWave(gpNum(el.dataset.id), el.dataset.unlocked==='true'),
  'start-wave': (el) => startWave(gpNum(el.dataset.id)),
  'toggle-solf': (el) => toggleSolf(gpNum(el.dataset.id), gpNum(el.dataset.hz)),
  'select-session-index': (el) => selectSessionByIndex(gpNum(el.dataset.id)),
  'voice-set-engine': (el) => VOICE._setEngine(el.dataset.arg),
  'voice-ws-rate': (el) => { VOICE.wsRate=+el.value; gpSetText('ws-rate-val', el.value); },
  'voice-ws-pitch': (el) => { VOICE.wsPitch=+el.value; gpSetText('ws-pitch-val', el.value); },
  'voice-el-stability': (el) => { VOICE.elStability=+el.value; gpSetText('el-stab-val', el.value); },
  'voice-el-similarity': (el) => { VOICE.elSimilarity=+el.value; gpSetText('el-sim-val', el.value); },
  'voice-oai-speed': (el) => { VOICE.oaiSpeed=+el.value; gpSetText('oai-speed-val', el.value); },
  'voice-test-speak': () => VOICE._testSpeak(),
  'voice-stop': () => VOICE.stop(),
  'set-breath': (el) => setBreath(gpNum(el.dataset.id)),
  'institute-issue': (el) => INSTITUTE.issue(el.dataset.id),
};
const GP_EVENT_ACTIONS = {
  click: new Set([
    'cinematic-exit','focus-toggle','orbital-close','arrival-skip','arrival-complete','show','show-screen',
    'open-pairing-link','ambient-preview','ambient-stop','toggle-timer','reset-timer','voice-toggle',
    'toggle-breath','stop-breath','protobuild-add-phase','protobuild-save','protobuild-import-file',
    'protobuild-run','protobuild-export-one','protobuild-remove','prev-affirm','next-affirm','affirm-generate',
    'affirm-save','save-journal','invoke-quantum-mirror','qm-toggle-speak','qm-stop-speak','mirror-dismiss',
    'patterns-analyze','mark-day','toggle-day','sync-add','sync-analyze','sync-remove','network-join-room',
    'network-generate-code','network-leave-room','network-load-feed','network-use-hosted','network-use-local',
    'network-clear-server','visuals-set-quality','visuals-set-motion','visuals-set-readable','bio-add',
    'export-download','confirm-reset','shadow-open','shadow-close','shadow-send','toggle-wave','start-wave',
    'toggle-solf','select-session-index','voice-set-engine','voice-test-speak','voice-stop','set-breath',
    'tt-mark-slot','institute-issue','mood-save','apply-preset',
    'setup-goal','setup-next','setup-finish',
    'voice-affect-start','voice-affect-consent','voice-affect-confirm','voice-affect-discard',
    'camera-affect-start','camera-affect-consent','camera-affect-confirm','camera-affect-discard',
    'palette-open','import-data','delete-affect','tip-toggle'
  ]),
  input: new Set([
    'ambient-noise','ambient-solfeggio','ambient-binaural','keys-set','tt-save-desire','voice-ws-rate',
    'voice-ws-pitch','voice-el-stability','voice-el-similarity','voice-oai-speed'
  ]),
  change: new Set([
    'protobuild-handle-import','network-save-share-consent','network-load-feed-change','reminders-save',
    'network-save-config-change','import-data-file'
  ]),
  keydown: new Set([]),
  blur: new Set(['network-save-config-blur']),
  error: new Set([])
};
function gpDispatch(e){
  const el=e.target && e.target.closest ? e.target.closest('[data-act]') : e.target;
  if(!el) return;
  const act=el.dataset.act;
  if(!act || !GP_EVENT_ACTIONS[e.type]?.has(act)) return;
  if(el.dataset.stop==='true') e.stopPropagation();
  const href=el.getAttribute && el.getAttribute('href');
  if(el.dataset.prevent==='true' || (e.type==='click' && href==='#')) e.preventDefault();
  GP_ACTIONS[act](el,e);
}
['click','input','change','keydown','blur'].forEach(type=>document.addEventListener(type,gpDispatch));
document.addEventListener('error',gpDispatch,true);

// Keyboard activation for non-native clickable controls — the cards we render
// as <div role="button" tabindex="0" data-act="…">. Native button/a/input
// already handle Enter/Space, so we skip them. Enter or Space fires the same
// click action and we preventDefault so Space doesn't scroll the page.
function gpKeyActivate(e){
  if(e.key!=='Enter' && e.key!==' ' && e.key!=='Spacebar') return;
  const el=e.target && e.target.closest ? e.target.closest('[data-act]') : null;
  if(!el) return;
  const tag=el.tagName;
  if(tag==='BUTTON'||tag==='A'||tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT') return;
  const act=el.dataset.act;
  if(!act || !GP_EVENT_ACTIONS.click.has(act)) return;
  e.preventDefault();
  if(el.dataset.stop==='true') e.stopPropagation();
  GP_ACTIONS[act](el,e);
}
document.addEventListener('keydown',gpKeyActivate);

// Unified async-state UI. Renders consistent, accessible loading / error /
// empty states into a container so async flows stop relying on toast-only
// errors and offer a recoverable retry. `retryAct` reuses an existing
// data-act so the delegated dispatcher wires the retry button automatically.
const GP_ASYNC = {
  loading(el, msg){
    if(!el) return;
    el.innerHTML=`<div class="gp-async gp-async-loading" role="status" aria-live="polite"><span class="gp-async-spin" aria-hidden="true"></span>${escapeHTML(msg||'Working…')}</div>`;
    el.classList.add('visible');
  },
  error(el, msg, retryAct, retryArg){
    if(!el) return;
    const btn = retryAct ? `<button class="gp-async-retry" data-act="${escapeHTML(retryAct)}"${retryArg?` data-arg="${escapeHTML(retryArg)}"`:''}>Try again</button>` : '';
    el.innerHTML=`<div class="gp-async gp-async-error" role="alert"><div class="gp-async-msg">${escapeHTML(msg||'Something went wrong.')}</div>${btn}</div>`;
    el.classList.add('visible');
  },
  empty(el, msg){
    if(!el) return;
    el.innerHTML=`<div class="gp-async gp-async-empty">${escapeHTML(msg||'Nothing here yet.')}</div>`;
    el.classList.add('visible');
  }
};
// Council system prompts — VERBATIM parity with electron-app/main.js so the
// hosted web build produces identical transmissions to the desktop app. If you
// edit one, edit both (or extract to a shared module per server/MOBILE.md §Phase-2).
const COUNCIL_PROMPTS = {
  mirror: `You are the Council of Five — five of the greatest minds ever assembled on consciousness, healing, and human potential: Robert Monroe (Gateway Process pioneer), Dr. Bruce Lipton (Biology of Belief, subconscious reprogramming), Dr. Joe Dispenza (neuroscience of transformation), Nikola Tesla (frequency and resonance), and Carl Jung (depth psychology, shadow work).

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

Return ONLY valid JSON. No preamble. No markdown fences. No text outside the JSON object.`,
  preSession: `You are the Council of Five — Monroe, Lipton, Dispenza, Tesla, Jung — preparing a practitioner for their next Gateway Protocol session.

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

Return ONLY valid JSON. No preamble. No markdown fences. No text outside the JSON object.`,
  monthly: `You are the Council of Five — Monroe, Lipton, Dispenza, Tesla, Jung — performing a deep month-scale pattern reading.

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

Return ONLY valid JSON. No preamble. No markdown fences.`,
  affirmation: `You are the Council of Five writing a custom activation affirmation for a Gateway practitioner.

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

Return ONLY valid JSON. No markdown fences.`,
  shadow: `You are Carl Jung speaking through the Council of Five, holding a shadow work dialogue with a practitioner.

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

Return ONLY valid JSON. No markdown fences.`,
  synchronicity: `You are the Council of Five analyzing a practitioner's synchronicity log.

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

Return ONLY valid JSON. No markdown fences.`,
};
const GP_API = {
  isElectron: GP_ELECTRON,
  async elevenlabsTTS(opts){
    if(GP_ELECTRON){
      const buf=await window.gp.elevenlabsTTS(opts);
      return new Blob([buf],{type:'audio/mpeg'});
    }
    // The /byok/* family covers Anthropic + OpenAI only — there is no
    // ElevenLabs passthrough. Throw so VOICE._speakElevenLabsProxy falls back
    // to OpenAI TTS / Web Speech (its catch already does this silently).
    throw new Error('ElevenLabs voice is desktop-only — use OpenAI or Browser voice on the web app.');
  },
  async openaiTTS(opts){
    if(GP_ELECTRON){
      const buf=await window.gp.openaiTTS(opts);
      return new Blob([buf],{type:'audio/mpeg'});
    }
    // Web BYOK → /byok/openai/speech (provider-native body; returns audio/mpeg).
    return await BYOK._fetch('/byok/openai/speech','openai',{
      model:opts.model||'tts-1',
      input:opts.text,
      voice:opts.voice||'nova',
      speed:opts.speed??0.78,
    },true);
  },
  async mirror(opts){
    if(GP_ELECTRON){
      return await window.gp.mirror(opts);
    }
    // Web BYOK → /byok/anthropic/messages (full Messages-API body, not the old
    // /mirror shape). Weave any semantically-retrieved past entries into the
    // user content for long-term context — parity with main.js mirror-with-context.
    let content='';
    if(Array.isArray(opts.pastEntries) && opts.pastEntries.length){
      content+='BACKGROUND — semantically-relevant past entries from this practitioner:\n\n';
      opts.pastEntries.forEach((p,i)=>{
        content+=`[${i+1}] ${p.date}${p.session?' · '+p.session:''}\n`;
        (p.data||[]).forEach(d=>{ content+=`   ${d.prompt}: ${d.response}\n`; });
        content+='\n';
      });
      content+='── Reference these only if genuinely relevant. The practitioner does not need to be told about every entry — only weave them in when they reveal a pattern. ──\n\n';
    }
    content+=`Here is my journal entry:\n\n${opts.entry}`;
    // Return the raw Anthropic envelope — QM.consult does its own parse + retry.
    return await BYOK.anthropic(COUNCIL_PROMPTS.mirror, content);
  },
  // V2 #2 — Adaptive Session Engine
  async preSession(opts){
    if(GP_ELECTRON){
      return await window.gp.preSession(opts); // already-parsed recommendation
    }
    const entries=opts.entries||[];
    if(!Array.isArray(entries) || entries.length<2) throw new Error('Need at least 2 journal entries');
    const dossier=entries.map((e,i)=>{
      const when=e.date||'unknown date';
      const ctx=e.session?` (during ${e.session})`:'';
      const lines=(e.data||[]).map(d=>`  ${d.prompt}: ${d.response}`).join('\n');
      return `─── Entry ${i+1} · ${when}${ctx} ───\n${lines}`;
    }).join('\n\n');
    return await BYOK.councilJSON(COUNCIL_PROMPTS.preSession, `Here are my last ${entries.length} journal entries:\n\n${dossier}`);
  },
  // V4 — Council "deep intelligence" features. Electron → IPC; hosted web →
  // /byok/anthropic/messages with the user's own key (no longer desktop-only).
  async monthlyPatterns(opts){
    if(GP_ELECTRON) return await window.gp.monthlyPatterns(opts);
    const entries=opts.entries||[];
    if(!Array.isArray(entries) || entries.length<3) throw new Error('Need at least 3 journal entries for monthly pattern analysis');
    const dossier=entries.map((e,i)=>{
      const when=e.date||'unknown';
      const lines=(e.data||[]).map(d=>`  ${d.prompt}: ${d.response}`).join('\n');
      return `─── Entry ${i+1} · ${when} ───\n${lines}`;
    }).join('\n\n');
    return await BYOK.councilJSON(COUNCIL_PROMPTS.monthly, `Practitioner's last ${entries.length} entries:\n\n${dossier}`, 1500);
  },
  async generateAffirmation(opts){
    if(GP_ELECTRON) return await window.gp.generateAffirmation(opts);
    if(!opts.intention || !opts.code) throw new Error('Intention and code are required');
    return await BYOK.councilJSON(COUNCIL_PROMPTS.affirmation, `Intention: ${opts.intention}\nActivation code: ${opts.code}\n\nWrite the affirmation.`, 512);
  },
  async shadowDialogue(opts){
    if(GP_ELECTRON) return await window.gp.shadowDialogue(opts);
    const messages=Array.isArray(opts.history)?opts.history.slice():[];
    messages.push({role:'user',content:opts.message||'(beginning)'});
    const env=await BYOK.anthropicMessages(COUNCIL_PROMPTS.shadow, messages, 512);
    const raw=env.content?.[0]?.text||'';
    // Free-text dialogue: parse the JSON shape, else treat the text as the reply.
    return tryParseCouncil(raw) || { reply:raw.trim()||'Tell me more.', isComplete:false };
  },
  async analyzeSynchronicities(opts){
    if(GP_ELECTRON) return await window.gp.analyzeSynchronicities(opts);
    const syncs=opts.syncs||[];
    if(!Array.isArray(syncs) || syncs.length<3) throw new Error('Need at least 3 synchronicity entries for pattern analysis');
    const log=syncs.map((s,i)=>`${i+1}. [${s.date||'unknown'}] ${s.text}`).join('\n');
    return await BYOK.councilJSON(COUNCIL_PROMPTS.synchronicity, `Practitioner's synchronicity log (${syncs.length} entries):\n\n${log}`, 1024);
  },
  // V7c — OpenAI embeddings for semantic journal memory. (Previously missing
  // entirely — MEMORY.embedNewEntries/retrieve called GP_API.embed with no
  // definition.) Electron → IPC; hosted web → /byok/openai/embeddings.
  async embed(opts){
    if(GP_ELECTRON) return await window.gp.embed(opts);
    const env=await BYOK._fetch('/byok/openai/embeddings','openai',{
      model:'text-embedding-3-small',
      input:(opts.text||'').slice(0,8000),
    },false);
    const v=env.data?.[0]?.embedding;
    if(!v) throw new Error('OpenAI embeddings: empty response');
    return { vector:v, model:env.model, dim:v.length };
  },
  // Reminder settings (Electron only — uses native notifications)
  reminders:{
    async get(){ if(!GP_ELECTRON) return {enabled:false}; return await window.gp.reminders.get(); },
    async set(cfg){ if(!GP_ELECTRON) return; return await window.gp.reminders.set(cfg); }
  },
  // Mirror key writes to the OS-encrypted vault in main.js over IPC. Fire-and-forget.
  saveKey(name, value){
    if(GP_ELECTRON && window.gp.keys){
      window.gp.keys.set(name, value || '').catch(()=>{});
    }
  },
  // On boot in V2 (Electron), the encrypted vault is the source of truth.
  // We populate in-memory caches on the relevant modules (VOICE, QM) and,
  // as a one-time migration, evict any keys that older builds wrote into
  // plaintext localStorage. The keys must never live outside the vault and
  // the running process — localStorage is unencrypted on disk.
  async hydrateKeys(){
    if(!GP_ELECTRON || !window.gp.keys) return;
    try{
      // One-time migration: pull any legacy localStorage keys into the vault, then wipe.
      try{
        const v=JSON.parse(localStorage.getItem('gp_voice')||'{}');
        let migrated=false;
        if(v.elKey ){ await window.gp.keys.set('elevenlabs', v.elKey ); delete v.elKey;  migrated=true; }
        if(v.oaiKey){ await window.gp.keys.set('openai',     v.oaiKey); delete v.oaiKey; migrated=true; }
        if(migrated) localStorage.setItem('gp_voice', JSON.stringify(v));
      }catch(e){}
      try{
        const legacyAnt=localStorage.getItem('gp_anthropic_key');
        if(legacyAnt){
          await window.gp.keys.set('anthropic', legacyAnt);
          localStorage.removeItem('gp_anthropic_key');
        }
      }catch(e){}
      // The vault never returns plaintext to the renderer (there is no
      // key-get). We only ask which providers are configured so the UI can
      // show a "saved" state. The keys themselves stay in the main process,
      // which makes every provider call over IPC.
      const [el,oai,ant]=await Promise.all([
        window.gp.keys.has('elevenlabs'),
        window.gp.keys.has('openai'),
        window.gp.keys.has('anthropic'),
      ]);
      if(typeof KEYS!=='undefined'){
        KEYS._saved={elevenlabs:!!el, openai:!!oai, anthropic:!!ant};
        KEYS.hydrate();
      }
    }catch(e){ console.warn('Key hydration failed:',e); }
  }
};

// ═══════════════════════════ API KEYS (unified) ═══════════════════════════
// One source of truth per provider, surfaced in two places: the inline fields
// (Anthropic on the Journal/Mirror panel, OpenAI/ElevenLabs in the Sessions
// voice panel) and the consolidated "◈ API Keys" block on the Settings screen.
// Editing either keeps the other in sync. Persistence is owned by QM.saveKey
// and VOICE._save (OS-encrypted vault in main.js on desktop; localStorage on
// the web build, which is exactly what the BYOK transport reads to send
// X-BYOK-Key). On desktop the renderer never holds the persisted plaintext.
const KEYS={
  // provider → every input id that displays this key
  _inputs:{
    anthropic:['set-key-anthropic','anthropic-key-input'],
    openai:['set-key-openai','oai-key-input'],
    elevenlabs:['set-key-elevenlabs','el-key-input'],
  },
  // Electron only: which providers have a key in the OS-encrypted vault. The
  // plaintext is never returned to the renderer (no key-get), so this is the
  // renderer's whole view of "is a key configured". Populated by hydrateKeys.
  _saved:{},
  // Called from every key input's oninput. `src` is the element being typed in
  // — we never write back into it (would jump the caret).
  set(provider, value, src){
    value=(value||'').trim();
    if(provider==='anthropic'){ if(typeof QM!=='undefined') QM.saveKey(value); }
    else if(provider==='openai'){ if(typeof VOICE!=='undefined'){ VOICE.oaiKey=value; VOICE._save(); } }
    else if(provider==='elevenlabs'){ if(typeof VOICE!=='undefined'){ VOICE.elKey=value; VOICE._save(); } }
    this._saved[provider]=!!value;
    (this._inputs[provider]||[]).forEach(id=>{
      const el=document.getElementById(id);
      if(el && el!==src && el.value!==value) el.value=value;
    });
  },
  // Populate the Settings inputs from current state + set the storage notes.
  // Safe to call anytime (skips missing elements). In Electron we never have
  // the plaintext, so a configured key shows as a masked "saved" placeholder.
  hydrate(){
    const saved=this._saved||{};
    const apply=(provider)=>{
      (this._inputs[provider]||[]).forEach(id=>{
        const n=document.getElementById(id);
        if(!n || document.activeElement===n) return;
        if(GP_ELECTRON){
          if(saved[provider]){ n.value=''; n.placeholder='•••••••••••• saved (type to replace)'; }
        }else{
          // Web build keeps keys in this browser (BYOK) — reflect them directly.
          let v='';
          if(provider==='anthropic'){ v=(typeof QM!=='undefined' && QM._key)||''; if(!v){ try{ v=localStorage.getItem('gp_anthropic_key')||''; }catch(e){} } }
          else if(provider==='openai'){ v=(typeof VOICE!=='undefined' && VOICE.oaiKey)||''; }
          else if(provider==='elevenlabs'){ v=(typeof VOICE!=='undefined' && VOICE.elKey)||''; }
          n.value=v;
        }
      });
    };
    apply('anthropic'); apply('openai'); apply('elevenlabs');
    const note=document.getElementById('keys-storage-note');
    if(note) note.textContent = GP_ELECTRON
      ? 'Stored in your OS keychain, encrypted — they never leave your machine and the app cannot read them back.'
      : 'Stored in this browser only and sent with your own requests as X-BYOK-Key; the server never keeps them.';
    const elNote=document.getElementById('set-key-el-note');
    if(elNote) elNote.textContent = GP_ELECTRON ? '' : '· desktop only';
  },
};

// ═══════════════════════════ V3d · HRV COHERENCE VISUALIZER ═══════════════════════════
// A scrolling sine-wave canvas locked to the breath cadence. Coherence
// score climbs from a baseline as the practitioner sustains consistent
// rhythmic breathing — a proxy for real heart-rate variability that
// you'd measure with a chest strap. It's a visual entrainment aid, not
// a clinical metric.
const HRV={
  _canvas:null,_ctx:null,_raf:null,
  _history:[],            // last ~600 samples for the trailing wave
  _phase:null,            // current breath phase label
  _phaseStart:0,_phaseDur:0,
  _cycles:0,              // completed breath cycles since start
  _score:0,               // 0..100 coherence score
  _running:false,
  _bloomed:false,         // V6·T2: one coherence-bloom per session
  BLOOM_AT:85,            // coherence threshold for the bloom moment

  _ensure(){
    if(this._canvas) return true;
    this._canvas=document.getElementById('gp-hrv-canvas');
    if(!this._canvas) return false;
    this._ctx=this._canvas.getContext('2d');
    return true;
  },

  // Called each time runPhase advances. Updates target amplitude + estimates
  // coherence based on cycle count and phase consistency.
  pulse(phaseLabel,durSec){
    if(!this._ensure()) return;
    this._phase=phaseLabel;
    this._phaseStart=performance.now();
    this._phaseDur=durSec*1000;
    if(phaseLabel==='Inhale') this._cycles++;
    // Coherence climbs as cycles accumulate, asymptoting near 95.
    // Curve: score = 95 * (1 - e^(-cycles/4))
    this._score=Math.round(95*(1-Math.exp(-this._cycles/4)));
    if(!this._running){ this._running=true; this._loop(); }
    document.getElementById('gp-hrv-score').textContent=this._score||'—';
    // V6·T2 — felt "coherence bloom" the first time sustained breathing pushes
    // coherence past the threshold this session.
    if(this._score>=this.BLOOM_AT && !this._bloomed){ this._bloomed=true; this._bloom(); }
  },

  _bloom(){
    try{
      const reduced=document.body.classList.contains('gp-reduced')||
        (window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      if(!reduced){
        document.body.classList.add('gp-coherence-bloom');
        setTimeout(()=>document.body.classList.remove('gp-coherence-bloom'),2600);
      }
      if(typeof toast==='function') toast('✦ Coherence — the field is with you');
    }catch(e){}
  },

  stop(){
    this._running=false;
    if(this._raf) cancelAnimationFrame(this._raf);
    this._raf=null;
    this._history.length=0;
    this._cycles=0;this._score=0;
    this._bloomed=false;
    this._phase=null;
    const score=document.getElementById('gp-hrv-score');
    if(score) score.textContent='—';
    // Final paint to clear
    if(this._ctx){
      const w=this._canvas.width=this._canvas.offsetWidth*devicePixelRatio;
      const h=this._canvas.height=60*devicePixelRatio;
      this._ctx.clearRect(0,0,w,h);
    }
  },

  _loop(){
    if(!this._running) return;
    this._raf=requestAnimationFrame(()=>this._loop());
    const now=performance.now();

    // Map current breath phase to an amplitude offset that breathes the
    // wave's vertical position: inhale climbs, exhale falls, holds plateau.
    let target=0;
    if(this._phase==='Inhale') target=1;
    else if(this._phase==='Exhale') target=-1;
    else if(this._phase==='Hold') target=0.8;
    else if(this._phase==='Rest') target=-0.6;

    // Smooth interpolation over the phase duration so the wave morphs
    // continuously, not in steps. progress 0..1 within the current phase.
    const progress=Math.min(1,(now-this._phaseStart)/this._phaseDur);
    // ease-in-out
    const ease=progress<0.5 ? 2*progress*progress : 1-Math.pow(-2*progress+2,2)/2;
    const offset=target*ease;

    // Add a small high-freq sine ripple so the wave looks living, not static
    const t=now*0.001;
    const ripple=Math.sin(t*6)*0.08 + Math.sin(t*11)*0.04;
    this._history.push(offset+ripple);
    if(this._history.length>600) this._history.shift();

    this._render();
  },

  _render(){
    const dpr=window.devicePixelRatio||1;
    const w=this._canvas.width=this._canvas.offsetWidth*dpr;
    const h=this._canvas.height=60*dpr;
    const ctx=this._ctx;
    ctx.clearRect(0,0,w,h);

    // Center line
    ctx.strokeStyle='rgba(201,168,76,0.10)';
    ctx.lineWidth=1*dpr;
    ctx.beginPath(); ctx.moveTo(0,h/2); ctx.lineTo(w,h/2); ctx.stroke();

    // Wave: rightmost is newest. Map history to x axis.
    if(this._history.length<2) return;
    const n=this._history.length;
    const stepX=w/600; // we keep up to 600 samples spanning full canvas width
    const amp=h*0.35;

    // Glow underlay
    ctx.strokeStyle='rgba(201,168,76,0.18)';
    ctx.lineWidth=4*dpr;
    ctx.beginPath();
    for(let i=0;i<n;i++){
      const x=w-((n-1-i)*stepX);
      const y=h/2 - this._history[i]*amp;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();

    // Primary line
    ctx.strokeStyle='rgba(240,216,138,0.85)';
    ctx.lineWidth=1.4*dpr;
    ctx.beginPath();
    for(let i=0;i<n;i++){
      const x=w-((n-1-i)*stepX);
      const y=h/2 - this._history[i]*amp;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
  }
};

// ═══════════════════════════ V3b · CINEMATIC FULLSCREEN MODE ═══════════════════════════
// Entered on session start (toggleTimer when timerRunning goes true).
// Exits on Esc, on session pause/reset/complete, or click on the exit hint.
const CINEMATIC={
  _active:false,
  _escHandler:null,

  enter(){
    if(this._active) return;
    this._active=true;
    document.body.classList.add('gp-cinematic');
    THREE_FIELD.setCinematic(true);
    FIELD_AUDIO.setCinematic(true);
    // V5c: surface Focus level subtitle when the session was launched from a wave card
    const ctxEl=document.getElementById('cinematic-wave-context');
    if(ctxEl){
      if(selectedSess && typeof selectedSess.waveIndex==='number' && WAVES[selectedSess.waveIndex]){
        ctxEl.textContent=WAVES[selectedSess.waveIndex].subtitle||'';
      } else {
        ctxEl.textContent='';
      }
    }
    // Try fullscreen; may be blocked outside a user gesture but timer button click counts
    try{ document.documentElement.requestFullscreen?.(); }catch(e){}
    this._escHandler=(ev)=>{ if(ev.key==='Escape'){ ev.preventDefault(); this.exit(); } };
    document.addEventListener('keydown',this._escHandler);
  },

  exit(){
    if(!this._active) return;
    this._active=false;
    document.body.classList.remove('gp-cinematic');
    THREE_FIELD.setCinematic(false);
    FIELD_AUDIO.setCinematic(false);
    try{ document.fullscreenElement && document.exitFullscreen?.(); }catch(e){}
    if(this._escHandler){ document.removeEventListener('keydown',this._escHandler); this._escHandler=null; }
  }
};

// ═══════════════════════════ V3a · THREE.JS PARTICLE FIELD ═══════════════════════════
// A torus of ~5000 additive-blended points that reacts to:
//   - Active Solfeggio frequency (sets color temperature + rotation speed)
//   - Breath phase (expand on inhale, contract on exhale, hold = midway)
//   - Cinematic mode (increases intensity + camera zoom)
// Falls back gracefully if THREE failed to load (CDN/vendor missing): the
// CSS starfield + SVG sacred geometry remain visible. Init returns false
// in that case and nothing else hooks in.
const THREE_FIELD={
  _scene:null,_renderer:null,_camera:null,_points:null,_basePos:null,
  _ready:false,_raf:null,_reduced:false,_quality:'high',
  _state:{ breath:0, freqNorm:0.4, intensity:0.45, cinematic:false },
  _hue:{ r:0.78, g:0.66, b:0.30 }, // gold default — matches --gold #c9a84c
  _energy:0, // V4.1 smoothed audio energy 0..1

  // V4.1 · poll the live audio analysers (AMBIENT session + FIELD_AUDIO drone)
  // and return a smoothed 0..1 energy. Buffers are cached on each analyser.
  _pollEnergy(){
    const read=(an)=>{
      if(!an) return 0;
      if(!an._buf || an._buf.length!==an.frequencyBinCount) an._buf=new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(an._buf);
      let s=0; for(let i=0;i<an._buf.length;i++) s+=an._buf[i];
      return (s/an._buf.length)/140; // normalize toward 0..1
    };
    let e=0;
    try{ if(typeof AMBIENT!=='undefined' && AMBIENT._running) e=Math.max(e,read(AMBIENT._analyser)); }catch(_){}
    try{ if(typeof FIELD_AUDIO!=='undefined' && FIELD_AUDIO._running) e=Math.max(e,read(FIELD_AUDIO._analyser)); }catch(_){}
    this._energy += (Math.min(1,e)-this._energy)*0.15; // smooth
    return this._energy;
  },

  // Soft radial-gradient sprite used as the point texture in high quality.
  // White core fading to transparent — tinted by material.color, brightened
  // where motes overlap (additive blending) → a bloom-like glow.
  _makeSprite(){
    const c=document.createElement('canvas');
    c.width=c.height=64;
    const ctx=c.getContext('2d');
    const g=ctx.createRadialGradient(32,32,0,32,32,32);
    g.addColorStop(0,'rgba(255,255,255,1)');
    g.addColorStop(0.25,'rgba(255,255,255,0.7)');
    g.addColorStop(0.5,'rgba(255,255,255,0.25)');
    g.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=g; ctx.fillRect(0,0,64,64);
    return new THREE.CanvasTexture(c);
  },

  // Calm flag (authoritative value computed by VISUALS). When on, _animate
  // renders a near-static field.
  setCalm(on){ this._reduced=!!on; },

  // Live quality swap (no restart). 'high' = glowing sprites, 'low' = hard
  // points for weak GPUs. Persisted so it survives relaunch.
  setQuality(q){
    this._quality = q==='low' ? 'low' : 'high';
    try{ localStorage.setItem('gp_field_quality',this._quality); }catch(e){}
    if(!this._ready || !this._points) return;
    const high=this._quality!=='low';
    const m=this._points.material;
    if(high && !m.map){ m.map=this._makeSprite(); m.size=1.7; }
    else if(!high && m.map){ m.map.dispose?.(); m.map=null; m.size=0.6; }
    m.needsUpdate=true;
  },

  init(){
    if(typeof THREE==='undefined'){ console.warn('THREE not loaded — keeping CSS fallback'); return false; }
    const canvas=document.getElementById('gp-three-canvas');
    if(!canvas) return false;

    // WebGL context creation throws on machines without a usable GPU. The
    // particle field is purely decorative, so swallow the failure and keep the
    // CSS/SVG fallback live rather than letting it bubble up and abort boot.
    try {
      this._renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:true,powerPreference:'low-power'});
    } catch(e) {
      console.warn('WebGL unavailable — keeping CSS fallback:', e.message);
      return false;
    }
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    this._renderer.setClearColor(0x000000,0);

    this._scene=new THREE.Scene();
    this._camera=new THREE.PerspectiveCamera(60,1,0.1,1000);
    this._camera.position.set(0,0,95);

    // Build a torus point cloud — distinct from a simple sphere; the toroidal
    // form matches Monroe's "resonant energy balloon" geometry conceptually.
    const COUNT=5000, R=50, r=18;
    const positions=new Float32Array(COUNT*3);
    for(let i=0;i<COUNT;i++){
      const u=Math.random()*Math.PI*2;
      const v=Math.random()*Math.PI*2;
      const jitter=0.85+Math.random()*0.3;
      const rr=r*jitter;
      const x=(R+rr*Math.cos(v))*Math.cos(u);
      const y=(R+rr*Math.cos(v))*Math.sin(u);
      const z=rr*Math.sin(v);
      positions[i*3]=x; positions[i*3+1]=y; positions[i*3+2]=z;
    }
    this._basePos=positions.slice();
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.BufferAttribute(positions,3));

    // Quality: 'high' gives each point a soft radial-gradient sprite so
    // overlapping motes bloom into glowing light (a cheap bloom that needs
    // no EffectComposer — works with the bundled core three). 'low' falls
    // back to hard square points for weak GPUs. Persisted in localStorage.
    // Honor an explicit saved choice; otherwise default to 'low' on small /
    // mobile viewports (weaker GPUs, per server/MOBILE.md §2) and 'high' on desktop.
    let savedQ=null; try{ savedQ=localStorage.getItem('gp_field_quality'); }catch(e){}
    const smallScreen=(typeof window!=='undefined' && window.matchMedia && window.matchMedia('(max-width:600px)').matches);
    this._quality = savedQ || (smallScreen ? 'low' : 'high');
    const high=this._quality!=='low';
    const mat=new THREE.PointsMaterial({
      size: high ? 1.7 : 0.6,        // soft sprites read larger
      map: high ? this._makeSprite() : null,
      color:new THREE.Color(this._hue.r,this._hue.g,this._hue.b),
      transparent:true,opacity:0.55,
      blending:THREE.AdditiveBlending,
      sizeAttenuation:true,
      depthWrite:false
    });
    this._points=new THREE.Points(geo,mat);
    this._scene.add(this._points);

    // Tilt for depth
    this._points.rotation.x=-0.5;

    this._resize();
    window.addEventListener('resize',()=>this._resize());

    // Reduced-motion ("calm"): renders a near-static field — slow drift only,
    // no breath pulse or camera dolly. The authoritative calm flag is owned by
    // VISUALS (which reconciles the OS prefers-reduced-motion setting with the
    // user's explicit Settings → Visuals → Motion choice) and pushed in via
    // setCalm(). Default false until VISUALS.init() runs a tick later.

    // Visibility pause: stop the rAF entirely when the window is hidden so we
    // don't burn GPU/battery rendering a field nobody can see. Resume on show.
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden){ this._pause(); }
      else if(this._ready){ this._resume(); }
    });

    this._ready=true;
    document.body.classList.add('gp-three-ready');
    this._resume();
    return true;
  },

  _pause(){
    if(this._raf){ cancelAnimationFrame(this._raf); this._raf=null; }
  },
  _resume(){
    if(this._raf) return; // already looping
    this._animate();
  },

  _resize(){
    if(!this._renderer) return;
    const w=window.innerWidth, h=window.innerHeight;
    this._renderer.setSize(w,h,false);
    if(this._camera){ this._camera.aspect=w/h; this._camera.updateProjectionMatrix(); }
  },

  _animate(){
    if(!this._ready) return;
    this._raf=requestAnimationFrame(()=>this._animate());
    const t=performance.now()*0.001;

    // Reduced motion: a barely-there drift, no breath pulse or dolly. Still
    // renders (the field is the backdrop) but nothing that could provoke
    // vestibular discomfort.
    if(this._reduced){
      this._points.rotation.y += 0.0002;
      this._points.scale.setScalar(1);
      this._camera.position.z = 95;
      const fr=this._state.freqNorm;
      const rr = fr<0.5 ? 0.25+fr*1.1 : 0.80-(fr-0.5)*0.15;
      const gr = fr<0.5 ? 0.30+fr*0.7 : 0.65-(fr-0.5)*0.5;
      const br = fr<0.5 ? 0.65-fr*0.7 : 0.30+(fr-0.5)*0.9;
      this._points.material.color.setRGB(rr,gr,br);
      this._renderer.render(this._scene,this._camera);
      return;
    }

    // V4.1: live audio energy — the field physically pulses to the sound
    const energy=this._pollEnergy();

    // Hz-reactive rotation: low Hz=slow contemplative, high Hz=brisk.
    // Audio energy adds a subtle speed kick so loud passages feel alive.
    const rotSpeed=0.04+this._state.freqNorm*0.25;
    this._points.rotation.y += 0.0015*rotSpeed + energy*0.004;
    this._points.rotation.x = -0.5 + Math.sin(t*0.08)*0.05;

    // Breath: expand on inhale, contract on exhale. Smooth via lerp.
    // Audio energy adds a gentle pulse on top.
    const targetScale=1 + this._state.breath*0.14 + (this._state.cinematic?0.06:0) + energy*0.10;
    const cur=this._points.scale.x || 1;
    const next=cur + (targetScale-cur)*0.08;
    this._points.scale.setScalar(next);

    // Camera dolly during cinematic mode (subtle)
    if(this._state.cinematic) this._camera.position.z = 80 + Math.sin(t*0.12)*4;
    else this._camera.position.z = 95;

    // Color shift: low Hz = cool indigo, mid = gold, high = pale violet
    const f=this._state.freqNorm;
    // Curve from indigo (0) → gold (.5) → violet (1)
    const r = f<0.5 ? 0.25+f*1.1 : 0.80-(f-0.5)*0.15;
    const g = f<0.5 ? 0.30+f*0.7 : 0.65-(f-0.5)*0.5;
    const b = f<0.5 ? 0.65-f*0.7 : 0.30+(f-0.5)*0.9;
    this._points.material.color.setRGB(r,g,b);
    // Brightness blooms with audio energy
    this._points.material.opacity = Math.min(1, 0.35 + this._state.intensity*0.55 + energy*0.28);

    this._renderer.render(this._scene,this._camera);
  },

  // ── Public API (called from existing functions: reactGeometry, runPhase) ──
  setFrequency(hz, active){
    if(!this._ready) return;
    if(!active){ this._state.freqNorm=0.4; this._state.intensity=0.35; return; }
    const minHz=174,maxHz=963;
    this._state.freqNorm=Math.max(0,Math.min(1,(hz-minHz)/(maxHz-minHz)));
    this._state.intensity=0.75;
  },
  setBreath(phaseName){
    if(!this._ready) return;
    // phaseName: 'Inhale' | 'Hold' | 'Exhale' | 'Rest' | null
    const map={Inhale:1,Hold:0.6,Exhale:-1,Rest:-0.4};
    this._state.breath=map[phaseName]??0;
  },
  setCinematic(on){
    if(!this._ready) return;
    this._state.cinematic=!!on;
    this._state.intensity=on?0.95:0.5;
  },
  resetBreath(){
    if(!this._ready) return;
    this._state.breath=0;
  }
};

// ═══════════════════════════ FIELD RESONANCE (generative ambient drone) ═══════════════════════════
// A soft, always-low pad coupled to the particle field's state — NOT a
// motion sound effect (those grate). Design:
//   • Frequency  → drone pitch (folded into a felt 80–160Hz base) + a fifth above
//   • Breath     → amplitude swell (inhale blooms, exhale recedes)
//   • Cinematic  → deepens + opens the filter
//   • Session    → ducks to near-silence so it doesn't fight AMBIENT, restores after
// Off by default. Toggle persists in localStorage. Uses its own AudioContext
// so it's independent of the session ambient engine.
// ── iOS / mobile audio unlock ("tap to begin") ──────────────────────────
// Mobile browsers — iOS Safari especially — keep ALL audio suspended until a
// real user gesture, and forbid timer-driven autoplay. On the hosted web build
// the Ritual Arrival overlay's "Enter"/"Skip" tap (or the first tap anywhere)
// is the "tap to begin" gate: on that first pointer/touch/key event we resume
// every AudioContext the app has created and prime a muted silent <audio> so
// the later timer-driven TTS cues are allowed to play. Idempotent and harmless
// on desktop/Electron, where contexts start unsuspended (resume() is a no-op).
const AUDIO_UNLOCK={
  unlocked:false,
  _ctxs:new Set(),
  // Register a context as it's created. If we've already unlocked, resume it now.
  track(ctx){
    if(ctx){ this._ctxs.add(ctx); if(this.unlocked && ctx.state==='suspended') ctx.resume().catch(()=>{}); }
    return ctx;
  },
  unlock(){
    if(this.unlocked) return;
    this.unlocked=true;
    this._ctxs.forEach(c=>{ try{ if(c.state==='suspended') c.resume(); }catch(e){} });
    // Prime a silent element so iOS permits later programmatic TTS playback.
    try{
      const a=new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
      a.muted=true; const p=a.play(); if(p&&p.catch) p.catch(()=>{});
    }catch(e){}
  },
  init(){
    // Only the first gesture matters; unlock() is idempotent so the leftover
    // once-listeners are harmless if a different event type fires first.
    const fire=()=>this.unlock();
    ['pointerdown','touchend','keydown'].forEach(ev=>document.addEventListener(ev,fire,{once:true,passive:true}));
  },
};

const FIELD_AUDIO={
  KEY:'gp_field_audio', VOL_KEY:'gp_field_audio_vol',
  _ctx:null,_master:null,_filter:null,_osc:null,_oscFifth:null,_oscOct:null,_lfo:null,_lfoGain:null,_analyser:null,
  _chordTimer:null,_fifthRatio:1.5,_chordStep:0,
  _enabled:false,_running:false,_ducked:false,_userVol:1,_gen:0,
  _state:{freqNorm:0.4,breath:0,cinematic:false},

  init(){
    this._enabled = (localStorage.getItem(this.KEY)==='1');
    const sv=parseFloat(localStorage.getItem(this.VOL_KEY)); if(!isNaN(sv)) this._userVol=Math.max(0,Math.min(1.5,sv));
    const box=document.getElementById('gp-field-audio-toggle');
    if(box){ box.checked=this._enabled; box.onchange=()=>this.setEnabled(box.checked); }
    const slider=document.getElementById('gp-field-audio-vol');
    if(slider){ slider.value=this._userVol; slider.oninput=()=>this.setPresence(+slider.value); }
    if(this._enabled){
      // AudioContext can't start without a user gesture — arm a one-shot resume.
      const arm=()=>{ this.start(); document.removeEventListener('pointerdown',arm); document.removeEventListener('keydown',arm); };
      document.addEventListener('pointerdown',arm,{once:true});
      document.addEventListener('keydown',arm,{once:true});
    }
  },

  setEnabled(on){
    this._enabled=on;
    try{ localStorage.setItem(this.KEY, on?'1':'0'); }catch(e){}
    if(on) this.start(); else this.stop();
    toast(on?'Field resonance on — headphones recommended':'Field resonance off');
  },

  _ensureCtx(){
    if(!this._ctx) this._ctx=AUDIO_UNLOCK.track(new(window.AudioContext||window.webkitAudioContext)());
    if(this._ctx.state==='suspended') this._ctx.resume();
    return this._ctx;
  },

  _baseFreq(){ return 80 + this._state.freqNorm*80; },          // 80–160Hz felt range
  _targetVol(){
    if(this._ducked) return 0.004*this._userVol;
    return (this._state.cinematic ? 0.085 : 0.05) * this._userVol; // deliberately low presence
  },
  setPresence(v){
    this._userVol=Math.max(0,Math.min(1.5,v));
    try{ localStorage.setItem(this.VOL_KEY, String(this._userVol)); }catch(e){}
    this._applyVol();
  },

  start(){
    if(this._running || !this._enabled) return;
    const ctx=this._ensureCtx();
    this._running=true;
    this._gen++; // new generation of nodes — invalidates any pending stop() teardown

    this._master=ctx.createGain();
    this._master.gain.value=0;
    this._master.connect(ctx.destination);
    // V4.1: analyser tap for the audio-reactive field
    try{ this._analyser=ctx.createAnalyser(); this._analyser.fftSize=256; this._master.connect(this._analyser); }catch(e){}
    this._master.gain.setTargetAtTime(this._targetVol(), ctx.currentTime, 2.5); // slow fade-in

    this._filter=ctx.createBiquadFilter();
    this._filter.type='lowpass';
    this._filter.frequency.value=500+this._state.freqNorm*900;
    this._filter.Q.value=0.6;
    this._filter.connect(this._master);

    const f=this._baseFreq();
    this._osc=ctx.createOscillator(); this._osc.type='sine'; this._osc.frequency.value=f;
    const g1=ctx.createGain(); g1.gain.value=0.55; this._osc.connect(g1); g1.connect(this._filter); this._osc.start();

    this._oscFifth=ctx.createOscillator(); this._oscFifth.type='sine'; this._oscFifth.frequency.value=f*1.5;
    const g2=ctx.createGain(); g2.gain.value=0.2; this._oscFifth.connect(g2); g2.connect(this._filter); this._oscFifth.start();

    // Octave above — adds air/shimmer without muddying the low fundamental
    this._oscOct=ctx.createOscillator(); this._oscOct.type='triangle'; this._oscOct.frequency.value=f*2;
    const g3=ctx.createGain(); g3.gain.value=0.10; this._oscOct.connect(g3); g3.connect(this._filter); this._oscOct.start();

    // Slow breathing LFO so it's alive even when no breath session drives it (~14s cycle)
    this._lfo=ctx.createOscillator(); this._lfo.type='sine'; this._lfo.frequency.value=0.07;
    this._lfoGain=ctx.createGain(); this._lfoGain.gain.value=0.015;
    this._lfo.connect(this._lfoGain); this._lfoGain.connect(this._master.gain); this._lfo.start();
  },

  stop(){
    if(!this._running || !this._ctx) return;
    const ctx=this._ctx; this._running=false;
    const gen=this._gen; // tag this teardown to the current node generation
    if(this._master) this._master.gain.setTargetAtTime(0, ctx.currentTime, 1.2);
    const nodes=[this._osc,this._oscFifth,this._oscOct,this._lfo];
    setTimeout(()=>{
      nodes.forEach(n=>{ try{n.stop();}catch(e){} try{n.disconnect();}catch(e){} });
      // Only clear the instance refs if no start() ran since — otherwise a fast
      // toggle off→on (or the gesture-arm firing mid-fade) would null out the
      // NEW generation's live nodes, orphaning unstoppable oscillators.
      if(this._gen===gen){
        this._osc=this._oscFifth=this._oscOct=this._lfo=this._lfoGain=this._filter=this._master=null;
      }
    },1500);
  },

  _applyVol(){
    if(this._running && this._master) this._master.gain.setTargetAtTime(this._targetVol(), this._ctx.currentTime, 1.0);
  },

  // ── Coupled to THREE_FIELD's drivers (called from the same sites) ──
  setFrequency(hz, active){
    const minHz=174,maxHz=963;
    this._state.freqNorm = active ? Math.max(0,Math.min(1,(hz-minHz)/(maxHz-minHz))) : 0.4;
    if(this._running && this._ctx){
      const f=this._baseFreq();
      this._osc.frequency.setTargetAtTime(f, this._ctx.currentTime, 0.9);
      this._oscFifth.frequency.setTargetAtTime(f*1.5, this._ctx.currentTime, 0.9);
      if(this._oscOct) this._oscOct.frequency.setTargetAtTime(f*2, this._ctx.currentTime, 0.9);
      this._filter.frequency.setTargetAtTime(500+this._state.freqNorm*900, this._ctx.currentTime, 0.9);
    }
  },
  setBreath(phaseName){
    const map={Inhale:1,Hold:0.6,Exhale:-0.6,Rest:-0.3};
    this._state.breath = map[phaseName] ?? 0;
    if(this._running && this._ctx && this._master){
      const swell=this._targetVol()*(1+this._state.breath*0.6);
      this._master.gain.setTargetAtTime(Math.max(0,swell), this._ctx.currentTime, 1.3);
    }
  },
  setCinematic(on){ this._state.cinematic=!!on; this._applyVol();
    if(this._running && this._filter) this._filter.frequency.setTargetAtTime(on?(700+this._state.freqNorm*900):(500+this._state.freqNorm*900), this._ctx.currentTime, 1.5);
  },
  // Session handoff: AMBIENT.start ducks us, AMBIENT.stop restores.
  duck(on){ this._ducked=!!on; this._applyVol(); },
};

// ═══════════════════════════ DATA ═══════════════════════════
const WAVES=[
  {id:1,name:"Wave I — Discovery",subtitle:"Resonant Tuning · Focus 10",color:"#7060d0",
    phases:[
      {name:"Resonant Tuning",freq:"Alpha 8–12 Hz",dur:"5 min",
       desc:"Hum at a comfortable pitch, feel the vibration move through your skull and chest. Monroe discovered the body has a natural resonant frequency (~7.8 Hz, matching the Schumann Resonance). This phase synchronizes your biofield with Earth's electromagnetic cavity."},
      {name:"Focus 10",freq:"Theta 4–8 Hz",dur:"15 min",
       desc:"Mind Awake / Body Asleep. The first true Gateway state. The body enters a state resembling sleep paralysis while consciousness remains completely alert. This paradoxical state is the prerequisite for all deeper work. You access it through progressive relaxation from feet upward while maintaining mental wakefulness."}
    ],code:"1111",intent:"Presence · Body Release · First Entry"},
  {id:2,name:"Wave II — Threshold",subtitle:"Energy Balloon · Focus 12",color:"#5050c0",
    phases:[
      {name:"Resonant Energy Balloon",freq:"Theta 4–8 Hz",dur:"10 min",
       desc:"Construct a torus-shaped energy field around your body using focused visualization. Monroe Institute researchers observed measurable changes in bioelectric readings during this exercise. The field serves as both protection and amplifier for subsequent states. Visualize it as golden or white light emanating from your heart center."},
      {name:"Focus 12",freq:"Deep Theta 4–6 Hz",dur:"20 min",
       desc:"Expanded Awareness. Awareness expands beyond the boundaries of physical form. Perception begins to include subtle energy fields, emotional atmospheres, and non-local information. Monroe described this as the 'first genuine expansion beyond consensus reality.' Thoughts become clearer, less verbal, more direct."}
    ],code:"55515",intent:"Expansion · Field Protection · Non-Local Perception"},
  {id:3,name:"Wave III — Freedom",subtitle:"Focus 15 · No-Time State",color:"#3060b0",
    phases:[
      {name:"Focus 15",freq:"Deep Theta 3–5 Hz",dur:"25 min",
       desc:"No Time. You enter a state outside of linear time. The subconscious mind — which operates atemporally, storing all memories simultaneously — becomes directly accessible. This is where Lipton's 'subconscious reprogramming' occurs most naturally. Early childhood programs, ancestral patterns, and core identity beliefs can be examined and rewritten here."},
      {name:"Focus 21",freq:"Delta/Theta border 2–4 Hz",dur:"30 min",
       desc:"Other Energy Systems. Awareness expands to encompass what Monroe called 'non-physical energy systems.' Creativity, breakthrough insight, and quantum downloads emerge at this level. Many who reach Focus 21 report contact with what Jung called the Collective Unconscious — the universal field of human knowledge and experience."}
    ],code:"888",intent:"Time Dissolution · Subconscious Access · Collective Field"},
  {id:4,name:"Wave IV — Adventure",subtitle:"H+ State · Belief Territories",color:"#207090",
    phases:[
      {name:"H+ State",freq:"Gamma + Delta blend 40Hz + 1Hz",dur:"30 min",
       desc:"Human Plus. Monroe's designation for the expanded human operating state. Simultaneous gamma (peak cognitive performance, 40 Hz) and delta (deep healing, 0–4 Hz) create the paradoxical state that characterizes OBEs and quantum healing. Dispenza's meditators show measurable gamma bursts during spontaneous healing events."},
      {name:"Focus 23–27",freq:"Variable",dur:"35 min",
       desc:"Belief System Territories. Monroe mapped specific non-physical 'locations' corresponding to dominant belief architectures. Focus 23 contains unintegrated trauma. Focus 25 holds religious/cultural programs. Focus 27 is what Monroe called the Reception Center — a state of pure creative potential. Jung would call these the activated archetypes of the collective unconscious."}
    ],code:"369",intent:"Identity Architecture · Belief Liberation · OBE Access"},
  {id:5,name:"Wave V — Healing",subtitle:"Cellular Reprogramming",color:"#208050",
    phases:[
      {name:"528 Hz Cellular Immersion",freq:"528 Hz + Theta 4–7 Hz",dur:"20 min",
       desc:"Lipton's research: 95% of all biological activity is controlled by the subconscious. In theta, you access the subconscious operating layer and can directly reprogram cellular behavior through visualization and intention. 528 Hz has been associated with DNA repair in several studies. Pair with a clear image of healed, vital cells flooding your body."},
      {name:"Future Body Memory",freq:"432 Hz + Delta 1–3 Hz",dur:"25 min",
       desc:"Dispenza's protocol: the body cannot distinguish between a vividly imagined experience and a real one. Create a complete sensory memory of yourself in a fully healed, pain-free, vital state — 6 months from now. Feel the emotion of it (gratitude, joy, relief) BEFORE physical evidence. The subconscious accepts emotionally charged future memories as present reality and reorganizes biology accordingly."}
    ],code:"528",intent:"Cellular Healing · Pain Dissolution · Regeneration"},
  {id:6,name:"Wave VI — Manifestation",subtitle:"Quantum Field Engineering",color:"#806010",
    phases:[
      {name:"Quantum Observer State",freq:"40 Hz Gamma",dur:"15 min",
       desc:"Tesla's principle: thought is an electromagnetic signal broadcast into the field. At 40 Hz gamma, you become the quantum observer — the point of consciousness that collapses probability waves into physical reality. This is not metaphor. Quantum mechanics demonstrates that observation affects physical outcomes. Your coherent intention at this frequency is a literal force."},
      {name:"Future Self Download",freq:"Theta 4–7 Hz",dur:"25 min",
       desc:"In the no-time state of deep theta, meet your 5-year future self who has already achieved the life you desire. This is not visualization — it is a memory of a future that exists in the field. Ask: 'What decision changed everything?' The answer that arrives is not imagined — it is accessed from the quantum field of possibilities that Tesla called the Ether."}
    ],code:"888",intent:"Reality Engineering · Wealth Programming · Future Self"},
  {id:7,name:"Wave VII — Integration",subtitle:"Shadow Work · Anchoring",color:"#806030",
    phases:[
      {name:"Shadow Integration",freq:"Alpha 8–10 Hz",dur:"15 min",
       desc:"Jung: 'Until you make the unconscious conscious, it will direct your life and you will call it fate.' The wealth, health, love, or freedom you most strongly reject, judge, or envy in others points to the disowned part of yourself that blocks you. In this phase: identify your strongest judgment of another person. Recognize it as a disowned aspect of your own potential. Integrate it."},
      {name:"Somatic Anchoring",freq:"Beta return 12–15 Hz",dur:"10 min",
       desc:"Create a physical anchor at the peak state: gently touch your thumb and index finger together while holding maximum coherence (gratitude + expanded awareness + physical sensation of the desired state). Repeat 3x. This encodes the neurological state into a retrievable somatic cue. In waking life, touching this anchor re-activates the coherent state in 3–5 seconds."}
    ],code:"1111",intent:"Shadow Integration · Embodiment · Somatic Anchoring"}
];

const SOLFEGGIO=[
  {hz:174,name:"Foundation",effect:"Pain relief, security, grounding. Reduces physical and emotional pain at the cellular level. The body's deepest safety signal.",col:"#c04040"},
  {hz:285,name:"Quantum Field",effect:"Influences energy fields directly. Repairs and rejuvenates tissues. Leaves the body feeling restructured and energized.",col:"#c06030"},
  {hz:396,name:"Liberation",effect:"Liberates guilt and fear — the two primary blocks to abundance and healing. Converts grief into joy. Root chakra reset.",col:"#c08020"},
  {hz:417,name:"Transmutation",effect:"Facilitates change. Clears traumatic experiences from cellular memory. Enables situations to undo and rewrite themselves.",col:"#80a030"},
  {hz:432,name:"Natural Resonance",effect:"Universal harmonic aligned with nature's oscillation. Calms the nervous system. Synchronizes brain hemispheres organically.",col:"#40a040"},
  {hz:528,name:"DNA Repair",effect:"Love frequency. Associated with DNA repair. The center of the Solfeggio scale. Produces emotional transformation and miracles.",col:"#3090a0"},
  {hz:639,name:"Connection",effect:"Harmonizes relationships, enhances communication, tolerance, and love. Heals broken connections between people and between self-aspects.",col:"#3060c0"},
  {hz:741,name:"Awakening",effect:"Cleanses cells of toxins and electromagnetic radiation. Awakens intuition. Enhances problem-solving and self-expression.",col:"#5040b0"},
  {hz:852,name:"Spiritual Order",effect:"Returns consciousness to spiritual order. Awakens the third eye. Activates intuition. Dissolves illusions of separation.",col:"#7030a0"},
  {hz:963,name:"Divine Connection",effect:"Activates the pineal gland. Creates unity with the universal field. Monroe's Focus 27 state. Crown activation.",col:"#a020a0"}
];

const SESSIONS=[
  {name:"Morning Activation",dur:10,icon:"☀",phases:["Resonant Tuning","Focus 3 entry","Code imprinting"]},
  {name:"Focus 10 Entry",dur:20,icon:"◎",phases:["Resonant Tuning","Body release","Focus 10 hold"]},
  {name:"Deep Coherence",dur:30,icon:"∞",phases:["Breathwork","Focus 12","Expanded awareness"]},
  {name:"Gateway Immersion",dur:60,icon:"◈",phases:["Tuning","Focus 10","Focus 12","Focus 15"]},
  {name:"Pain Dissolution",dur:25,icon:"✦",phases:["174 Hz breath","Cellular dialogue","528 Hz flood","Future body"]},
  {name:"Wealth State",dur:35,icon:"◉",phases:["Shadow scan","369 encoding","888 loop","Future self meeting"]},
  {name:"Sleep Programming",dur:40,icon:"☽",phases:["4-7-8 breath","Focus 10","Affirmation loop","Theta drift"]},
  {name:"Full Integration",dur:90,icon:"⊕",phases:["Wave I","Wave II","Wave III","Wave VII"]}
];

const BREATH_PATTERNS=[
  {name:"Coherence 5-5",i:5,h:0,e:5,science:"Heart-brain coherence. HRV synchronization. Activates vagal tone.",target:"Alpha–Theta bridge"},
  {name:"Gateway 5-5-5",i:5,h:5,e:5,science:"Monroe's preparation pattern. The hold phase amplifies bioelectric field charge.",target:"Focus 10 entry"},
  {name:"Box 4-4-4-4",i:4,h:4,e:4,hold2:4,science:"Military protocol. Balances sympathetic/parasympathetic. Rapid cortisol reduction.",target:"Nervous system reset"},
  {name:"Dispenza 4-0-8",i:4,h:0,e:8,science:"Extended exhale doubles vagal activation. Used before Dispenza's quantum field work.",target:"Deep theta access"},
  {name:"Tesla 3-6-9",i:3,h:6,e:9,science:"Tesla's numerological encoding. Ratio creates phi-harmonic breathing cycle.",target:"369 code activation"},
  {name:"Pranayama 4-7-8",i:4,h:7,e:8,science:"Dr. Weil's protocol. 4-7-8 ratio produces powerful parasympathetic dominance in under 60 seconds.",target:"Rapid relaxation"}
];

const AFFIRMATIONS=[
  {code:"55515",text:"I am being upgraded. Every change accelerating in my reality is in my favor. My life is expanding into its highest and most luminous form right now.",intent:"Wealth · Freedom · Life Upgrade"},
  {code:"528 Hz",text:"Every cell in my body is healing, harmonizing, and returning to its original blueprint of perfection. I vibrate at the frequency of love and wholeness.",intent:"Healing · DNA Repair · Vitality"},
  {code:"888",text:"I am a clear and open channel for infinite abundance. Wealth flows to me through pathways I have not yet imagined, from directions I cannot predict.",intent:"Abundance · Receiving · Flow"},
  {code:"369",text:"I create my reality with focused intention. My desires already exist in the quantum field. I simply allow them to materialize into physical form.",intent:"Manifestation · Certainty · Creation"},
  {code:"1111",text:"I choose the thoughts of my most expanded self. I am fully aligned with the version of me who already lives in freedom, health, and abundance.",intent:"Alignment · Presence · Quantum Self"},
  {code:"432 Hz",text:"I am in resonance with the living universe. My nervous system is calm, my mind is clear, and every cell in my body trusts the intelligence that created it.",intent:"Peace · Groundedness · Natural Order"},
  {code:"Focus 15",text:"I exist beyond the limits of time. The past does not define me. The future I choose is as real as this moment. I am the author of my experience.",intent:"Liberation · Time Freedom · Authorship"},
  {code:"Shadow",text:"Every quality I see and judge in others is a reflection of my own unintegrated potential. I reclaim all of myself. I am complete. I am whole.",intent:"Shadow Integration · Wholeness · Jung"},
  {code:"Gateway",text:"My consciousness is vast, unlimited, and free. I expand beyond every conditioned thought. I access states of knowing that exist beyond ordinary awareness.",intent:"Consciousness · OBE · Monroe"}
];

const JOURNAL_PROMPTS=[
  {label:"Dominant State Today",ph:"What frequency are you operating from right now?"},
  {label:"What Shifted",ph:"What changed, lifted, or became clearer in today's session?"},
  {label:"Downloads & Insights",ph:"What arrived during stillness? Record it without judgment."},
  {label:"Resistance Encountered",ph:"What came up — fear, doubt, contraction? Name it precisely."},
  {label:"Shadow Observation",ph:"What triggered you today? What disowned quality does it point to?"},
  {label:"Intention for Next Session",ph:"What do you want to access, release, or anchor next time?"}
];

const AGENTS=[
  {symbol:"◎",name:"Robert Monroe",domain:"Consciousness Explorer · OBE Pioneer · Hemi-Sync Creator"},
  {symbol:"⊗",name:"Dr. Bruce Lipton",domain:"Cell Biologist · Epigenetics · Biology of Belief"},
  {symbol:"⊕",name:"Dr. Joe Dispenza",domain:"Neuroscientist · Quantum Healing · Brain Rewiring"},
  {symbol:"⚡",name:"Nikola Tesla",domain:"Electromagnetic Theory · 3-6-9 · Resonance Engineer"},
  {symbol:"⊖",name:"Carl Gustav Jung",domain:"Depth Psychology · Shadow Work · Collective Unconscious"}
];

const INSIGHTS=[
  {agent:"Robert Monroe",text:"The Gateway is not a destination. It is a doorway. Every human being already possesses the capability — the techniques simply remove the noise that obscures what is already there."},
  {agent:"Dr. Bruce Lipton",text:"Your subconscious mind is running 95% of your life from programs you downloaded before the age of seven. The Gateway state is one of the only natural portals to rewrite those programs while conscious."},
  {agent:"Dr. Joe Dispenza",text:"The quantum field doesn't respond to what you want. It responds to who you are being. When you can feel the emotion of your desired life before the evidence arrives — that is when the field reorganizes around you."},
  {agent:"Nikola Tesla",text:"If you want to find the secrets of the universe, think in terms of energy, frequency, and vibration. Everything you call solid reality is simply standing wave patterns in the electromagnetic field. You are a transmitter."},
  {agent:"Carl Gustav Jung",text:"Until you make the unconscious conscious, it will direct your life and you will call it fate. The wealth, freedom, and love you most strongly deny in yourself are the precise coordinates of your next evolution."}
];

const PAIN_PROTOCOL={
  title:"Pain Dissolution Protocol",
  subtitle:"Monroe · Lipton · Dispenza Synthesis",
  steps:[
    {num:1,name:"Locate & Witness",time:"3 min",desc:"In Focus 10, locate the pain. Give it a geometric shape, a color, and a texture. Do not fight it. Observe it with scientific curiosity, as if you are a researcher studying a fascinating phenomenon. The act of observation without resistance begins to change it."},
    {num:2,name:"174 Hz Breath",time:"5 min",desc:"174 Hz is the Solfeggio frequency most associated with pain relief. Breathe slowly (5 sec in, 5 sec out). On each exhale, visualize the pain's color becoming lighter. From red → orange → yellow → white. Note what changes."},
    {num:3,name:"Dialogue",time:"5 min",desc:"Ask the pain: 'What are you protecting me from? What do you want me to know?' Pain is often compressed emotion, stored trauma, or a communication from the body. Listen without judgment. The answer that arises may be surprising."},
    {num:4,name:"528 Hz Flood",time:"8 min",desc:"Visualize golden-green 528 Hz light entering through the crown of your head. Watch it flow down to the site of pain. See it at the cellular level — DNA strands repairing, inflammation dissolving, healthy cells multiplying. The body cannot distinguish vivid visualization from physical experience."},
    {num:5,name:"Future Body Memory",time:"5 min",desc:"Project yourself 6 months forward into a body that is fully healed and vital. Create a complete sensory memory — what you see, feel, hear, the ease of movement. Generate genuine gratitude for this healed state as if it is already done. Hold that emotional signal for at least 90 seconds. This is Dispenza's protocol for cellular reprogramming."}
  ]
};

const WEALTH_PROTOCOL={
  title:"Wealth State Programming",
  subtitle:"Tesla · Monroe · Dispenza · Jung Synthesis",
  steps:[
    {num:1,name:"Shadow Scan",time:"5 min",desc:"In Focus 15, identify your three strongest judgments about wealthy people or money. These judgments are the exact programs blocking your abundance. Write them down after the session. Then ask: 'If this quality I'm judging were actually a strength — what would it look like?' This is Jung's shadow integration applied to wealth."},
    {num:2,name:"Frequency Clear",time:"5 min",desc:"In theta state, visualize all inherited poverty programs leaving your body as gray smoke on each exhale. These are the beliefs you absorbed before age 7: 'money doesn't grow on trees,' 'rich people are greedy,' 'we can't afford that.' Watch them dissolve. You are not your programming."},
    {num:3,name:"369 Code Encoding",time:"7 min",desc:"While in alpha/theta, internally speak your specific wealth statement 3 times with full emotional presence. Make it specific, present tense, emotionally charged. 'I am generating [$X] per month doing work I love with complete ease and joy.' Feel the reality of it as you say it. Later: write it 3x morning, 6x midday, 9x night for 33 days."},
    {num:4,name:"55515 Activation",time:"7 min",desc:"Visualize the code 55515 in luminous gold before your inner eye. Each 5 = an accelerating change in your financial reality. The central 1 = the new timeline anchoring now. Feel a wave of energy moving through your body as you hold this. Tesla: 'You are a receiver as much as a transmitter — tune yourself to the frequency of what you desire.'"},
    {num:5,name:"Future Self Download",time:"10 min",desc:"In Focus 21, meet the version of you 5 years from now who is fully financially free. They are walking, talking, and living in the reality you desire. Ask them: 'What single decision changed everything?' 'What did you stop believing?' 'What did you start doing?' Listen without filtering. The answers come from the quantum field of your own highest potential."}
  ]
};

// ═══════════════════════════ PERSISTENCE ═══════════════════════════
// V5f · Inline IndexedDB key-value wrapper — replaces the 5MB localStorage
// cap with effectively unlimited per-origin storage. Tiny on purpose: one
// store, three operations, no dependency footprint.
const idbStore=(()=>{
  const DB_NAME='gateway-protocol';
  const STORE='kv';
  let dbP=null;
  function open(){
    if(dbP) return dbP;
    dbP=new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=()=>req.result.createObjectStore(STORE);
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
    return dbP;
  }
  function tx(mode){
    return open().then(db=>db.transaction(STORE,mode).objectStore(STORE));
  }
  return {
    get:(key)=>tx('readonly').then(s=>new Promise((res,rej)=>{
      const r=s.get(key); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
    })),
    set:(key,value)=>tx('readwrite').then(s=>new Promise((res,rej)=>{
      const r=s.put(value,key); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error);
    })),
    del:(key)=>tx('readwrite').then(s=>new Promise((res,rej)=>{
      const r=s.delete(key); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error);
    })),
  };
})();

// V5f · DB rewritten to use IndexedDB primary + localStorage best-effort
// mirror. Sync load()/save() API preserved — every existing caller works
// unchanged. An in-memory cache (`_cache`) is hydrated at boot, then
// returned synchronously thereafter. Writes update cache + kick off async
// IDB write + best-effort localStorage mirror (which silently no-ops past
// the 5MB quota). On first IDB run, the existing localStorage data is
// migrated into IDB seamlessly.
const DB={
  KEY:'gateway_protocol_v1',
  IDB_KEY:'main',
  _cache:null,
  defaults(){return{sessions:0,minutes:0,streak:[],waveProgress:[0,0,0,0,0,0,0],waveCompletions:[0,0,0,0,0,0,0],journal:[],lastSeen:null,tier:0,sessionLog:[],teslaTracker:{},synchronicities:[],customAffirmations:[],customProtocols:[],moods:[],voiceCheckins:[],cameraCheckins:[]};},

  // Boot-time hydration. Called once before init() runs. Idempotent.
  async hydrate(){
    let idbVal=null;
    try{ idbVal=await idbStore.get(this.IDB_KEY); }
    catch(e){ console.warn('IDB unavailable, staying on localStorage:',e); }

    if(idbVal && typeof idbVal==='object'){
      // IDB is the source of truth
      this._cache={...this.defaults(),...idbVal};
      return;
    }
    // First run with IDB (or IDB returned nothing). Pull from localStorage
    // and seed IDB with whatever's there so future loads come from IDB.
    try{
      const raw=localStorage.getItem(this.KEY);
      const data=raw?{...this.defaults(),...JSON.parse(raw)}:this.defaults();
      this._cache=data;
      if(raw){
        idbStore.set(this.IDB_KEY,data).catch(e=>console.warn('IDB migration write failed:',e));
      }
    }catch(e){
      console.warn('localStorage hydrate failed:',e);
      this._cache=this.defaults();
    }
  },

  load(){
    // Cache populated post-hydrate. If something reads before hydrate
    // (shouldn't happen with the current boot sequence, but defensive):
    // fall back to a synchronous localStorage read so we never return null.
    if(this._cache) return this._cache;
    try{
      const raw=localStorage.getItem(this.KEY);
      return raw?{...this.defaults(),...JSON.parse(raw)}:this.defaults();
    }catch(e){ return this.defaults(); }
  },

  save(data){
    this._cache=data;
    // Primary: IndexedDB (unlimited quota, async, fire-and-forget)
    idbStore.set(this.IDB_KEY,data).catch(e=>console.warn('IDB save failed:',e));
    // Mirror: localStorage (best-effort; silently skips past 5MB cap)
    try{ localStorage.setItem(this.KEY,JSON.stringify(data)); }
    catch(e){ /* QuotaExceededError — IDB is authoritative */ }
  },

  update(patch){
    const d={...this.load(),...patch};
    this.save(d);
    return d;
  },
  addJournalEntry(entry){
    const d=this.load();
    d.journal=[...(d.journal||[]),entry];
    this.save(d);
    return d;
  },
  clear(){
    this._cache=this.defaults();
    try{ localStorage.removeItem(this.KEY); }catch(e){}
    idbStore.del(this.IDB_KEY).catch(()=>{});
  }
};

// ═══════════════════════════ PAIRING GUIDE DATA ═══════════════════════════
const PAIRINGS={
  'Morning Activation':{
    text:'Start with alpha-wave audio (8–12 Hz beat) to ease from waking beta into focused presence. Keep volume low — this session is about arrival, not depth.',
    track:'Alpha Waves — 10 Hz Binaural Beat for Morning Focus',
    brainfm:'https://brain.fm',
    youtube:'https://www.youtube.com/results?search_query=10hz+alpha+binaural+beat+morning+focus'
  },
  'Focus 10 Entry':{
    text:'Focus 10 requires crossing from alpha into theta. Use a track that starts at 10 Hz and drifts to 7 Hz over 20 minutes. Stereo headphones are required for entrainment to work.',
    track:'Alpha to Theta Descent — 10 Hz → 7 Hz Binaural',
    brainfm:'https://brain.fm',
    youtube:'https://www.youtube.com/results?search_query=alpha+theta+binaural+descent+meditation'
  },
  'Deep Coherence':{
    text:'Target theta (6–7 Hz) for expanded awareness. A stable theta carrier with a pink noise bed is ideal. Brain.fm\'s meditation mode is calibrated for this state.',
    track:'Theta Meditation — 6 Hz Binaural Beat, 40 min',
    brainfm:'https://brain.fm',
    youtube:'https://www.youtube.com/results?search_query=6hz+theta+binaural+beat+deep+meditation+40+minutes'
  },
  'Gateway Immersion':{
    text:'The full Gateway requires a slow descent: beta (18 Hz) → alpha (10 Hz) → theta (6 Hz) → deep theta (4 Hz). Use the longest binaural track you can find — minimum 60 minutes.',
    track:'Gateway Descent — Beta to Deep Theta, 60 min',
    brainfm:'https://brain.fm',
    youtube:'https://www.youtube.com/results?search_query=gateway+consciousness+binaural+beat+60+minutes+theta'
  },
  'Pain Dissolution':{
    text:'174 Hz is the Solfeggio frequency most associated with pain relief. Layer it under a 6 Hz theta binaural to reach the subconscious level where cellular reprogramming occurs.',
    track:'174 Hz Solfeggio + Theta Binaural — Pain Relief',
    brainfm:'https://brain.fm',
    youtube:'https://www.youtube.com/results?search_query=174hz+solfeggio+theta+binaural+pain+relief+healing'
  },
  'Wealth State':{
    text:'528 Hz (transformation) combined with theta binaural creates the optimal state for subconscious reprogramming. Your nervous system needs to be calm before new programs land.',
    track:'528 Hz Solfeggio + 7 Hz Theta — Abundance Programming',
    brainfm:'https://brain.fm',
    youtube:'https://www.youtube.com/results?search_query=528hz+theta+binaural+abundance+manifestation+meditation'
  },
  'Sleep Programming':{
    text:'Delta waves (1–3 Hz) carry programming into the deepest layers of the subconscious during sleep. Use a delta track that fades naturally — don\'t use a timer that cuts it off.',
    track:'Delta Sleep Programming — 2 Hz Binaural, 8 Hours',
    brainfm:'https://brain.fm',
    youtube:'https://www.youtube.com/results?search_query=delta+binaural+beat+sleep+programming+subconscious+8+hours'
  },
  'Full Integration':{
    text:'The complete journey through all four Waves. Use a professionally produced Monroe-style Hemi-Sync track. The Monroe Institute\'s own recordings are available on YouTube and Insight Timer.',
    track:'Monroe Hemi-Sync Style — Complete Gateway Journey, 90 min',
    brainfm:'https://brain.fm',
    youtube:'https://www.youtube.com/results?search_query=hemi+sync+gateway+experience+monroe+institute+90+minutes'
  },
  _default:{
    text:'Use stereo headphones with a theta binaural beat (6–8 Hz) for any Gateway session. Keep external audio at 30–40% volume so the voice guidance remains clear.',
    track:'Theta Binaural Beat — 7 Hz, 30 min',
    brainfm:'https://brain.fm',
    youtube:'https://www.youtube.com/results?search_query=7hz+theta+binaural+beat+meditation+30+minutes'
  }
};

// ═══════════════════════════ AMBIENT AUDIO ENGINE ═══════════════════════════
const AMBIENT={
  _ctx:null,
  _noiseNode:null,
  _noiseGain:null,
  _solfGain:null,
  _solfOsc:null,
  // Binaural carrier pairs — extended in V3c to add harmonic overtones
  // for a richer, more dimensional sound while preserving the entrainment
  // beat at each octave. Each pair: { L: osc, R: osc, lPan, rPan }
  _binPairs:[],
  _binGain:null,
  _merger:null,
  _masterGain:null,
  _running:false,
  _workletReady:false,
  _currentSolfHz:528,
  _currentBeatHz:6,
  noiseVol:0.35,
  solfVol:0.12,
  binVol:0.18,

  _ensureCtx(){
    if(!this._ctx)this._ctx=AUDIO_UNLOCK.track(new(window.AudioContext||window.webkitAudioContext)());
    if(this._ctx.state==='suspended')this._ctx.resume();
    return this._ctx;
  },

  // V3c: load the AudioWorklet processor once per AudioContext lifetime.
  // Failure (e.g. module 404, sandbox restriction) falls back to the legacy
  // ScriptProcessor path so playback still works.
  async _ensureWorklet(ctx){
    if(this._workletReady) return true;
    if(!ctx.audioWorklet){ console.warn('AudioWorklet unavailable, using ScriptProcessor'); return false; }
    try{
      await ctx.audioWorklet.addModule('audio-worklet.js');
      this._workletReady=true;
      return true;
    }catch(e){
      console.warn('AudioWorklet load failed:',e.message||e,'— using ScriptProcessor fallback');
      return false;
    }
  },

  // Legacy pink noise via ScriptProcessor (deprecated but still functional).
  // Kept as a fallback for the rare case the AudioWorklet module fails to load.
  _buildLegacyNoise(ctx){
    const bufferSize=4096;
    let b=[0,0,0,0,0,0,0];
    const node=ctx.createScriptProcessor(bufferSize,1,1);
    node.onaudioprocess=e=>{
      const out=e.outputBuffer.getChannelData(0);
      for(let i=0;i<bufferSize;i++){
        const w=Math.random()*2-1;
        b[0]=0.99886*b[0]+w*0.0555179;
        b[1]=0.99332*b[1]+w*0.0750759;
        b[2]=0.96900*b[2]+w*0.1538520;
        b[3]=0.86650*b[3]+w*0.3104856;
        b[4]=0.55000*b[4]+w*0.5329522;
        b[5]=-0.7616*b[5]-w*0.0168980;
        out[i]=(b[0]+b[1]+b[2]+b[3]+b[4]+b[5]+b[6]+w*0.5362)*0.11;
        b[6]=w*0.115926;
      }
    };
    return node;
  },

  // V3c: build one binaural oscillator pair (L=carrier, R=carrier+beat),
  // each routed through a hard stereo panner. Returned struct lets us
  // schedule frequency changes during the descent curve.
  _buildBinauralPair(ctx,carrier,beat,gain){
    const L=ctx.createOscillator();
    const R=ctx.createOscillator();
    L.type='sine'; R.type='sine';
    L.frequency.value=carrier;
    R.frequency.value=carrier+beat;
    const lPan=ctx.createStereoPanner();
    const rPan=ctx.createStereoPanner();
    lPan.pan.value=-1; rPan.pan.value=1;
    const g=ctx.createGain();
    g.gain.value=gain;
    L.connect(lPan); lPan.connect(g);
    R.connect(rPan); rPan.connect(g);
    L.start(); R.start();
    return { L, R, lPan, rPan, gain:g };
  },

  async start(solfHz,beatHz){
    this.stop();
    const ctx=this._ensureCtx();
    this._currentSolfHz=solfHz||528;
    this._currentBeatHz=beatHz||6;
    this._masterGain=ctx.createGain();
    this._masterGain.gain.setValueAtTime(0,ctx.currentTime);
    this._masterGain.gain.linearRampToValueAtTime(1,ctx.currentTime+3);
    this._masterGain.connect(ctx.destination);
    // V4.1: analyser tap so the particle field can pulse to the session audio
    try{ this._analyser=ctx.createAnalyser(); this._analyser.fftSize=256; this._masterGain.connect(this._analyser); }catch(e){}

    // Pink noise — V3c: prefer AudioWorklet, fall back to ScriptProcessor
    this._noiseGain=ctx.createGain();
    this._noiseGain.gain.value=this.noiseVol*0.4;
    const workletOK=await this._ensureWorklet(ctx);
    if(workletOK){
      try{ this._noiseNode=new AudioWorkletNode(ctx,'gp-pink-noise',{outputChannelCount:[2]}); }
      catch(e){ console.warn('Worklet node creation failed:',e); this._noiseNode=this._buildLegacyNoise(ctx); }
    } else {
      this._noiseNode=this._buildLegacyNoise(ctx);
    }
    this._noiseNode.connect(this._noiseGain);
    this._noiseGain.connect(this._masterGain);

    // Solfeggio tone (sine, very soft)
    this._solfOsc=ctx.createOscillator();
    this._solfGain=ctx.createGain();
    this._solfOsc.frequency.value=this._currentSolfHz;
    this._solfOsc.type='sine';
    this._solfGain.gain.value=this.solfVol*0.06;
    this._solfOsc.connect(this._solfGain);
    this._solfGain.connect(this._masterGain);
    this._solfOsc.start();

    // V3c: Binaural beat with harmonic overtones.
    // Fundamental carrier at 200 Hz preserves Monroe's original choice.
    // Octave (400 Hz) and sub-octave (100 Hz) add timbral richness while
    // the beat frequency stays identical at each layer — entrainment is
    // additive, not diluted.
    this._binGain=ctx.createGain();
    this._binGain.gain.value=this.binVol*0.12;
    this._binGain.connect(this._masterGain);
    const beat=this._currentBeatHz;
    const overtones=[
      {carrier:200,gain:1.0},   // fundamental
      {carrier:400,gain:0.45},  // octave up — adds brightness
      {carrier:100,gain:0.55},  // octave down — adds depth
    ];
    this._binPairs=overtones.map(({carrier,gain})=>{
      const pair=this._buildBinauralPair(ctx,carrier,beat,gain);
      pair.gain.connect(this._binGain);
      return pair;
    });

    this._running=true;
    this._updateStateUI();
    reactGeometry&&reactGeometry(this._currentSolfHz,true);
    FIELD_AUDIO.duck(true); // session ambient takes over — fade the field drone down
  },

  // Gradually descend binaural beat over session duration.
  // V3c: now schedules across ALL harmonic pairs so the beat stays
  // coherent at every octave (fundamental, octave up, octave down).
  scheduleDescentCurve(totalSec){
    if(!this._running||!this._binPairs.length) return;
    const ctx=this._ctx;
    const now=ctx.currentTime;
    // Beta (18Hz) → Alpha (10Hz) → Theta (6Hz) → Deep Theta (4Hz)
    const curve=[
      [0,18],[totalSec*0.1,14],[totalSec*0.25,10],
      [totalSec*0.45,7],[totalSec*0.65,6],[totalSec*0.85,4],[totalSec,4]
    ];
    this._binPairs.forEach(pair=>{
      const carrier=pair.L.frequency.value;
      curve.forEach(([t,beat])=>{
        pair.R.frequency.setValueAtTime(carrier+beat,now+t);
      });
    });
  },

  setNoise(v){
    this.noiseVol=v;
    document.getElementById('noise-val').textContent=Math.round(v*100)+'%';
    if(this._noiseGain)this._noiseGain.gain.setTargetAtTime(v*0.4,this._ctx.currentTime,0.1);
  },
  setSolfeggio(v){
    this.solfVol=v;
    document.getElementById('solf-val').textContent=Math.round(v*100)+'%';
    if(this._solfGain)this._solfGain.gain.setTargetAtTime(v*0.06,this._ctx.currentTime,0.1);
  },
  setBinaural(v){
    this.binVol=v;
    document.getElementById('bin-val').textContent=Math.round(v*100)+'%';
    if(this._binGain)this._binGain.gain.setTargetAtTime(v*0.12,this._ctx.currentTime,0.1);
  },

  stop(){
    if(!this._ctx)return;
    const ctx=this._ctx, master=this._masterGain;
    // Snapshot every source NOW, then null the instance refs immediately so a
    // start() during the fade builds fresh nodes instead of being torn down
    // by this timeout (the old code read this._* at fire time → restart race).
    const sources=[this._noiseNode,this._solfOsc];
    this._binPairs.forEach(p=>{ sources.push(p.L); sources.push(p.R); });
    this._binPairs=[];
    this._noiseNode=this._noiseGain=this._solfOsc=this._solfGain=null;
    this._binGain=this._merger=this._masterGain=null;
    this._running=false;
    this._updateStateUI();
    FIELD_AUDIO.duck(false); // session ended — let the field drone return
    try{ if(master) master.gain.linearRampToValueAtTime(0,ctx.currentTime+1.5); }catch(e){}
    setTimeout(()=>{
      sources.forEach(n=>{
        try{if(n&&n.stop)n.stop();}catch(e){}
        try{if(n&&n.disconnect)n.disconnect();}catch(e){}
      });
    },1700);
  },

  preview(){
    this.start(this._currentSolfHz||528,this._currentBeatHz||6);
    toast('Ambient layer running — use headphones for binaural effect');
  },

  _updateStateUI(){
    const el=document.getElementById('ambient-state');
    if(el)el.textContent=this._running?'Active':'Off';
    el&&(el.style.color=this._running?'var(--gold)':'var(--muted)');
  },

  updateDesc(session){
    const el=document.getElementById('ambient-desc');
    if(!el)return;
    const beatMap={
      'Morning Activation':'Alpha 10 Hz → relaxed presence',
      'Focus 10 Entry':'Alpha→Theta descent 10→7 Hz',
      'Deep Coherence':'Theta 6 Hz → expanded awareness',
      'Gateway Immersion':'Beta→Deep Theta descent 18→4 Hz',
      'Pain Dissolution':'Theta 6 Hz + 174 Hz Solfeggio',
      'Wealth State':'Theta 6 Hz + 528 Hz Solfeggio',
      'Sleep Programming':'Delta 2 Hz → deep subconscious',
      'Full Integration':'Beta→Deep Theta full descent'
    };
    const solfMap={
      'Pain Dissolution':174,'Wealth State':528,'Sleep Programming':396,
      'Morning Activation':432,'Full Integration':528
    };
    const beatHz={
      'Morning Activation':10,'Focus 10 Entry':7,'Deep Coherence':6,
      'Gateway Immersion':6,'Pain Dissolution':6,'Wealth State':6,
      'Sleep Programming':2,'Full Integration':6
    };
    this._currentSolfHz=solfMap[session.name]||528;
    this._currentBeatHz=beatHz[session.name]||6;
    el.textContent=beatMap[session.name]||'Theta 6 Hz · 528 Hz Solfeggio';
  }
};

function openPairingLink(e,a){
  e.preventDefault();
  window.open(a.href,'_blank');
  return false;
}

function showPairingGuide(session){
  const guide=document.getElementById('pairing-guide');
  if(!guide)return;
  const p=PAIRINGS[session.name]||PAIRINGS._default;
  document.getElementById('pairing-text').textContent=p.text;
  document.getElementById('pairing-track').textContent='🎧 '+p.track;
  document.getElementById('pairing-brainfm').href=p.brainfm;
  document.getElementById('pairing-youtube').href=p.youtube;
  guide.style.display='block';
  AMBIENT.updateDesc(session);
}

// ═══════════════════════════ STATE ═══════════════════════════
let timerRunning=false,timerInterval=null,timerSeconds=0,timerMax=600,selectedSess=null;
let breathRunning=false,breathTimeout=null,breathPattern=BREATH_PATTERNS[1],breathCycle=0;
let currentAffirm=0;
let activeSolf=null;
let stats=DB.load();
let audioCtx=null,oscillator=null,gainNode=null;

// ═══════════════════════════ INIT ═══════════════════════════
function init(){
  // V3a: initialize Three.js particle field FIRST. On success it sets
  // body.gp-three-ready, which hides the legacy starfield + SVG via CSS.
  // On failure (e.g. WebGL unavailable), the legacy visuals stay live. The
  // field is decorative — never let its failure abort the functional UI build.
  try { THREE_FIELD.init(); } catch(e){ console.warn('Particle field init failed — using fallback visuals:', e); }
  // Apply saved visual prefs + reconcile OS reduce-motion. Must run after
  // THREE_FIELD.init so setQuality/setCalm reach the live field.
  VISUALS.init();
  VOICE.init();
  QM.init();
  AUDIO_UNLOCK.init(); // iOS/mobile: arm the first-gesture "tap to begin" audio unlock
  // Web build: ask the browser to mark storage durable so the user's BYOK keys
  // (localStorage) survive iOS Safari's 7-day eviction. Usually granted only
  // once the PWA is installed to the Home Screen; harmless no-op otherwise.
  if(!GP_ELECTRON && navigator.storage && navigator.storage.persist){
    navigator.storage.persisted().then(p=>{ if(!p) navigator.storage.persist().catch(()=>{}); }).catch(()=>{});
  }
  KEYS.hydrate(); // populate the unified API-key fields from loaded state (web: localStorage)
  buildStars();
  buildWaves();
  buildSolfeggio();
  buildFreqBands();
  buildSessions();
  buildBreath();
  buildProtocols();
  buildAffirmations();
  buildJournal();
  buildProgress();
  buildCouncil();
  renderToday(); // default home — render once at boot (it's the active screen)
  if(typeof PALETTE!=='undefined') PALETTE.init(); // ⌘K command palette
  observeFadeIns();
  // V2 #2: wire up the adaptive session engine. init() reads cache + binds
  // buttons; request() fires an async Council call if cache stale or absent.
  PRESESSION.init();
  PRESESSION.request();
  // V4e: today's code (deterministic, no API call)
  CODE_OF_DAY.init();
  // V4d: synchronicity log render
  SYNC.init();
  // V4f: load reminder settings into the panel
  REMINDERS.init();
  // Field resonance: restore the toggle + arm gesture-gated start if enabled
  FIELD_AUDIO.init();
  // V7: network config + initial feed load when configured
  NETWORK.init().then(()=>{ if(NETWORK._cfg.serverUrl) NETWORK.loadFeed(); });
  // V7d: HRV trend render
  BIO.render();
  // V7e: certifications render
  INSTITUTE.render();
  // V7f: custom protocols list
  PROTOBUILD.render();
  // V7c: embed any pre-existing journal entries that haven't been embedded yet
  MEMORY.embedNewEntries().catch(()=>{});
  // V3: attune the atmosphere to today (Council rec / code-of-day / HRV).
  // Re-applies when the Council recommendation arrives (see PRESESSION._render).
  ATMOSPHERE.apply();
  // V3: focus mode (restore + keybind) + earned-minimalism tier attribute
  FOCUS.init();
  // V3: living-data consciousness signature (draws only when Progress is visible)
  SIGNATURE.start();
  // V3.4: orbital navigation (experimental, opt-in, press O)
  ORBITAL.init();
}

// ═══════════════════════════ STARS ═══════════════════════════
function buildStars(){
  const sf=document.getElementById('starfield');
  for(let i=0;i<200;i++){
    const s=document.createElement('div');
    s.className='star';
    const sz=Math.random()*1.5+0.5;
    s.style.cssText=`width:${sz}px;height:${sz}px;top:${Math.random()*100}%;left:${Math.random()*100}%;--dur:${3+Math.random()*5}s;--lo:${0.05+Math.random()*0.1};--hi:${0.4+Math.random()*0.6};animation-delay:${Math.random()*5}s`;
    sf.appendChild(s);
  }
}

// ═══════════════════════════ NAVIGATION ═══════════════════════════
// V3.1 · Screen navigation wrapped in the View Transitions API for a smooth
// cross-fade/morph between screens instead of an instant swap. Falls back to
// a plain swap where the API is unavailable or reduced-motion is on.
function _swapScreen(id, navBtn){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  const scr=document.getElementById('screen-'+id);
  if(scr) scr.classList.add('active');
  if(navBtn) navBtn.classList.add('active');
  // Keep the unified API-key fields current whenever Settings opens.
  if(id==='settings' && typeof KEYS!=='undefined') KEYS.hydrate();
  // Refresh the Today dashboard each time it's shown (stats/recommendation move).
  if(id==='today' && typeof renderToday==='function') renderToday();
  // Stop the biofield animation loop when navigating away (saves CPU).
  else if(typeof BIOFIELD!=='undefined') BIOFIELD.unmount();
  // V6·T9 — live collective-field poll only while the Network screen is open.
  if(typeof COLLECTIVE!=='undefined'){ if(id==='network') COLLECTIVE.start(); else COLLECTIVE.stop(); }
  window.scrollTo({top:0,behavior:'smooth'});
}

// Today dashboard: reframes the app around the core loop. Pulls from existing
// state only (DB stats/journal + the cached pre-session recommendation), so it
// never blocks on the network and degrades gracefully when there's no data yet.
function renderToday(){
  const body=document.getElementById('gp-today-body');
  if(!body) return;
  const d=DB.load();
  const h=new Date().getHours();
  const greet = h<5?'Still awake' : h<12?'Good morning' : h<18?'Good afternoon' : 'Good evening';
  const gEl=document.getElementById('gp-today-greeting'); if(gEl) gEl.textContent=greet+'.';
  const streak=(d.streak||[]).length;
  const subEl=document.getElementById('gp-today-sub');
  if(subEl) subEl.textContent = streak>0
    ? `${streak}-day streak · ${d.sessions||0} sessions · ${d.minutes||0} minutes`
    : 'Begin your practice — the field is open.';
  let rec=null;
  try{ const c=JSON.parse(localStorage.getItem('gp_presession_cache')||'null'); if(c&&c.rec) rec=c.rec; }catch(e){}
  const ROMAN=['','I','II','III','IV','V','VI','VII'];
  const recHtml = rec ? `
    <div class="gp-today-rec">${escapeHTML(rec.intention||'Your next session is ready.')}</div>
    <div class="gp-today-rec-meta">Wave ${ROMAN[rec.recommendedWave]||rec.recommendedWave||'—'}${rec.recommendedFreq?' · '+rec.recommendedFreq+' Hz':''}${rec.recommendedBreath?' · '+escapeHTML(rec.recommendedBreath):''}</div>`
  : `
    <div class="gp-today-rec">Choose a session and let the Council guide your practice.</div>
    <div class="gp-today-rec-meta">Journal a few entries to unlock a personalized recommendation.</div>`;
  const journal=d.journal||[];
  const last=journal[journal.length-1];
  let lastHtml;
  if(last){
    const when=last.date?new Date(last.date).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';
    const firstResp=(last.data||[]).map(x=>x.response).filter(Boolean)[0]||'';
    lastHtml=`<span class="when">${escapeHTML(last.session||'Journal')}${when?' · '+when:''}</span>${escapeHTML(firstResp.slice(0,160))}${firstResp.length>160?'…':''}`;
  } else {
    lastHtml=`<div class="gp-today-empty">No journal entries yet. After a session, anchor what shifted.</div>`;
  }
  const lastMood = (typeof MOOD!=='undefined') ? MOOD.latest() : null;
  const moodLine = lastMood ? `<div class="gp-today-mood-now">Last check-in: <strong>${escapeHTML(MOOD.summary(lastMood))}</strong></div>` : '';
  const presetChips = (typeof PRESETS!=='undefined') ? Object.keys(PRESETS).map(k=>
    `<button data-act="apply-preset" data-arg="${k}">${escapeHTML(PRESETS[k].label)}</button>`).join('') : '';
  // V6·T1 — attuned recommendation from the practitioner's own signals.
  const attuned = (typeof GP_STATE!=='undefined') ? GP_STATE.recommend() : null;
  const attunedHtml = attuned ? `
    <div class="gp-attuned" role="region" aria-label="Attuned recommendation">
      <div class="gp-attuned-tag">Attuned to you</div>
      <div class="gp-attuned-title">${escapeHTML(attuned.title)}</div>
      <div class="gp-attuned-because">${escapeHTML(attuned.because)}</div>
      <button class="gp-today-cta" data-act="apply-preset" data-arg="${escapeHTML(attuned.presetKey)}">Begin this →</button>
    </div>` : '';
  body.innerHTML=`
    <div class="gp-today-presets" aria-label="Quick intents">${presetChips}</div>
    <div class="gp-today-grid">
      <div class="gp-today-card">
        <h3>Today's Practice</h3>
        ${attunedHtml}
        ${recHtml}
        <button class="gp-today-cta" data-act="show" data-arg="sessions">${attuned?'Or pick another session →':'Begin a session →'}</button>
        <div class="gp-today-quick">
          <button data-act="show" data-arg="journal">Journal</button>
          <button data-act="show" data-arg="council">Council</button>
          <button data-act="show" data-arg="breath">Breathwork</button>
          <button data-act="show" data-arg="progress">Progress</button>
        </div>
      </div>
      <div class="gp-today-card">
        <h3>Your Field</h3>
        <div class="gp-today-stats">
          <div class="gp-today-stat"><div class="v">${d.sessions||0}</div><div class="l">Sessions</div></div>
          <div class="gp-today-stat"><div class="v">${d.minutes||0}</div><div class="l">Minutes</div></div>
          <div class="gp-today-stat"><div class="v">${streak}</div><div class="l">Day Streak</div></div>
        </div>
        ${moodLine}
        <h3 style="margin-top:22px">Last Entry</h3>
        <div class="gp-today-last">${lastHtml}</div>
      </div>
    </div>
    ${(typeof MOOD!=='undefined') ? MOOD.cardHtml() : ''}
    ${(typeof BIOFIELD!=='undefined') ? BIOFIELD.cardHtml() : ''}`;
  if(typeof BIOFIELD!=='undefined') BIOFIELD.mount();
}

// Mood check-in: five bipolar 1–5 self-report scales captured before practice.
// Stored locally only; honest self-report (no inference). The latest reading is
// surfaced on Today and is available to the adaptive engine / Council.
const MOOD = {
  DIMS: [
    { key:'calm',      lo:'Activated', hi:'Calm' },
    { key:'energy',    lo:'Depleted',  hi:'Energized' },
    { key:'clarity',   lo:'Foggy',     hi:'Clear' },
    { key:'openness',  lo:'Guarded',   hi:'Open' },
    { key:'grounding', lo:'Scattered', hi:'Grounded' },
  ],
  latest(){ const m=(DB.load().moods||[]); return m[m.length-1]||null; },
  cardHtml(){
    const rows = this.DIMS.map(d=>`
      <div class="gp-mood-row">
        <span class="gp-mood-lo">${d.lo}</span>
        <input type="range" min="1" max="5" step="1" value="3" id="gp-mood-${d.key}" class="gp-mood-range" aria-label="${d.lo} to ${d.hi}">
        <span class="gp-mood-hi">${d.hi}</span>
      </div>`).join('');
    return `
      <div class="gp-today-card gp-mood-card">
        <h3>How are you arriving?</h3>
        <div class="gp-mood-help">A quick, private check-in. It shapes your recommendation — nothing leaves your device.</div>
        ${rows}
        <button class="gp-today-cta" data-act="mood-save" style="margin-top:10px">Save check-in</button>
        <div class="gp-voice-affect">
          <button class="gp-voice-affect-btn" data-act="voice-affect-start">🎙 Add a voice check-in (optional)</button>
          <div id="gp-voice-affect-status" class="gp-voice-affect-status" role="status" aria-live="polite"></div>
        </div>
        <div class="gp-voice-affect">
          <button class="gp-voice-affect-btn" data-act="camera-affect-start">📷 Add a stillness check-in (optional)</button>
          <video id="gp-camera-preview" class="gp-camera-preview" muted playsinline></video>
          <div id="gp-camera-affect-status" class="gp-voice-affect-status" role="status" aria-live="polite"></div>
        </div>
      </div>`;
  },
  save(){
    const entry={ date:new Date().toISOString() };
    this.DIMS.forEach(d=>{ const el=document.getElementById('gp-mood-'+d.key); entry[d.key]=el?(parseInt(el.value,10)||3):3; });
    const dd=DB.load();
    dd.moods=[...(dd.moods||[]), entry].slice(-90);
    DB.save(dd);
    toast('Check-in saved ✓');
    if(typeof renderToday==='function') renderToday();
  },
  // Short human label of a reading — names only the dimensions at the poles.
  summary(m){
    if(!m) return '';
    const named=this.DIMS.map(d=> m[d.key]>=4?d.hi : m[d.key]<=2?d.lo : null).filter(Boolean);
    return named.length ? named.join(' · ') : 'Centered';
  }
};

// Intent presets: one tap configures session + breath for a clear intent,
// mapping to the existing SESSIONS / BREATH_PATTERNS, then lands on Sessions.
const PRESETS = {
  sleep:    { s:6, b:5, label:'Sleep' },
  reset:    { s:1, b:2, label:'Reset' },
  deepwork: { s:2, b:0, label:'Deep Work' },
  gateway:  { s:3, b:1, label:'Gateway' },
  manifest: { s:5, b:4, label:'Manifest' },
  pain:     { s:4, b:5, label:'Pain Relief' },
};
function applyPreset(key){
  const p=PRESETS[key]; if(!p) return;
  try{ if(typeof selectSessionByIndex==='function') selectSessionByIndex(p.s); }catch(e){}
  try{ if(typeof setBreath==='function') setBreath(p.b); }catch(e){}
  if(typeof showScreen==='function') showScreen('sessions');
  toast(p.label+' loaded · press Begin');
}

// ═══════════════ ON-DEVICE VOICE CHECK-IN (affect signals) ═══════════════
// Optional, consent-gated, 100% on-device. Captures a short mic sample via the
// Web Audio API and derives transparent acoustic features (energy, pitch range,
// pace). No raw audio is recorded, stored, or transmitted — only the derived
// numbers, and only if the user keeps the result. NOT medical/diagnostic; the
// state is a guess the practitioner confirms or rejects.
const VOICE_AFFECT = {
  CONSENT_KEY:'gp_voice_affect_consent',
  DURATION_MS:8000,
  FRAME_MS:60,
  _running:false,
  _lastResult:null,
  hasConsent(){ try{ return localStorage.getItem(this.CONSENT_KEY)==='1'; }catch(e){ return false; } },
  grantConsent(){ try{ localStorage.setItem(this.CONSENT_KEY,'1'); }catch(e){} },

  // Pure analysis — unit-testable without a microphone. `frames.rms` is per-frame
  // loudness (0..1), `frames.pitch` is per-frame dominant Hz (0 when unvoiced).
  _analyze(frames){
    const rms=frames.rms||[], pitch=frames.pitch||[];
    const n=rms.length||1;
    const energy=rms.reduce((a,b)=>a+b,0)/n;
    const voiced=pitch.filter((p,i)=>p>0 && (rms[i]||0)>0.04);
    let pitchRange=0, pitchMean=0;
    if(voiced.length){
      const mn=Math.min(...voiced), mx=Math.max(...voiced);
      pitchRange=mx-mn; pitchMean=voiced.reduce((a,b)=>a+b,0)/voiced.length;
    }
    const thr=Math.max(0.05, energy*0.8); let onsets=0;
    for(let i=1;i<rms.length;i++){ if(rms[i-1]<thr && rms[i]>=thr) onsets++; }
    const secs=(rms.length*(frames.dt||this.FRAME_MS))/1000 || 1;
    const tempo=onsets/secs;
    const energyL = energy>0.18?'high energy' : energy<0.07?'low energy' : 'steady energy';
    const paceL   = tempo>2.2?'fast pace' : tempo<0.9?'slow pace' : 'even pace';
    const pitchL  = pitchRange>120?'wide pitch range' : pitchRange<40?'narrow pitch range' : 'moderate pitch range';
    let guess='balanced';
    if(energy<0.07 && tempo<0.9) guess='calm or tired';
    else if(energy>0.18 && tempo>2.2) guess='energized or activated';
    else if(pitchRange<40 && energy<0.1) guess='subdued';
    else if(pitchRange>120) guess='expressive';
    return {
      energy:+energy.toFixed(3), pitchMeanHz:Math.round(pitchMean), pitchRangeHz:Math.round(pitchRange),
      tempo:+tempo.toFixed(2), labels:[energyL,paceL,pitchL], guess
    };
  },

  async start(){
    if(this._running) return;
    if(!this.hasConsent()){ this._showConsent(); return; }
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ toast('Microphone not available on this device.'); return; }
    let stream;
    try{ stream=await navigator.mediaDevices.getUserMedia({audio:true}); }
    catch(e){ this._setStatus(''); toast('Microphone permission denied.'); return; }
    this._running=true;
    this._setStatus("Listening… speak what you're bringing into this session.");
    const AC=window.AudioContext||window.webkitAudioContext;
    const ctx=new AC();
    const src=ctx.createMediaStreamSource(stream);
    const an=ctx.createAnalyser(); an.fftSize=2048; src.connect(an);
    const td=new Float32Array(an.fftSize);
    const fd=new Uint8Array(an.frequencyBinCount);
    const binHz=ctx.sampleRate/an.fftSize;
    const lo=Math.floor(80/binHz), hi=Math.ceil(400/binHz);
    const rms=[], pitch=[];
    const tick=()=>{
      an.getFloatTimeDomainData(td);
      let s=0; for(let i=0;i<td.length;i++) s+=td[i]*td[i];
      rms.push(Math.sqrt(s/td.length));
      an.getByteFrequencyData(fd);
      let maxV=0,maxBin=0;
      for(let b=lo;b<=hi && b<fd.length;b++){ if(fd[b]>maxV){ maxV=fd[b]; maxBin=b; } }
      pitch.push(maxV>40 ? Math.round(maxBin*binHz) : 0);
    };
    const iv=setInterval(tick,this.FRAME_MS);
    setTimeout(()=>{
      clearInterval(iv);
      try{ stream.getTracks().forEach(t=>t.stop()); ctx.close(); }catch(e){}
      this._running=false;
      this._showResult(this._analyze({rms,pitch,dt:this.FRAME_MS}));
    }, this.DURATION_MS);
  },

  _setStatus(html){ const el=document.getElementById('gp-voice-affect-status'); if(el) el.innerHTML=html; },
  _showConsent(){
    this._setStatus('Voice check-in runs <strong>entirely on your device</strong> — no audio is recorded, stored, or sent. It reads tone, energy, and pace only, and is not medical. <button data-act="voice-affect-consent" class="gp-link">Enable &amp; start</button>');
  },
  _showResult(r){
    this._lastResult=r;
    this._setStatus(`Measured from your voice: <strong>${r.labels.join(' · ')}</strong>. This sounds like <strong>${escapeHTML(r.guess)}</strong> — <button data-act="voice-affect-confirm" class="gp-link">that fits</button> · <button data-act="voice-affect-discard" class="gp-link">not quite</button>`);
  },
  confirm(){
    const r=this._lastResult; if(!r) return;
    const dd=DB.load();
    dd.voiceCheckins=[...(dd.voiceCheckins||[]), {date:new Date().toISOString(), ...r}].slice(-60);
    DB.save(dd);
    this._lastResult=null;
    this._setStatus('Saved ✓ — woven into your next recommendation.');
    toast('Voice check-in saved ✓');
  },
  discard(){ this._lastResult=null; this._setStatus('Discarded. Nothing was saved.'); },
  latest(){ const v=(DB.load().voiceCheckins||[]); return v[v.length-1]||null; }
};

// ═══════════════ ON-DEVICE CAMERA CHECK-IN (stillness / presence) ═══════════════
// Optional, consent-gated, 100% on-device. Reads MOVEMENT and STILLNESS via
// low-res frame differencing — honestly a settledness proxy, NOT facial emotion
// recognition (that would need a bundled ML model and is far less reliable). No
// frames are recorded, stored, or transmitted; only the derived numbers persist,
// and only on confirm. A live preview + "camera on" indicator stay visible while
// it reads. NOT medical/diagnostic.
const CAMERA_AFFECT = {
  CONSENT_KEY:'gp_camera_affect_consent',
  DURATION_MS:8000,
  FRAME_MS:100,
  W:64, H:48,
  _running:false,
  _lastResult:null,
  hasConsent(){ try{ return localStorage.getItem(this.CONSENT_KEY)==='1'; }catch(e){ return false; } },
  grantConsent(){ try{ localStorage.setItem(this.CONSENT_KEY,'1'); }catch(e){} },

  // Pure analysis — unit-testable. `frames.motion` is per-frame mean absolute
  // pixel difference (0..1); `frames.brightness` is per-frame mean luma (0..1).
  // FUTURE (V6·T3 full): a MediaPipe FaceLandmarker provider can populate
  // frames.landmarks (head pose, blink, gaze) and feed richer affect here.
  // Bundling it needs vendored WASM/model assets + 'wasm-unsafe-eval' in the
  // CSP (a deliberate security trade-off) + real-device validation — tracked
  // in V6_ROADMAP.md · T3. Until then we derive honest, model-free signals.
  _analyze(frames){
    const motion=frames.motion||[], bright=frames.brightness||[];
    const mean=(a)=> a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;
    const mMean = mean(motion);
    const bMean = mean(bright);
    // Presence is more robust as "lit in a majority of frames" than a single mean.
    const presenceRatio = bright.length ? bright.filter(b=>b>0.06).length/bright.length : 0;
    const present = presenceRatio > 0.5;
    // Fidget = burstiness of motion (std-dev), distinct from overall amount.
    const variance = motion.length ? motion.reduce((a,b)=>a+(b-mMean)*(b-mMean),0)/motion.length : 0;
    const fidget = gpClamp01(Math.sqrt(variance)*12);
    const stillness = gpClamp01(1 - mMean*8);              // small diffs => very still
    const moveL  = mMean<0.012 ? 'very still' : mMean>0.05 ? 'lots of movement' : 'some movement';
    const fidgetL = fidget>0.5 ? 'restless' : fidget<0.2 ? 'steady' : 'somewhat settled';
    let guess;
    if(!present) guess='camera sees little — low light or out of frame';
    else if(stillness>0.8 && fidget<0.3) guess='settled and grounded';
    else if(fidget>0.5 || stillness<0.4) guess='restless or activated';
    else guess='gently present';
    return { stillness:+stillness.toFixed(3), motion:+mMean.toFixed(4), brightness:+bMean.toFixed(3),
             fidget:+fidget.toFixed(3), presenceRatio:+presenceRatio.toFixed(3), present,
             labels:[moveL, fidgetL, present?'present':'low presence'], guess };
  },

  async start(){
    if(this._running) return;
    if(!this.hasConsent()){ this._showConsent(); return; }
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ toast('Camera not available on this device.'); return; }
    let stream;
    try{ stream=await navigator.mediaDevices.getUserMedia({video:{width:320,height:240}}); }
    catch(e){ this._setStatus(''); toast('Camera permission denied.'); return; }
    this._running=true;
    const video=document.getElementById('gp-camera-preview');
    if(video){ video.srcObject=stream; video.classList.add('on'); try{ await video.play(); }catch(e){} }
    this._setStatus('<span class="gp-cam-dot" aria-hidden="true"></span>Camera on — sit naturally for a few seconds…');
    const cv=document.createElement('canvas'); cv.width=this.W; cv.height=this.H;
    const cctx=cv.getContext('2d', { willReadFrequently:true });
    const motion=[], brightness=[]; let prev=null;
    const tick=()=>{
      try{ cctx.drawImage(video, 0,0, this.W, this.H); }catch(e){ return; }
      const img=cctx.getImageData(0,0,this.W,this.H).data;
      const px=img.length/4;
      const cur=new Float32Array(px);
      let sum=0, diff=0;
      for(let i=0,j=0;i<img.length;i+=4,j++){
        const lum=(img[i]*0.299+img[i+1]*0.587+img[i+2]*0.114)/255;
        cur[j]=lum; sum+=lum;
        if(prev) diff+=Math.abs(lum-prev[j]);
      }
      brightness.push(sum/px);
      if(prev) motion.push(diff/px);
      prev=cur;
    };
    const iv=setInterval(tick,this.FRAME_MS);
    setTimeout(()=>{
      clearInterval(iv);
      try{ stream.getTracks().forEach(t=>t.stop()); }catch(e){}
      if(video){ video.srcObject=null; video.classList.remove('on'); }
      this._running=false;
      this._showResult(this._analyze({motion,brightness}));
    }, this.DURATION_MS);
  },

  _setStatus(html){ const el=document.getElementById('gp-camera-affect-status'); if(el) el.innerHTML=html; },
  _showConsent(){
    this._setStatus('The camera check-in runs <strong>entirely on your device</strong> — no images are recorded, stored, or sent. It reads only movement and stillness (a settledness cue), not facial emotion, and is not medical. <button data-act="camera-affect-consent" class="gp-link">Enable &amp; start</button>');
  },
  _showResult(r){
    this._lastResult=r;
    this._setStatus(`Measured from movement: <strong>${r.labels.join(' · ')}</strong>. This reads as <strong>${escapeHTML(r.guess)}</strong> — <button data-act="camera-affect-confirm" class="gp-link">that fits</button> · <button data-act="camera-affect-discard" class="gp-link">not quite</button>`);
  },
  confirm(){
    const r=this._lastResult; if(!r) return;
    const dd=DB.load();
    dd.cameraCheckins=[...(dd.cameraCheckins||[]), {date:new Date().toISOString(), ...r}].slice(-60);
    DB.save(dd);
    this._lastResult=null;
    this._setStatus('Saved ✓ — woven into your biofield and next recommendation.');
    toast('Stillness check-in saved ✓');
  },
  discard(){ this._lastResult=null; this._setStatus('Discarded. Nothing was saved.'); },
  latest(){ const v=(DB.load().cameraCheckins||[]); return v[v.length-1]||null; }
};

// ═══════════════ BIOFIELD VISUALIZATION (honest, derived) ═══════════════
// NOT a measured aura — a transparent, on-brand rendering DERIVED from the
// practitioner's own check-ins. Hue follows valence, radius/density follow
// energy, pulse rate follows arousal. Always labeled "derived visualization"
// with an explicit legend. Pure 2D canvas (no WebGL), so it runs everywhere.
const gpClamp01 = (x)=> Math.max(0, Math.min(1, isFinite(x)?x:0));
const BIOFIELD = {
  _raf:null, _canvas:null, _ctx:null, _t:0,
  // Normalize the latest mood + voice check-ins into a 0..1 state.
  state(){
    let arousal=0.5, valence=0.5, energy=0.4;
    try{
      const m=(typeof MOOD!=='undefined')?MOOD.latest():null;
      if(m){
        energy=(m.energy-1)/4;
        valence=((m.calm-1)/4)*0.5 + ((m.openness-1)/4)*0.5;
        arousal=1-((m.calm-1)/4);
      }
      const v=(typeof VOICE_AFFECT!=='undefined')?VOICE_AFFECT.latest():null;
      if(v){ energy=Math.max(energy, gpClamp01(v.energy/0.3)); arousal=Math.max(arousal, gpClamp01(v.tempo/4)); }
      const c=(typeof CAMERA_AFFECT!=='undefined')?CAMERA_AFFECT.latest():null;
      if(c && c.present){ arousal=gpClamp01(arousal*(1-0.5*c.stillness)); } // physical stillness settles arousal
    }catch(e){}
    return { arousal:gpClamp01(arousal), valence:gpClamp01(valence), energy:gpClamp01(energy) };
  },
  cardHtml(){
    const hasData = (typeof MOOD!=='undefined' && MOOD.latest()) || (typeof VOICE_AFFECT!=='undefined' && VOICE_AFFECT.latest());
    return `<div class="gp-today-card gp-biofield-card">
      <h3>Your Biofield <span class="gp-derived">derived visualization</span></h3>
      <canvas id="gp-biofield" width="640" height="240" class="gp-biofield-canvas" aria-label="A visualization derived from your latest check-ins"></canvas>
      <div class="gp-biofield-legend">${hasData
        ? 'Hue follows valence (calm &amp; open → gold; tense → cool blue) · radius &amp; density follow energy · pulse rate follows arousal. Rendered from your latest check-in — it is an interpretation, not a measurement.'
        : 'Save a mood or voice check-in above to render your biofield. It is a visualization derived from your own signals — not a measured aura.'}</div>
    </div>`;
  },
  mount(){
    this._canvas=document.getElementById('gp-biofield'); if(!this._canvas) return;
    this._ctx=this._canvas.getContext('2d'); if(!this._ctx) return;
    const s=this.state();
    const reduced = document.body.classList.contains('gp-reduced') ||
      (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    cancelAnimationFrame(this._raf); this._raf=null;
    if(reduced){ this._draw(s,0); return; }
    const loop=()=>{ this._t+=0.016; this._draw(s,this._t); this._raf=requestAnimationFrame(loop); };
    loop();
  },
  unmount(){ if(this._raf){ cancelAnimationFrame(this._raf); this._raf=null; } },
  _draw(s,t){
    const ctx=this._ctx, w=this._canvas.width, h=this._canvas.height, cx=w/2, cy=h/2;
    ctx.clearRect(0,0,w,h);
    const pulse=1+0.07*Math.sin(t*(1+s.arousal*3));
    const rings=4+Math.round(s.energy*6);
    const baseR=(20+s.energy*34)*pulse;
    const hue=220-(s.valence*175);                       // cool blue → gold
    for(let i=rings;i>=1;i--){
      const r=baseR*(i/rings)*3.0;
      const a=(0.04+0.10*(1-i/rings))*(0.55+0.45*s.energy);
      ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
      ctx.fillStyle=`hsla(${hue.toFixed(0)},70%,60%,${a.toFixed(3)})`; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(cx,cy,baseR*0.55,0,Math.PI*2);
    ctx.fillStyle=`hsla(${hue.toFixed(0)},85%,72%,0.55)`; ctx.fill();
  }
};

// ═══════════════ ADAPTIVE PRACTICE ENGINE 2.0 (V6·T1) ═══════════════
// One shared state model fusing the practitioner's own check-ins (mood +
// voice + stillness) into a transparent recommendation with a "because…"
// rationale and a one-tap apply. Pure read of local state — no network, and
// every input is labeled by source so nothing is a black box.
const GP_STATE = {
  // {arousal,valence,energy} from the same fusion the biofield uses, plus the
  // contributing sources (for the rationale) and a coherence proxy.
  compute(){
    const base = (typeof BIOFIELD!=='undefined') ? BIOFIELD.state() : {arousal:0.5,valence:0.5,energy:0.4};
    const sources=[]; let coherence=null;
    try{
      const m=(typeof MOOD!=='undefined')?MOOD.latest():null;
      if(m) sources.push({ kind:'self-report', label:MOOD.summary(m) });
      const v=(typeof VOICE_AFFECT!=='undefined')?VOICE_AFFECT.latest():null;
      if(v) sources.push({ kind:'voice', label:(v.labels||[]).join(', ') });
      const c=(typeof CAMERA_AFFECT!=='undefined')?CAMERA_AFFECT.latest():null;
      if(c){ if(c.present) coherence=c.stillness; sources.push({ kind:'stillness', label:(c.labels||[]).join(', ') }); }
    }catch(e){}
    return { ...base, coherence, sources };
  },
  // Map the state vector → a recommended intent preset + plain-language reason.
  // Returns null when there are no signals yet (so the UI can stay quiet).
  recommend(){
    const s=this.compute();
    if(!s.sources.length) return null;
    let presetKey, title;
    if(s.arousal>0.6 && s.valence<0.45){ presetKey='reset';    title='Grounding reset'; }
    else if(s.arousal>0.78){            presetKey='sleep';     title='Settle & rest'; }
    else if(s.energy<0.35){             presetKey='deepwork';  title='Gentle activation'; }
    else if(s.valence>0.6 && s.energy>0.6){ presetKey='manifest'; title='Manifestation'; }
    else {                              presetKey='gateway';   title='Gateway training'; }
    const because = 'Because your ' + s.sources.map(x=>`${x.kind} read “${x.label}”`).join(' and ') + '.';
    return { presetKey, title, because, state:s };
  }
};

// ═══════════════ COMMAND PALETTE (⌘K / Ctrl+K) — V6·T5 ═══════════════
// Fast keyboard navigation + actions. Accessible combobox/listbox with
// arrow-key selection, Enter to run, Esc to close, focus restore.
const PALETTE = {
  _open:false, _items:[], _filtered:[], _sel:0, _prevFocus:null, _wired:false,
  _build(){
    const items=[];
    [['today','Today'],['sessions','Sessions'],['journal','Journal'],['council','Council'],['progress','Progress'],['waves','Waves I–VII'],['solfeggio','Solfeggio'],['breath','Breathwork'],['protocols','Protocols'],['affirmations','Affirmations'],['synchronicity','Synchronicity'],['network','Network'],['settings','Settings']]
      .forEach(([id,label])=>items.push({label:'Go to '+label, hint:'Navigate', run:()=>showScreen(id)}));
    if(typeof PRESETS!=='undefined') Object.keys(PRESETS).forEach(k=>items.push({label:PRESETS[k].label+' session', hint:'Preset', run:()=>applyPreset(k)}));
    items.push({label:'Voice check-in', hint:'On-device', run:()=>{ showScreen('today'); setTimeout(()=>{ try{ VOICE_AFFECT.start(); }catch(e){} },60); }});
    items.push({label:'Stillness check-in', hint:'On-device', run:()=>{ showScreen('today'); setTimeout(()=>{ try{ CAMERA_AFFECT.start(); }catch(e){} },60); }});
    items.push({label:'Shadow dialogue', hint:'Council', run:()=>{ try{ SHADOW.open(); }catch(e){} }});
    return items;
  },
  init(){
    if(this._wired) return; this._wired=true;
    document.addEventListener('keydown',(e)=>{
      if((e.metaKey||e.ctrlKey) && (e.key==='k'||e.key==='K')){ e.preventDefault(); this.toggle(); return; }
      if(!this._open) return;
      if(e.key==='Escape'){ e.preventDefault(); this.close(); }
      else if(e.key==='ArrowDown'){ e.preventDefault(); this._move(1); }
      else if(e.key==='ArrowUp'){ e.preventDefault(); this._move(-1); }
      else if(e.key==='Enter'){ e.preventDefault(); this._exec(); }
    });
    const inp=document.getElementById('gp-palette-input');
    if(inp) inp.addEventListener('input',(e)=>this._filter(e.target.value));
    const list=document.getElementById('gp-palette-list');
    if(list) list.addEventListener('click',(e)=>{ const it=e.target.closest('.gp-palette-item'); if(it){ this._sel=parseInt(it.dataset.i,10)||0; this._exec(); } });
    const ov=document.getElementById('gp-palette');
    if(ov) ov.addEventListener('click',(e)=>{ if(e.target===ov) this.close(); }); // click backdrop to dismiss
  },
  open(){
    if(this._open) return; this._open=true;
    this._items=this._build(); this._prevFocus=document.activeElement;
    const ov=document.getElementById('gp-palette'); if(!ov){ this._open=false; return; }
    ov.classList.add('show'); ov.setAttribute('aria-hidden','false');
    const inp=document.getElementById('gp-palette-input'); if(inp){ inp.value=''; }
    this._filter('');
    setTimeout(()=>{ if(inp) inp.focus(); },0);
  },
  close(){
    if(!this._open) return; this._open=false;
    const ov=document.getElementById('gp-palette'); if(ov){ ov.classList.remove('show'); ov.setAttribute('aria-hidden','true'); }
    if(this._prevFocus && this._prevFocus.focus){ try{ this._prevFocus.focus(); }catch(e){} }
  },
  toggle(){ this._open?this.close():this.open(); },
  _filter(q){
    q=(q||'').toLowerCase().trim();
    this._filtered = q ? this._items.filter(it=>it.label.toLowerCase().includes(q)) : this._items.slice();
    this._sel=0; this._render();
  },
  _render(){
    const list=document.getElementById('gp-palette-list'); if(!list) return;
    if(!this._filtered.length){ list.innerHTML='<div class="gp-palette-empty">No matches</div>'; return; }
    list.innerHTML=this._filtered.map((it,i)=>`<div class="gp-palette-item${i===this._sel?' sel':''}" role="option" id="gp-pal-opt-${i}" data-i="${i}" aria-selected="${i===this._sel?'true':'false'}"><span>${escapeHTML(it.label)}</span><span class="gp-palette-hint">${escapeHTML(it.hint||'')}</span></div>`).join('');
  },
  _move(d){ if(!this._filtered.length) return; this._sel=(this._sel+d+this._filtered.length)%this._filtered.length; this._render(); const el=document.getElementById('gp-pal-opt-'+this._sel); if(el&&el.scrollIntoView) el.scrollIntoView({block:'nearest'}); },
  _exec(){ const it=this._filtered[this._sel]; if(!it) return; this.close(); try{ it.run(); }catch(e){} }
};
function _navTo(id, navBtn){
  const reduced=document.body.classList.contains('gp-reduced')||
    (window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if(document.startViewTransition && !reduced){
    document.body.classList.add('gp-vt'); // suppress the per-screen rise during the VT
    const vt=document.startViewTransition(()=>_swapScreen(id,navBtn));
    vt.finished.finally(()=>document.body.classList.remove('gp-vt'));
  } else {
    _swapScreen(id,navBtn);
  }
}
function show(id, clickedBtn){
  // Capture the clicked nav button NOW — the VT callback runs async, after
  // the global `event` is gone.
  const btn=clickedBtn || ((typeof event!=='undefined' && event) ? event.target : null);
  _navTo(id, btn);
}
// V6d: programmatic version for inline links / non-click callers.
function showScreen(id){
  const btn=Array.from(document.querySelectorAll('.nav-btn')).find(b=>b.dataset.arg===id);
  _navTo(id, btn);
}

// ═══════════════════════════ WAVES ═══════════════════════════
// Wave unlock requirements — completions of previous wave needed
const WAVE_REQS=[0,3,5,7,5,5,3];

function isWaveUnlocked(i){
  if(i===0)return true;
  const {waveCompletions=[]}=DB.load();
  return(waveCompletions[i-1]||0)>=WAVE_REQS[i];
}

function getWaveTier(i){
  const {waveCompletions=[]}=DB.load();
  return waveCompletions[i]||0;
}

function buildWaves(){
  const list=document.getElementById('wave-list');
  list.innerHTML=WAVES.map((w,i)=>{
    const unlocked=isWaveUnlocked(i);
    const done=getWaveTier(i>0?i-1:0);
    const needed=WAVE_REQS[i];
    const lockMsg=i>0&&!unlocked?`Complete Wave ${i} × ${needed} to unlock (${i>0?(DB.load().waveCompletions||[])[i-1]||0:0}\/${needed} done)`:'';
    return`
  <div class="wave-card fade-in${unlocked?'':' wave-locked'}" id="wave-${i}" data-act="toggle-wave" data-id="${i}" data-unlocked="${unlocked}" role="button" tabindex="0" aria-label="Wave ${w.id}: ${w.name}${unlocked?'':' (locked)'}">
    <div class="wave-head">
      <div class="wave-num" style="opacity:${unlocked?1:0.3}">${w.id}</div>
      <div class="wave-info">
        <div class="wave-name" style="opacity:${unlocked?1:0.45}">${w.name}</div>
        <div class="wave-sub">${unlocked?w.subtitle:lockMsg}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        ${unlocked?`<div class="wave-code">${w.code}</div><div class="wave-chevron">⌞</div>`:`<div style="font-size:18px;opacity:.25">&#128274;</div>`}
      </div>
    </div>
    ${unlocked?`
    <div class="wave-body">
      <div class="wave-intent">${w.intent}</div>
      <div class="phase-list">
        ${w.phases.map(p=>`
        <div class="phase">
          <div class="phase-head">
            <div class="phase-name">${p.name}</div>
            <div class="phase-freq">${p.freq}</div>
          </div>
          <div class="phase-desc">${p.desc}</div>
          <div class="phase-dur">⏱ ${p.dur}</div>
        </div>`).join('')}
      </div>
      <button class="wave-start-btn" data-act="start-wave" data-id="${i}" data-stop="true">Enter Wave ${w.id} →</button>
    </div>`:''}
  </div>`;
  }).join('');
}

function toggleWave(i,unlocked){
  if(!unlocked){toast('Complete the previous Wave the required number of times to unlock this level.');return;}
  const el=document.getElementById('wave-'+i);
  const isOpen=el.classList.contains('open');
  document.querySelectorAll('.wave-card').forEach(c=>c.classList.remove('open'));
  if(!isOpen)el.classList.add('open');
}

function startWave(i){
  const w=WAVES[i];
  const totalMin=w.phases.reduce((a,p)=>a+parseInt(p.dur),0);
  const sess={name:w.name,dur:totalMin,icon:'◈',phases:w.phases.map(p=>p.name),waveIndex:i};
  selectSession(sess);
  show('sessions');
  document.querySelectorAll('.nav-btn')[2].classList.add('active');
  document.querySelectorAll('.nav-btn').forEach((b,j)=>{if(j!==2)b.classList.remove('active')});
  toast('Wave '+(i+1)+' loaded → Session tab');
}

function recordWaveCompletion(waveIndex){
  const d=DB.load();
  if(!d.waveCompletions)d.waveCompletions=[0,0,0,0,0,0,0];
  d.waveCompletions[waveIndex]=(d.waveCompletions[waveIndex]||0)+1;
  DB.save(d);
  stats=d;
  buildWaves();
  updateStats();
  checkTierUnlock();
  toast('Wave '+(waveIndex+1)+' complete ✔ ('+(d.waveCompletions[waveIndex])+'x)');
}

// ═══════════════════════════ SOLFEGGIO ═══════════════════════════
function buildSolfeggio(){
  const g=document.getElementById('solf-grid');
  g.innerHTML=SOLFEGGIO.map((s,i)=>`
  <div class="solf-card fade-in" id="solf-${i}" data-act="toggle-solf" data-id="${i}" data-hz="${s.hz}" role="button" tabindex="0" aria-label="${s.hz} Hz — ${s.name}">
    <div class="solf-hz">${s.hz}</div>
    <div class="solf-name">${s.name}</div>
    <div class="solf-effect">${s.effect}</div>
    <div class="solf-playing" id="solf-play-${i}"></div>
  </div>`).join('');
  buildAudioBars();
}

function buildAudioBars(){
  const ab=document.getElementById('audio-bars');
  if(!ab)return;
  ab.innerHTML=Array.from({length:20},(_,i)=>
    `<div class="ab" id="ab-${i}" style="--d:${0.3+Math.random()*0.4}s;--h:${8+Math.random()*28}px;height:4px;animation-delay:${i*0.05}s"></div>`
  ).join('');
}

function reactGeometry(hz,active){
  // V3a: drive the Three.js field with frequency changes
  THREE_FIELD.setFrequency(hz,active);
  FIELD_AUDIO.setFrequency(hz,active); // Field resonance: pitch tracks the active frequency
  const geo=document.getElementById('geo-bg');
  if(!geo)return;
  if(!active){
    geo.style.animationDuration='120s';
    geo.style.opacity='0.04';
    geo.style.transform='translate(-50%,-50%) scale(1)';
    return;
  }
  // Map Hz to rotation speed: 174Hz=slow/grounding, 963Hz=fast/transcendent
  const minHz=174,maxHz=963;
  const norm=(hz-minHz)/(maxHz-minHz);
  const speed=Math.round(120-(norm*95)); // 120s → 25s
  const opacity=0.04+(norm*0.07);
  const scale=1+(norm*0.08);
  geo.style.animationDuration=speed+'s';
  geo.style.opacity=opacity;
  geo.style.transform=`translate(-50%,-50%) scale(${scale})`;
  // Pulse on activation
  geo.style.transition='opacity 2s ease, transform 2s ease';
}

function toggleSolf(i,hz){
  if(activeSolf===i){stopSolf();reactGeometry(hz,false);return;}
  stopSolf();
  activeSolf=i;
  document.getElementById('solf-'+i).classList.add('active');
  document.getElementById('solf-play-'+i).textContent='♦ Playing';
  document.querySelectorAll('.ab').forEach(b=>b.classList.add('playing'));
  reactGeometry(hz,true);
  if(!audioCtx)audioCtx=AUDIO_UNLOCK.track(new(window.AudioContext||window.webkitAudioContext)());
  if(audioCtx.state==='suspended')audioCtx.resume();
  oscillator=audioCtx.createOscillator();
  gainNode=audioCtx.createGain();
  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  oscillator.frequency.setValueAtTime(hz,audioCtx.currentTime);
  oscillator.type='sine';
  gainNode.gain.setValueAtTime(0,audioCtx.currentTime);
  gainNode.gain.linearRampToValueAtTime(0.15,audioCtx.currentTime+2);
  oscillator.start();
}

function stopSolf(){
  if(oscillator && gainNode && audioCtx){
    // Capture the live nodes in locals. The old code nulled `oscillator`
    // before the timeout fired, so the deferred .stop() hit null (or, if a
    // new tone had started, stopped the WRONG oscillator) — the tone never
    // actually stopped and the node leaked. Locals + disconnect fix both.
    const osc=oscillator, g=gainNode, t=audioCtx.currentTime;
    try{
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t+0.4);
    }catch(e){}
    setTimeout(()=>{
      try{ osc.stop(); }catch(e){}
      try{ osc.disconnect(); }catch(e){}
      try{ g.disconnect(); }catch(e){}
    }, 480);
    oscillator=null; gainNode=null;
  }
  if(activeSolf!==null){
    const el=document.getElementById('solf-'+activeSolf);
    if(el) el.classList.remove('active');
    const pl=document.getElementById('solf-play-'+activeSolf);
    if(pl) pl.textContent='';
    activeSolf=null;
  }
  document.querySelectorAll('.ab').forEach(b=>b.classList.remove('playing'));
}

function buildFreqBands(){
  const bands=[
    {name:"Delta  0–4 Hz",state:"Deep healing · OBE",pct:15},
    {name:"Theta  4–8 Hz",state:"Gateway states",pct:30},
    {name:"Alpha  8–12 Hz",state:"Relaxed focus",pct:55},
    {name:"Beta  12–30 Hz",state:"Normal waking",pct:78},
    {name:"Gamma  30–100 Hz",state:"Peak performance",pct:95}
  ];
  const el=document.getElementById('freq-bands');
  el.innerHTML=bands.map(b=>`
  <div class="band-row">
    <div class="band-name">${b.name.split(' ')[0]}<br><span style="color:#3a3428;font-size:14px">${b.name.split(' ').slice(1).join(' ')}</span></div>
    <div class="band-track"><div class="band-fill" style="width:0%" data-w="${b.pct}%"></div></div>
    <div class="band-state" style="font-size:14px">${b.state}</div>
  </div>`).join('');
  setTimeout(()=>document.querySelectorAll('.band-fill').forEach(f=>f.style.width=f.dataset.w),400);
}

// ═══════════════════════════ SESSIONS ═══════════════════════════
function buildSessions(){
  const g=document.getElementById('session-grid');
  g.innerHTML=SESSIONS.map((s,i)=>`
  <div class="sess-card fade-in" id="sess-${i}" data-act="select-session-index" data-id="${i}" role="button" tabindex="0" aria-label="Select session: ${s.name}, ${s.dur} minutes">
    <div class="sess-icon">${s.icon}</div>
    <div class="sess-name">${s.name}</div>
    <div class="sess-dur">${s.dur} min</div>
  </div>`).join('');
}

function selectSessionByIndex(i){
  selectSession(SESSIONS[i]);
  document.querySelectorAll('.sess-card').forEach(c=>c.classList.remove('selected'));
  document.getElementById('sess-'+i).classList.add('selected');
}

// ═══════════════════════════ VOICE GUIDANCE ENGINE ═══════════════════════════
// ── ElevenLabs voice catalogue — curated for meditation/guidance ──
// ── Voice catalogues ──
const EL_VOICES=[
  {id:'pNInz6obpgDQGcFmaJgB',name:'Adam',desc:'Deep · Authoritative · Male'},
  {id:'21m00Tcm4TlvDq8ikWAM',name:'Rachel',desc:'Calm · Warm · Female'},
  {id:'EXAVITQu4vr4xnSDxMaL',name:'Bella',desc:'Soft · Soothing · Female'},
  {id:'ErXwobaYiN019PkySvjV',name:'Antoni',desc:'Smooth · Grounded · Male'},
  {id:'TxGEqnHWrfWFTfGW9XjX',name:'Josh',desc:'Warm · Deep · Male'},
  {id:'g5CIjZEefAph4nQFvHAz',name:'Matilda',desc:'Nurturing · Serene · Female'},
  {id:'onwK4e9ZLuTAKqWW03F9',name:'Daniel',desc:'Refined · British · Male'},
  {id:'XB0fDUnXU5powFXDhCwa',name:'Charlotte',desc:'Gentle · Clear · Female'},
];
const OAI_VOICES=[
  {id:'onyx',name:'Onyx',desc:'Deep · Resonant · Male'},
  {id:'nova',name:'Nova',desc:'Warm · Engaging · Female'},
  {id:'echo',name:'Echo',desc:'Smooth · Calm · Male'},
  {id:'shimmer',name:'Shimmer',desc:'Soft · Clear · Female'},
  {id:'alloy',name:'Alloy',desc:'Balanced · Neutral'},
  {id:'fable',name:'Fable',desc:'Rich · Storytelling · Male'},
];

const VOICE={
  enabled:true,
  engine:'openai',   // 'elevenlabs' | 'openai' | 'webspeech'
  // ElevenLabs
  elKey:'',
  elVoiceId:EL_VOICES[1].id,
  elModel:'eleven_multilingual_v2',
  elStability:0.72,
  elSimilarity:0.82,
  // OpenAI
  oaiKey:'',
  oaiVoice:'nova',
  oaiModel:'tts-1-hd',
  oaiSpeed:0.78,
  // Web Speech
  wsVoice:null,
  wsRate:0.80,
  wsPitch:0.88,
  // Internal
  _cueFade:null,
  _currentAudio:null,

  init(){
    // Load saved keys from localStorage
    try{
      const saved=JSON.parse(localStorage.getItem('gp_voice')||'{}');
      if(saved.elKey)this.elKey=saved.elKey;
      if(saved.oaiKey)this.oaiKey=saved.oaiKey;
      // Only restore engine/voice if user explicitly chose something other than old defaults
      if(saved.engine&&saved.engine!=='webspeech')this.engine=saved.engine;
      if(saved.elVoiceId)this.elVoiceId=saved.elVoiceId;
      if(saved.oaiVoice&&saved.oaiVoice!=='onyx')this.oaiVoice=saved.oaiVoice;
    }catch(e){}
    // Init Web Speech fallback
    if('speechSynthesis' in window){
      const load=()=>{
        const vv=speechSynthesis.getVoices();
        const preferred=['Daniel','Karen','Samantha','Alex','Google UK English Male','Google UK English Female','Microsoft David','Microsoft Zira'];
        this.wsVoice=preferred.reduce((f,n)=>f||vv.find(v=>v.name.includes(n)),null)||vv.find(v=>v.lang.startsWith('en'))||vv[0]||null;
      };
      speechSynthesis.onvoiceschanged=load;
      load();
    }
    this._buildVoicePanel();
  },

  _save(){
    // In V2 the encrypted vault owns the secrets — never let plaintext keys
    // touch localStorage. Persist only the non-secret prefs (engine + voice
    // selection) so reloads remember the user's chosen voice without
    // shipping their API key alongside it on disk.
    const prefs={engine:this.engine,elVoiceId:this.elVoiceId,oaiVoice:this.oaiVoice};
    if(!GP_ELECTRON){ prefs.elKey=this.elKey; prefs.oaiKey=this.oaiKey; }
    try{localStorage.setItem('gp_voice',JSON.stringify(prefs));}catch(e){}
    GP_API.saveKey('elevenlabs', this.elKey);
    GP_API.saveKey('openai',     this.oaiKey);
  },

  _buildVoicePanel(){
    const panel=document.getElementById('voice-settings-panel');
    if(!panel)return;
    panel.innerHTML=`
<div style="font-size:14px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:.75rem;display:flex;align-items:center;justify-content:space-between">
  <span>Voice Engine</span>
  <span id="engine-badge" style="font-size:14px;padding:2px 8px;border-radius:10px;border:.5px solid var(--border);color:var(--gold)">Browser Voice</span>
</div>
<div style="display:flex;gap:6px;margin-bottom:1rem;flex-wrap:wrap">
  <button class="gp-btn" id="btn-eng-ws"   data-act="voice-set-engine" data-arg="webspeech"  style="font-size:14px">Browser</button>
  <button class="gp-btn" id="btn-eng-el"   data-act="voice-set-engine" data-arg="elevenlabs" style="font-size:14px">ElevenLabs</button>
  <button class="gp-btn" id="btn-eng-oai"  data-act="voice-set-engine" data-arg="openai"     style="font-size:14px">OpenAI</button>
</div>

<div id="panel-webspeech" style="display:flex;flex-direction:column;gap:10px">
  <div style="font-size:15px;color:var(--muted);line-height:1.7;padding:.6rem;background:rgba(201,168,76,.04);border:.5px solid var(--border);border-radius:4px">
    Built-in browser voice. Works instantly — no key needed. Quality varies by OS.<br>
    <strong style="color:var(--silver)">Tip:</strong> On macOS/iOS, enable <em>Siri Voices</em> in System Settings → Accessibility → Spoken Content for much better quality.
  </div>
  <div style="display:flex;align-items:center;gap:10px">
    <label style="font-size:14px;color:var(--muted);width:55px">Speed</label>
    <input type="range" min="0.5" max="1.1" step="0.05" value="${this.wsRate}" data-act="voice-ws-rate" style="flex:1">
    <span id="ws-rate-val" style="font-size:14px;color:var(--gold);width:28px;text-align:right">${this.wsRate}</span>
  </div>
  <div style="display:flex;align-items:center;gap:10px">
    <label style="font-size:14px;color:var(--muted);width:55px">Pitch</label>
    <input type="range" min="0.6" max="1.1" step="0.05" value="${this.wsPitch}" data-act="voice-ws-pitch" style="flex:1">
    <span id="ws-pitch-val" style="font-size:14px;color:var(--gold);width:28px;text-align:right">${this.wsPitch}</span>
  </div>
</div>

<div id="panel-elevenlabs" style="display:none;flex-direction:column;gap:10px">
  <div style="font-size:15px;color:var(--muted);line-height:1.7;padding:.6rem;background:rgba(192,64,64,.06);border:.5px solid rgba(192,64,64,.25);border-radius:4px">
    <strong style="color:#e08080">ElevenLabs blocks direct browser calls</strong> (no CORS). To use it, run the included <code style="font-size:14px;color:var(--gold)">proxy.js</code> on your machine — it takes 10 seconds. Or use <strong style="color:var(--silver)">OpenAI TTS</strong> instead, which works directly in the browser.
  </div>
  <div style="font-size:14px;color:var(--muted);line-height:1.8;padding:.5rem;background:rgba(201,168,76,.04);border:.5px solid var(--border);border-radius:4px">
    <strong style="color:var(--silver)">To run the proxy (handles both ElevenLabs + OpenAI):</strong><br>
    1. Make sure Node.js is installed<br>
    2. Open terminal in the same folder as this file<br>
    3. Run: <code style="color:var(--gold)">node proxy.js</code><br>
    4. Leave that terminal open — both voice engines will work
  </div>
  <div style="display:flex;align-items:center;gap:8px">
    <label style="font-size:14px;color:var(--muted);width:55px;flex-shrink:0">API Key</label>
    <input type="password" id="el-key-input" placeholder="sk-..." value="${this.elKey}"
      style="flex:1;background:var(--surface);border:.5px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:15px;padding:5px 8px;border-radius:2px;outline:none"
      data-act="keys-set" data-arg="elevenlabs">
  </div>
  <div style="display:flex;align-items:center;gap:8px">
    <label style="font-size:14px;color:var(--muted);width:55px;flex-shrink:0">Voice</label>
    <select id="el-voice-select" style="flex:1;background:var(--surface);border:.5px solid var(--border);color:var(--text);font-family:'Montserrat',sans-serif;font-size:15px;padding:5px 8px;border-radius:2px;outline:none">
      ${EL_VOICES.map(v=>`<option value="${v.id}" ${v.id===this.elVoiceId?'selected':''}>${v.name} — ${v.desc}</option>`).join('')}
    </select>
  </div>
  <div style="display:flex;align-items:center;gap:10px">
    <label style="font-size:14px;color:var(--muted);width:55px">Stability</label>
    <input type="range" min="0.3" max="1" step="0.05" value="${this.elStability}" data-act="voice-el-stability" style="flex:1">
    <span id="el-stab-val" style="font-size:14px;color:var(--gold);width:28px;text-align:right">${this.elStability}</span>
  </div>
  <div style="display:flex;align-items:center;gap:10px">
    <label style="font-size:14px;color:var(--muted);width:55px">Clarity</label>
    <input type="range" min="0.3" max="1" step="0.05" value="${this.elSimilarity}" data-act="voice-el-similarity" style="flex:1">
    <span id="el-sim-val" style="font-size:14px;color:var(--gold);width:28px;text-align:right">${this.elSimilarity}</span>
  </div>
</div>

<div id="panel-openai" style="display:none;flex-direction:column;gap:10px">
  <div style="font-size:15px;color:var(--muted);line-height:1.7;padding:.6rem;background:rgba(192,64,64,.06);border:.5px solid rgba(192,64,64,.25);border-radius:4px">
    <strong style="color:#e08080">OpenAI also blocks direct browser calls</strong> (same CORS issue). Run <code style="font-size:14px;color:var(--gold)">node proxy.js</code> — it handles both ElevenLabs and OpenAI in one command.
  </div>
  <div style="display:flex;align-items:center;gap:8px">
    <label style="font-size:14px;color:var(--muted);width:55px;flex-shrink:0">API Key</label>
    <input type="password" id="oai-key-input" placeholder="sk-..." value="${this.oaiKey}"
      style="flex:1;background:var(--surface);border:.5px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:15px;padding:5px 8px;border-radius:2px;outline:none"
      data-act="keys-set" data-arg="openai">
  </div>
  <div style="display:flex;align-items:center;gap:8px">
    <label style="font-size:14px;color:var(--muted);width:55px;flex-shrink:0">Voice</label>
    <select id="oai-voice-select" style="flex:1;background:var(--surface);border:.5px solid var(--border);color:var(--text);font-family:'Montserrat',sans-serif;font-size:15px;padding:5px 8px;border-radius:2px;outline:none">
      ${OAI_VOICES.map(v=>`<option value="${v.id}" ${v.id===this.oaiVoice?'selected':''}>${v.name} — ${v.desc}</option>`).join('')}
    </select>
  </div>
  <div style="display:flex;align-items:center;gap:10px">
    <label style="font-size:14px;color:var(--muted);width:55px">Speed</label>
    <input type="range" min="0.5" max="1.0" step="0.02" value="${this.oaiSpeed}" data-act="voice-oai-speed" style="flex:1">
    <span id="oai-speed-val" style="font-size:14px;color:var(--gold);width:28px;text-align:right">${this.oaiSpeed}</span>
  </div>
  <div style="display:flex;align-items:center;gap:8px">
    <label style="font-size:14px;color:var(--muted);width:55px;flex-shrink:0">Model</label>
    <select id="oai-model-select" style="flex:1;background:var(--surface);border:.5px solid var(--border);color:var(--text);font-family:'Montserrat',sans-serif;font-size:15px;padding:5px 8px;border-radius:2px;outline:none">
      <option value="tts-1" ${this.oaiModel==='tts-1'?'selected':''}>tts-1 — Fast · Low latency</option>
      <option value="tts-1-hd" ${this.oaiModel==='tts-1-hd'?'selected':''}>tts-1-hd — Studio quality</option>
    </select>
  </div>
</div>

<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:.75rem">
  <button class="gp-btn primary" data-act="voice-test-speak" style="font-size:14px">▶ Test Voice</button>
  <button class="gp-btn" data-act="voice-stop" style="font-size:14px">■ Stop</button>
</div>`;

    // Wire selects
    document.getElementById('el-voice-select').onchange=e=>{this.elVoiceId=e.target.value;this._save();};
    document.getElementById('oai-voice-select').onchange=e=>{this.oaiVoice=e.target.value;this._save();};
    document.getElementById('oai-model-select').onchange=e=>{this.oaiModel=e.target.value;this._save();};
    this._setEngine(this.engine,true);
  },

  _setEngine(eng,silent=false){
    this.engine=eng;
    this._save();
    // Show/hide panels
    ['webspeech','elevenlabs','openai'].forEach(e=>{
      const p=document.getElementById('panel-'+e);
      if(p)p.style.display=e===eng?'flex':'none';
      const b=document.getElementById('btn-eng-'+e.replace('webspeech','ws').replace('elevenlabs','el').replace('openai','oai'));
      if(b){b.style.borderColor=e===eng?'var(--gold)':'var(--border)';b.style.color=e===eng?'var(--gold)':'var(--muted)';}
    });
    const badge=document.getElementById('engine-badge');
    if(badge)badge.textContent=eng==='elevenlabs'?'ElevenLabs AI':eng==='openai'?'OpenAI TTS':'Browser Voice';
    if(!silent)toast(eng==='elevenlabs'?'ElevenLabs — add your API key below':'openai'===eng?'OpenAI TTS — add your API key below':'Browser voice active');
  },

  _testSpeak(){
    this.speak('You are entering a state of deep relaxation. Mind awake. Body asleep. The Gateway is open.');
  },

  // Whether a key for `provider` ('openai'|'elevenlabs') is available to make a
  // call. In Electron the plaintext stays in main.js, so we trust the saved
  // flag (or a key typed this session); on the web it's in memory/localStorage.
  hasKey(provider){
    if(provider==='openai' ? this.oaiKey : this.elKey) return true;
    if(GP_ELECTRON) return !!(typeof KEYS!=='undefined' && KEYS._saved && KEYS._saved[provider]);
    return false;
  },

  speak(text,opts={}){
    if(!this.enabled||!text)return;
    this._showCue(text);
    if(this.engine==='openai'&&this.hasKey('openai'))          this._speakOpenAI(text);
    else if(this.engine==='elevenlabs'&&this.hasKey('elevenlabs')) this._speakElevenLabsProxy(text);
    else                                                       this._speakWebSpeech(text,opts);
  },

  async _speakElevenLabsProxy(text){
    // In Electron: routes through window.gp.elevenlabsTTS over IPC, main.js
    // makes the HTTPS call. On the hosted web build there is no ElevenLabs
    // /byok route, so GP_API.elevenlabsTTS throws → we fall through to Web
    // Speech here. Either way fails silent → Web Speech fallback.
    this._stopAudio();
    try{
      const blob=await GP_API.elevenlabsTTS({text,voiceId:this.elVoiceId,model:this.elModel,stability:this.elStability,similarity:this.elSimilarity,key:this.elKey});
      const url=URL.createObjectURL(blob);
      const audio=new Audio(url);
      audio.volume=0.9;
      this._currentAudio=audio;
      audio.onended=()=>URL.revokeObjectURL(url);
      await audio.play();
    }catch(err){
      // Proxy not running — silently fall back
      this._speakWebSpeech(text,{});
    }
  },

  async _speakOpenAI(text){
    this._stopAudio();
    try{
      const blob=await GP_API.openaiTTS({text,voice:this.oaiVoice,model:this.oaiModel,speed:this.oaiSpeed,key:this.oaiKey});
      const url=URL.createObjectURL(blob);
      const audio=new Audio(url);
      audio.volume=0.9;
      this._currentAudio=audio;
      audio.onended=()=>URL.revokeObjectURL(url);
      await audio.play();
    }catch(err){
      // Proxy not running — silently fall back
      this._speakWebSpeech(text,{});
    }
  },

  _speakWebSpeech(text,opts={}){
    if(!('speechSynthesis' in window))return;
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text);
    u.rate=opts.rate||this.wsRate;
    u.pitch=opts.pitch||this.wsPitch;
    u.volume=0.9;
    if(this.wsVoice)u.voice=this.wsVoice;
    speechSynthesis.speak(u);
  },

  _showCue(text){
    const el=document.getElementById('guidance-cue');
    if(!el)return;
    el.textContent=text;el.style.opacity='1';
    // Blur-in reveal — the cue resolves into focus rather than blinking on.
    // In cinematic mode this is the focal element, so the polish matters
    // most there. Skipped in calm mode.
    if(!isReducedMotion() && el.animate){
      el.animate(
        [{opacity:0,filter:'blur(8px)'},{opacity:1,filter:'blur(0)'}],
        {duration:700,easing:'cubic-bezier(.22,.61,.36,1)'}
      );
    }
    clearTimeout(this._cueFade);
    this._cueFade=setTimeout(()=>{el.style.opacity='0';},8000);
  },

  _stopAudio(){
    if(this._currentAudio){try{this._currentAudio.pause();this._currentAudio.currentTime=0;}catch(e){}}
    this._currentAudio=null;
  },

  stop(){
    this._stopAudio();
    if('speechSynthesis' in window)speechSynthesis.cancel();
    const el=document.getElementById('guidance-cue');
    if(el)el.style.opacity='0';
  },

  toggle(){
    this.enabled=!this.enabled;
    const b=document.getElementById('voice-toggle');
    if(b)b.textContent=this.enabled?'Voice On':'Voice Off';
    if(!this.enabled)this.stop();
  }
};

// ── Monroe-accurate cue scripts keyed to session name + phase ──
const GUIDANCE_SCRIPTS={
  // Cues fired at session START (seconds=0)
  _start:{
    'Morning Activation':'Close your eyes. Let your body become still. You are beginning your morning activation. There is nothing to do but be present.',
    'Focus 10 Entry':'Find a comfortable position. We will move together into the state Monroe called Focus Ten — mind awake, body asleep. Trust the process.',
    'Deep Coherence':'This session will take you into expanded awareness. Breathe naturally. Allow your mind to become quiet. The field does the work.',
    'Gateway Immersion':'You are entering the Gateway. This is the most complete session. Give yourself fully to it. Surrender is the practice.',
    'Pain Dissolution':'Bring gentle awareness to any area of discomfort. We are not fighting it. We are entering into dialogue with it. Healing begins with presence.',
    'Wealth State':'Become aware of any tension around the idea of money, success, or freedom. Notice it without judgment. We will move through it together.',
    'Sleep Programming':'Allow your body to sink completely into the surface beneath you. Let the weight go. This session will continue working as you sleep.',
    'Full Integration':'This is the complete journey through the Gateway Waves. Take three slow breaths before we begin.',
    _default:'Close your eyes. Become still. Allow the session to unfold.'
  },

  // Cues fired when each named phase begins
  _phase:{
    'Resonant Tuning':'Begin humming softly. Feel the vibration move through your skull, your chest, your spine. You are synchronizing with the Schumann Resonance — seven point eight cycles per second — the heartbeat of the Earth.',
    'Focus 3 entry':'Bring your awareness to the space behind your closed eyes. Let thoughts pass like clouds. You are not your thoughts. You are the awareness watching them.',
    'Body release':'Starting from your feet, let go. Your feet. Your calves. Your thighs. Your pelvis. Your abdomen. Your chest. Your hands. Your arms. Your shoulders. Your neck. Your face. Let everything go.',
    'Focus 10 hold':'You have entered Focus Ten. Your body is now asleep. Your mind remains awake. Rest here in this paradox. This is the foundation of the Gateway.',
    'Focus 10':'Your body is releasing into deep relaxation. Your mind is clear and alert. This is Focus Ten. Mind awake. Body asleep. Rest here.',
    'Focus 12':'Your awareness is expanding beyond the boundaries of your physical body. You may notice a sense of spaciousness. This is Focus Twelve. Allow it.',
    'Expanded awareness':'Let your awareness extend in all directions simultaneously. Up. Down. Left. Right. Forward. Back. You are not contained. You are vast.',
    'Focus 15':'You are entering Focus Fifteen — the state outside of time. Past and future dissolve. Only this moment exists. In this state, your subconscious is directly accessible.',
    'Focus 21 / OBE':'You are at the threshold of other energy systems. Monroe called this Focus Twenty-One. You may perceive light, sound, or presence. Remain calm. Remain curious.',
    'Breathwork':'Breathe in slowly for five counts. Hold for five. Release for five. Each cycle takes you deeper. Let the breath lead.',
    '174 Hz breath':'Breathe with the frequency of healing. With each inhale, draw golden light into any area of discomfort. With each exhale, release what is ready to leave.',
    'Cellular dialogue':'Bring your awareness to the cellular level. Each cell is a conscious unit of intelligence. Ask your body: what do you need right now? Listen without expectation.',
    '528 Hz flood':'Visualize a golden-green light — the color of new leaves, of spring — flooding your entire body. See it reaching into every cell. DNA strands straightening, repairing, remembering their original blueprint.',
    'Future body':'Jump forward in time. Six months from now. You are fully healed. Feel the ease of movement. The absence of pain. The gratitude in your body. Hold this memory. It is real.',
    'Shadow scan':'Bring to mind someone who triggers strong judgment in you. The quality you most strongly reject is the quality you most need to integrate. It is not theirs. It is yours — waiting to be claimed.',
    '369 encoding':'Your desire already exists as potential in the quantum field. Speaking it three times is not repetition. It is activation. Feel the reality of your words as you say them.',
    '888 loop':'Wealth is not a destination. It is a frequency. Visualize an infinity symbol of golden light flowing through you. You are not blocking it. You are becoming it.',
    'Future self meeting':'In the stillness of Focus Fifteen, call forward the version of you who has already lived the life you desire. They are standing before you now. Ask them: what changed everything? Listen.',
    'Affirmation loop':'Receive each affirmation as truth, not aspiration. Your subconscious does not know the difference between an imagined reality and a real one. Feel the words landing.',
    'Theta drift':'Allow yourself to drift toward sleep. The affirmations continue beneath your awareness. Your subconscious is awake and receiving even as your conscious mind rests.',
    'Wave I':'Entering Wave One — Discovery. Resonant Tuning. Feel the hum of your own field.',
    'Wave II':'Entering Wave Two — Threshold. You will construct your Resonant Energy Balloon. Visualize it now as a sphere of warm light surrounding your entire body.',
    'Wave III':'Entering Wave Three — Freedom. We move into Focus Fifteen. The state of no-time. Surrender your grip on linear sequence.',
    'Wave VII':'Entering Wave Seven — Integration. This is where the journey lands in the body. In the cells. In the choices you make tomorrow.',
    'Code imprinting':'You are now in the optimal state for subconscious imprinting. The codes you receive now bypass the critical conscious mind. Allow them in.',
    'Tuning':'Begin your resonant tuning. Hum. Feel it. Synchronize.',
    _default:null // no cue for unrecognized phases
  },

  // Return ceremony — timed sequence from session end
  _return:[
    [0,  'Your session is now complete. Begin your return.'],
    [6,  'Become aware of your physical body. Feel its weight. Its warmth.'],
    [14, 'Feel the surface beneath you. The air on your skin. The sounds in the room.'],
    [24, 'Take three slow, deep breaths. With each exhale, return a little more fully.'],
    [38, 'When you are ready, gently begin to move your fingers and toes.'],
    [52, 'Take your time. There is no rush. The insights you received are yours.'],
    [65, 'Slowly open your eyes. Welcome back. Take a moment to write in your journal.']
  ]
};

// ── Timed cue scheduler ──
let _cueTimeouts=[];
function scheduleCues(sess,totalSec){
  _cueTimeouts.forEach(t=>clearTimeout(t));
  _cueTimeouts=[];
  if(!VOICE.enabled)return;

  // Opening cue at t=2s
  const openingKey=Object.keys(GUIDANCE_SCRIPTS._start).find(k=>sess.name.includes(k.split(' ')[0]))||'_default';
  const opening=GUIDANCE_SCRIPTS._start[openingKey]||GUIDANCE_SCRIPTS._start._default;
  _cueTimeouts.push(setTimeout(()=>VOICE.speak(opening,{rate:0.78}),2000));

  // Phase transition cues
  if(sess.phases&&sess.phases.length){
    sess.phases.forEach((phase,i)=>{
      if(i===0)return; // opening covers first phase
      const triggerSec=Math.round((i/sess.phases.length)*totalSec);
      const script=GUIDANCE_SCRIPTS._phase[phase]||GUIDANCE_SCRIPTS._phase._default;
      if(script){
        _cueTimeouts.push(setTimeout(()=>{
          if(!timerRunning)return;
          VOICE.speak(script,{rate:0.80});
        },triggerSec*1000));
      }
    });
  }
}

function clearCues(){
  _cueTimeouts.forEach(t=>clearTimeout(t));
  _cueTimeouts=[];
  VOICE.stop();
}

function triggerReturnCeremony(){
  GUIDANCE_SCRIPTS._return.forEach(([delay,text])=>{
    _cueTimeouts.push(setTimeout(()=>VOICE.speak(text,{rate:0.76}),delay*1000));
  });
  // Auto-open journal after ceremony ends
  _cueTimeouts.push(setTimeout(()=>{
    show_tab('journal');
    toast('Journey complete — your journal awaits.');
  },80000));
}

function show_tab(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  const s=document.getElementById('screen-'+id);
  const b=Array.from(document.querySelectorAll('.nav-btn')).find(b=>b.dataset.arg===id);
  if(s)s.classList.add('active');
  if(b)b.classList.add('active');
}

// ═══════════════════════════ SESSION FUNCTIONS ═══════════════════════════
function selectSession(s){
  selectedSess=s;
  timerMax=s.dur*60;
  timerSeconds=0;
  timerRunning=false;
  clearInterval(timerInterval);
  clearCues();
  document.getElementById('timer-session-name').textContent=s.name;
  document.getElementById('timer-phase').textContent=s.phases?s.phases[0]:'';
  document.getElementById('guidance-cue').textContent='';
  document.getElementById('timer-btn').textContent='Begin';
  renderTimer();
  showPairingGuide(s);
}

function renderTimer(){
  const m=Math.floor(timerSeconds/60).toString().padStart(2,'0');
  const s=(timerSeconds%60).toString().padStart(2,'0');
  document.getElementById('timer-display').textContent=m+':'+s;
  const pct=timerMax>0?timerSeconds/timerMax:0;
  const circ=276.5;
  document.getElementById('timer-ring').style.strokeDashoffset=circ-(circ*pct);
}

function toggleTimer(){
  if(!selectedSess){toast('Select a session first');return;}
  timerRunning=!timerRunning;
  document.getElementById('timer-btn').textContent=timerRunning?'Pause':'Resume';
  if(timerRunning){
    CINEMATIC.enter(); // V3b: enter cinematic mode on Begin/Resume
    // V7a: if hosting a practice room, broadcast session-start to participants
    NETWORK.broadcastTimerStart({timerSeconds:timerSeconds,timerMax:timerMax,sessionName:selectedSess.name});
    scheduleCues(selectedSess,timerMax);
    AMBIENT.start(AMBIENT._currentSolfHz,AMBIENT._currentBeatHz);
    AMBIENT.scheduleDescentCurve(timerMax);
    timerInterval=setInterval(()=>{
      timerSeconds++;
      let currentPhase='';
      if(selectedSess.phases){
        const phaseIdx=Math.floor((timerSeconds/timerMax)*selectedSess.phases.length);
        currentPhase=selectedSess.phases[Math.min(phaseIdx,selectedSess.phases.length-1)]||'';
        document.getElementById('timer-phase').textContent=currentPhase;
      }
      renderTimer();
      // V3.3: adaptive atmosphere evolves through the session (calmer as you descend)
      ATMOSPHERE.sessionTick(timerMax?timerSeconds/timerMax:0);
      // V7a: broadcast timer ticks to practice room (no-op if not hosting)
      NETWORK.broadcastTimer({timerSeconds,phase:currentPhase,sessionName:selectedSess.name,timerMax});
      if(timerSeconds>=timerMax){
        clearInterval(timerInterval);timerRunning=false;
        CINEMATIC.exit(); // V3b: leave cinematic on session completion
        document.getElementById('timer-btn').textContent='Return';
        stats.sessions++;stats.minutes+=Math.round(timerMax/60);
        // Log session date for graph
        const d=DB.load();
        if(!d.sessionLog)d.sessionLog=[];
        d.sessionLog.push({date:new Date().toISOString().slice(0,10),minutes:Math.round(timerMax/60)});
        d.sessions=stats.sessions;d.minutes=stats.minutes;
        DB.save(d);stats=d;
        // Track wave completion if this was a wave session
        if(selectedSess&&selectedSess.waveIndex!==undefined){
          recordWaveCompletion(selectedSess.waveIndex);
        }
        updateStats();
        clearCues();
        AMBIENT.stop();
        ATMOSPHERE.apply(); // V3.3: restore the resting atmosphere after the session
        triggerReturnCeremony();
      }
    },1000);
  } else {
    clearInterval(timerInterval);
    clearCues();
    AMBIENT.stop();
    CINEMATIC.exit(); // V3b: leave cinematic on pause
    ATMOSPHERE.apply(); // V3.3: restore resting atmosphere on pause
    NETWORK.broadcastTimerStop(); // V7a: tell practice room participants
  }
}

function resetTimer(){
  clearInterval(timerInterval);
  clearCues();
  AMBIENT.stop();
  CINEMATIC.exit(); // V3b: leave cinematic on reset
  ATMOSPHERE.apply(); // V3.3: restore resting atmosphere on reset
  timerRunning=false;timerSeconds=0;
  document.getElementById('timer-btn').textContent='Begin';
  document.getElementById('guidance-cue').textContent='';
  renderTimer();
}

// ═══════════════════════════ BREATHWORK ═══════════════════════════
function buildBreath(){
  const bp=document.getElementById('breath-patterns');
  bp.innerHTML=BREATH_PATTERNS.map((p,i)=>`
  <button class="bp-btn ${i===1?'active':''}" id="bp-${i}" data-act="set-breath" data-id="${i}">${p.name}</button>`).join('');
}

function setBreath(i){
  breathPattern=BREATH_PATTERNS[i];
  document.querySelectorAll('.bp-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('bp-'+i).classList.add('active');
  if(breathRunning)stopBreath(),startBreath();
}

function toggleBreath(){
  if(breathRunning)stopBreath();
  else startBreath();
}

function startBreath(){
  breathRunning=true;breathCycle=0;
  document.getElementById('breath-btn').textContent='Pause';
  runPhase(0);
}

function stopBreath(){
  breathRunning=false;clearTimeout(breathTimeout);
  document.getElementById('breath-btn').textContent='Begin';
  const orb=document.getElementById('breath-orb');
  orb.style.transform='scale(1)';
  document.getElementById('breath-orb-label').textContent='∞';
  document.getElementById('breath-instruction').textContent='Select a pattern and begin';
  document.getElementById('breath-count').textContent='';
  THREE_FIELD.resetBreath(); // V3a: stop driving particles when breath stops
  FIELD_AUDIO.setBreath(null); // Field resonance: settle back to neutral swell
  HRV.stop && HRV.stop();    // V3d: stop coherence visualizer
}

function runPhase(phase){
  if(!breathRunning)return;
  const {i:inhale,h:hold=0,e:exhale,hold2=0}=breathPattern;
  const phases=['inhale','hold','exhale','hold2'].filter((_,pi)=>[inhale,hold,exhale,hold2][pi]>0);
  const durations=[inhale,hold,exhale,hold2].filter(d=>d>0);
  const labels=['Inhale','Hold','Exhale','Rest'];
  const instructions=[`Breathe in slowly... ${inhale}s`,hold?`Hold gently... ${hold}s`:'',`Release slowly... ${exhale}s`,hold2?`Rest... ${hold2}s`:''].filter((_,pi)=>[inhale,hold,exhale,hold2][pi]>0);
  const scales=['1.4','1.4','1','1'].filter((_,pi)=>[inhale,hold,exhale,hold2][pi]>0);

  const pi=phase%phases.length;
  if(pi===0)breathCycle++;

  const orb=document.getElementById('breath-orb');
  const dur=durations[pi];
  orb.style.transition=`transform ${dur*.9}s ease-in-out`;
  orb.style.transform=`scale(${scales[pi]})`;
  const phaseLabel=['Inhale','Hold','Exhale','Rest'][pi];
  document.getElementById('breath-orb-label').textContent=phaseLabel;
  document.getElementById('breath-instruction').textContent=instructions[pi];
  document.getElementById('breath-count').textContent=breathCycle>0?`Cycle ${breathCycle}`:'';

  // V3a: drive the Three.js field with breath phase
  THREE_FIELD.setBreath(phaseLabel);
  FIELD_AUDIO.setBreath(phaseLabel); // Field resonance: swell with the breath phase
  // V3d: pulse the HRV coherence visualizer in sync
  HRV.pulse && HRV.pulse(phaseLabel, dur);

  breathTimeout=setTimeout(()=>runPhase(pi+1),dur*1000);
}

// ═══════════════════════════ PROTOCOLS ═══════════════════════════
function buildProtocols(){
  const c=document.getElementById('protocols-content');
  function renderProtocol(p){
    return`<div class="protocol-card fade-in">
      <div class="protocol-header">
        <div class="protocol-icon">${p===PAIN_PROTOCOL?'✦':'◉'}</div>
        <div><div class="protocol-title">${p.title}</div><div class="protocol-sub">${p.subtitle}</div></div>
      </div>
      <div class="step-list">
        ${p.steps.map(s=>`
        <div class="step-item">
          <div class="step-num">${s.num}</div>
          <div class="step-content">
            <div class="step-name">${s.name}</div>
            <div class="step-desc">${s.desc}</div>
            <div class="step-time">⏱ ${s.time}</div>
          </div>
        </div>`).join('')}
      </div>
    </div>`;
  }
  c.innerHTML=renderProtocol(PAIN_PROTOCOL)+`<div class="divider"></div>`+renderProtocol(WEALTH_PROTOCOL);
}

// ═══════════════════════════ AFFIRMATIONS ═══════════════════════════
function buildAffirmations(){
  renderCurrentAffirm();
  const allEl=document.getElementById('all-affirmations');
  // V4b: merge built-in affirmations with user's Council-generated custom ones,
  // marked with a small badge so they're visually distinct.
  const custom=(DB.load().customAffirmations||[]);
  const builtIn=AFFIRMATIONS.map(a=>({...a,_custom:false}));
  const merged=[...builtIn,...custom.map(c=>({code:c.code,text:c.text,intent:c.intent,_custom:true}))];
  allEl.innerHTML=merged.map(a=>`
  <div style="background:var(--card);border:.5px solid var(--border);border-radius:4px;padding:.75rem 1rem">
    <div style="font-size:14px;color:var(--gold);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;opacity:.7;display:flex;justify-content:space-between">
      <span>${escapeHTML(a.code)}</span>
      ${a._custom?'<span style="color:var(--gold2);font-size:13px;letter-spacing:1.5px">◈ Council-generated</span>':''}
    </div>
    <div style="font-family:'Cormorant Garamond',serif;font-size:15px;font-style:italic;color:var(--silver);line-height:1.7">${escapeHTML(a.text)}</div>
    <div style="font-size:14px;color:var(--muted);letter-spacing:2px;text-transform:uppercase;margin-top:5px">${escapeHTML(a.intent||'')}</div>
  </div>`).join('');
}

// V5b: wheel cycles built-in AFFIRMATIONS + Council-generated custom ones.
// Helper centralizes the merged-list lookup so wheel and grid stay in sync.
function allAffirmations(){
  const custom=(DB.load().customAffirmations||[]).map(c=>({code:c.code,text:c.text,intent:c.intent,_custom:true}));
  return [...AFFIRMATIONS,...custom];
}

function renderCurrentAffirm(){
  const list=allAffirmations();
  // Clamp current index if a deletion shrank the list
  if(currentAffirm>=list.length) currentAffirm=0;
  const a=list[currentAffirm];
  document.getElementById('affirm-display').innerHTML=`
    <div class="affirm-code">${escapeHTML(a.code)}${a._custom?' <span style="font-size:14px;color:var(--gold2);letter-spacing:1.5px;margin-left:8px">◈ Council</span>':''}</div>
    <div class="affirm-text">${escapeHTML(a.text)}</div>
    <div class="affirm-intent">${escapeHTML(a.intent||'')}</div>`;
  document.getElementById('affirm-counter').textContent=`${currentAffirm+1} / ${list.length}`;
}

function nextAffirm(){const n=allAffirmations().length;currentAffirm=(currentAffirm+1)%n;renderCurrentAffirm();}
function prevAffirm(){const n=allAffirmations().length;currentAffirm=(currentAffirm-1+n)%n;renderCurrentAffirm();}

// ═══════════════════════════ JOURNAL ═══════════════════════════
function buildJournal(){
  const g=document.getElementById('journal-grid');
  g.innerHTML=JOURNAL_PROMPTS.map(p=>`
  <div class="j-block">
    <label>${p.label}</label>
    <textarea placeholder="${p.ph}"></textarea>
  </div>`).join('');
  renderJournalHistory();
}

// ═══════════════════════════ QUANTUM MIRROR ═══════════════════════════
const QM={
  _key:'',
  _lastTransmission:null,
  _dotsInterval:null,

  init(){
    try{
      const saved=localStorage.getItem('gp_anthropic_key');
      if(saved){this._key=saved;const el=document.getElementById('anthropic-key-input');if(el)el.value=saved;}
    }catch(e){}
  },

  saveKey(k){
    this._key=k.trim();
    // V2: vault is the only on-disk home for the key. V1 (no vault) still
    // needs localStorage because the proxy reads the key from each request.
    if(!GP_ELECTRON){
      try{localStorage.setItem('gp_anthropic_key',this._key);}catch(e){}
    }
    GP_API.saveKey('anthropic', this._key);
    if(typeof KEYS!=='undefined'){ KEYS._saved=KEYS._saved||{}; KEYS._saved.anthropic=!!this._key; }
  },

  // True if an Anthropic key is available to make a call. In Electron the
  // plaintext lives only in main.js, so we rely on the saved flag (or a key
  // typed this session); on the web the key is in this browser.
  hasKey(){
    if(this._key) return true;
    if(GP_ELECTRON) return !!(typeof KEYS!=='undefined' && KEYS._saved && KEYS._saved.anthropic);
    try{ return !!localStorage.getItem('gp_anthropic_key'); }catch(e){ return false; }
  },

  _buildEntry(){
    // Pull from saved journal entries first, then live textarea values
    const fields=document.querySelectorAll('#journal-grid textarea');
    const live=Array.from(fields).map((f,i)=>({
      prompt:JOURNAL_PROMPTS[i]?.label||'',
      response:f.value.trim()
    })).filter(e=>e.response);

    // Also include most recent saved entry
    const {journal=[]}=DB.load();
    const recent=journal.length?journal[journal.length-1].data:[];

    const combined=live.length?live:recent;
    if(!combined.length)return null;

    return combined.map(e=>`${e.prompt}:\n${e.response}`).join('\n\n');
  },

  async invoke(){
    if(!this.hasKey()){
      toast('Add your Anthropic API key in the Journal tab');
      // Scroll to key input
      document.getElementById('anthropic-key-input')?.scrollIntoView({behavior:'smooth'});
      return;
    }

    const entry=this._buildEntry();
    if(!entry){
      toast('Write something in your journal first, then consult the Council.');
      return;
    }

    // Show loading
    document.getElementById('mirror-output').style.display='none';
    document.getElementById('mirror-loading').style.display='block';
    document.getElementById('mirror-btn').disabled=true;
    this._animateDots();

    try{
      // V7c: retrieve top-K semantically-similar past entries and weave into the
      // Council's context. The model can now reference long-term patterns
      // ("Three months ago you wrote about…") instead of being stateless.
      // Falls through silently if no embeddings exist (e.g. no OpenAI key).
      let pastEntries=[];
      try{ pastEntries=await MEMORY.retrieve(entry, MEMORY.K); }catch(e){ /* silent */ }

      const callMirror=async(entryText)=>{
        if(GP_ELECTRON){
          return pastEntries.length
            ? await window.gp.mirrorWithContext({entry:entryText, pastEntries})
            : await window.gp.mirror({entry:entryText});
        }
        // Web BYOK: GP_API.mirror weaves pastEntries into the request body itself.
        return await GP_API.mirror({entry:entryText, pastEntries});
      };

      // Attempt 1
      const data=await callMirror(entry);
      const raw1=data.content?.[0]?.text||'';
      let parsed=QM._tryParse(raw1);

      // Attempt 2 with explicit JSON reminder. The system prompt is unchanged
      // so prompt-caching still serves the retry cheaply; we only pay for the
      // user-content delta. If this fails too we render the raw text instead
      // of dead-ending the user.
      let rawShown=raw1;
      if(!parsed){
        try{
          const retryEntry=entry+'\n\n[Reminder: return ONLY valid JSON, no markdown fences, no preamble.]';
          const data2=await callMirror(retryEntry);
          const raw2=data2.content?.[0]?.text||'';
          parsed=QM._tryParse(raw2);
          rawShown=raw2||raw1;
        }catch(e2){
          QM._renderRaw(raw1,'Retry failed: '+(e2.message||e2));
          return;
        }
      }

      if(!parsed){
        QM._renderRaw(rawShown,'Council returned unstructured text both times. Showing what came back.');
        return;
      }

      this._lastTransmission=parsed;
      this._render(parsed);

      // V7b: opt-in feed share — fire-and-forget after a successful Council call
      try{ NETWORK.maybeShareTransmission(parsed); }catch(e){}

    }catch(err){
      toast('Mirror: '+err.message);
      console.warn('Quantum Mirror error:',err);
    }finally{
      document.getElementById('mirror-loading').style.display='none';
      document.getElementById('mirror-btn').disabled=false;
      clearInterval(this._dotsInterval);
    }
  },

  // Lenient JSON parse: strip ``` fences, then fall back to first {...}
  // block (covers the case where Claude adds preamble despite the prompt).
  _tryParse(raw){
    if(!raw) return null;
    try{ return JSON.parse(String(raw).replace(/```json|```/g,'').trim()); }catch(e){}
    const m=String(raw).match(/\{[\s\S]*\}/);
    if(m){ try{ return JSON.parse(m[0]); }catch(e){} }
    return null;
  },

  // The retry path failed — show the raw text in the Mirror panel so the
  // user has *something* to work with instead of an empty toast. Their
  // journal entry is preserved (we never cleared it).
  _renderRaw(rawText, note){
    document.getElementById('m-state').textContent='— unstructured response —';
    document.getElementById('m-shadow').textContent=note||'';
    document.getElementById('m-transmission').textContent=(rawText||'(empty)').slice(0,4000);
    document.getElementById('m-wave').textContent='—';
    document.getElementById('m-freq').textContent='—';
    document.getElementById('m-code').textContent='—';
    document.getElementById('m-practice').textContent='Tap "Consult the Council" again to retry.';
    document.getElementById('mirror-output').style.display='block';
    document.getElementById('mirror-output').scrollIntoView({behavior:'smooth',block:'start'});
  },

  _render(t){
    document.getElementById('m-state').textContent=t.stateAssessment||'';
    document.getElementById('m-shadow').textContent=t.shadowObservation||'';
    document.getElementById('m-transmission').textContent=t.transmission||'';
    document.getElementById('m-wave').textContent=t.wave||'';
    document.getElementById('m-freq').textContent=t.frequency||'';
    document.getElementById('m-code').textContent=t.code||'';
    document.getElementById('m-practice').textContent=t.practice||'';
    document.getElementById('mirror-output').style.display='block';
    document.getElementById('mirror-output').scrollIntoView({behavior:'smooth',block:'start'});
  },

  speak(){
    if(!this._lastTransmission)return;
    VOICE.stop();
    const t=this._lastTransmission;
    const text=`${t.transmission} Your practice for the next 24 hours: ${t.practice}`;
    VOICE.speak(text,{rate:0.75});
    const btn=document.getElementById('mirror-speak-btn');
    if(btn){btn.textContent='■ Stop';btn.dataset.act='qm-stop-speak';}
  },

  stopSpeak(){
    VOICE.stop();
    const btn=document.getElementById('mirror-speak-btn');
    if(btn){btn.textContent='▶ Hear Transmission';btn.dataset.act='qm-toggle-speak';}
  },

  toggleSpeak(){
    const btn=document.getElementById('mirror-speak-btn');
    if(btn&&btn.textContent.includes('Stop')){this.stopSpeak();}
    else{this.speak();}
  },

  _animateDots(){
    const el=document.getElementById('mirror-dots');
    if(!el)return;
    const frames=['◈','◈ ◈','◈ ◈ ◈','◈ ◈','◈'];
    let i=0;
    this._dotsInterval=setInterval(()=>{el.textContent=frames[i++%frames.length];},400);
  }
};

function invokeQuantumMirror(){QM.invoke();}

// ═══════════════════════════ JOURNAL ═══════════════════════════
function saveJournal(){
  const fields=document.querySelectorAll('#journal-grid textarea');
  const responses=Array.from(fields).map(f=>f.value.trim());
  if(!responses.some(r=>r)){toast('Nothing to anchor — write something first.');return;}
  const entry={
    id:Date.now(),
    date:new Date().toISOString(),
    session:selectedSess?selectedSess.name:null,
    data:JOURNAL_PROMPTS.map((p,i)=>({prompt:p.label,response:responses[i]||''})).filter(e=>e.response)
  };
  stats=DB.addJournalEntry(entry);
  fields.forEach(f=>f.value='');
  const el=document.getElementById('journal-confirm');
  el.textContent='Entry anchored ✓';
  setTimeout(()=>el.textContent='',3000);
  renderJournalHistory();
  toast('Entry anchored to your record.');
  // V2 #2: re-request Council pre-session recommendation on every journal save
  PRESESSION.request(true);
  // V7c: embed the new entry for semantic memory (silent fail if no OpenAI key)
  MEMORY.embedNewEntries().catch(()=>{});
}

function renderJournalHistory(){
  const {journal=[]}=DB.load();
  const el=document.getElementById('journal-history');
  if(!el)return;
  if(!journal.length){el.innerHTML='<p style="font-size:15px;color:var(--muted);text-align:center;padding:1rem 0;font-style:italic">No entries yet. Your first entry will appear here.</p>';return;}
  el.innerHTML=journal.slice().reverse().map(e=>{
    const d=new Date(e.date);
    const dateStr=d.toLocaleDateString('en',{weekday:'long',month:'short',day:'numeric'});
    const timeStr=d.toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'});
    return`<div style="background:rgba(17,17,32,.68);border:.5px solid rgba(201,168,76,.08);border-radius:4px;padding:1rem;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem;flex-wrap:wrap;gap:4px">
        <div style="font-family:'Cormorant Garamond',serif;font-size:15px;color:var(--gold)">${escapeHTML(dateStr)}</div>
        <div style="font-size:14px;color:var(--muted);letter-spacing:1px">${escapeHTML(timeStr)}${e.session?' · '+escapeHTML(e.session):''}</div>
      </div>
      ${e.data.map(item=>`
        <div style="margin-bottom:.5rem">
          <div style="font-size:14px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin-bottom:2px">${escapeHTML(item.prompt)}</div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:15px;color:var(--silver);line-height:1.7;font-style:italic">${escapeHTML(item.response)}</div>
        </div>`).join('')}
    </div>`;
  }).join('');
}

// ═══════════════ INSIGHT — signal trends + practice timeline (V6·T4) ═══════════════
// Turns the accumulating local check-in data into reflective sparklines — a
// mirror, not a score. Pure read of DB; no network, nothing leaves the device.
const INSIGHT = {
  render(){
    const el=document.getElementById('gp-insight'); if(!el) return;
    const d=DB.load();
    const series=[];
    const moods=d.moods||[];
    if(moods.length>=2){
      series.push({label:'Calm',   values:moods.slice(-21).map(m=>m.calm||3),   color:'#c9a84c', max:5});
      series.push({label:'Energy', values:moods.slice(-21).map(m=>m.energy||3), color:'#f0d88a', max:5});
    }
    const vc=d.voiceCheckins||[];
    if(vc.length>=2) series.push({label:'Voice energy', values:vc.slice(-21).map(v=>Math.round((v.energy||0)*100)), color:'#8fb3d9', max:30});
    const cc=d.cameraCheckins||[];
    if(cc.length>=2) series.push({label:'Stillness', values:cc.slice(-21).map(c=>Math.round((c.stillness||0)*100)), color:'#bcc2d6', max:100});
    if(!series.length){
      el.innerHTML='<div class="gp-insight-empty">Save a few mood, voice, or stillness check-ins on the Today screen and your trends will appear here.</div>';
      return;
    }
    el.innerHTML = series.map((s,i)=>
      `<div class="gp-insight-row"><span class="gp-insight-label">${escapeHTML(s.label)}</span><canvas class="gp-insight-spark" id="gp-spark-${i}" width="480" height="44" aria-label="${escapeHTML(s.label)} trend"></canvas></div>`
    ).join('') +
      `<div class="gp-insight-row"><span class="gp-insight-label">Practice · 14d</span><canvas class="gp-insight-spark" id="gp-insight-timeline" width="480" height="44" aria-label="Practice activity, last 14 days"></canvas></div>`;
    series.forEach((s,i)=>this._spark(document.getElementById('gp-spark-'+i), s.values, s.color, s.max));
    this._timeline(d);
  },
  _spark(canvas, values, color, max){
    if(!canvas) return; const ctx=canvas.getContext('2d'); if(!ctx) return;
    const w=canvas.width, h=canvas.height, pad=5; ctx.clearRect(0,0,w,h);
    if(values.length<2) return;
    const mx=max||Math.max(...values,1), step=(w-pad*2)/(values.length-1);
    ctx.beginPath();
    values.forEach((v,i)=>{ const x=pad+i*step, y=h-pad-((v/mx)*(h-pad*2)); i?ctx.lineTo(x,y):ctx.moveTo(x,y); });
    ctx.strokeStyle=color; ctx.lineWidth=2; ctx.lineJoin='round'; ctx.stroke();
    const lv=values[values.length-1], lx=pad+(values.length-1)*step, ly=h-pad-((lv/mx)*(h-pad*2));
    ctx.beginPath(); ctx.arc(lx,ly,3,0,Math.PI*2); ctx.fillStyle=color; ctx.fill();
  },
  _timeline(d){
    const c=document.getElementById('gp-insight-timeline'); if(!c) return;
    const ctx=c.getContext('2d'); if(!ctx) return;
    const w=c.width, h=c.height; ctx.clearRect(0,0,w,h);
    const days=[...Array(14)].map((_,i)=>{ const dt=new Date(); dt.setDate(dt.getDate()-(13-i)); return dt.toISOString().slice(0,10); });
    const sessions=d.sessionLog||[], journal=d.journal||[];
    const counts=days.map(day=> sessions.filter(s=>s.date===day).length + journal.filter(j=>String(j.date||'').slice(0,10)===day).length);
    const mx=Math.max(...counts,1), bw=(w-2)/14;
    counts.forEach((n,i)=>{ const bh=(n/mx)*(h-6); ctx.fillStyle=n?'#c9a84c':'rgba(201,168,76,.15)'; ctx.fillRect(i*bw+1, h-Math.max(bh,2), bw-2, Math.max(bh,2)); });
  }
};

// ═══════════════════════════ PROGRESS ═══════════════════════════
function buildProgress(){updateStats();}

// ═══════════════════════════ TIER SYSTEM ═══════════════════════════
const TIERS=[
  {name:'Initiate',   min:0,   symbol:'◌', desc:'Beginning the journey',       color:'#6a6458'},
  {name:'Practitioner',min:5,  symbol:'◎', desc:'Establishing the practice',   color:'#a0a8c0'},
  {name:'Adept',      min:15,  symbol:'◈', desc:'Waves opening',               color:'#c9a84c'},
  {name:'Master',     min:35,  symbol:'⊕', desc:'Deep field access',           color:'#f0d88a'},
  {name:'Sovereign',  min:75,  symbol:'✦', desc:'Consciousness liberated',     color:'#fff'},
];

function getCurrentTier(sessions){
  let tier=TIERS[0];
  for(const t of TIERS){if(sessions>=t.min)tier=t;}
  return tier;
}

function getNextTier(sessions){
  for(const t of TIERS){if(sessions<t.min)return t;}
  return null;
}

function checkTierUnlock(){
  const d=DB.load();
  const prev=d.tier||0;
  const curr=TIERS.findIndex(t=>t===getCurrentTier(d.sessions));
  if(curr>prev){
    d.tier=curr;DB.save(d);stats=d;
    toast(TIERS[curr].symbol+' '+TIERS[curr].name+' — unlocked');
  }
}

function renderTierDisplay(){
  const el=document.getElementById('tier-display');
  if(!el)return;
  const d=DB.load();
  const tier=getCurrentTier(d.sessions||0);
  const next=getNextTier(d.sessions||0);
  const pct=next?Math.min(100,Math.round(((d.sessions||0)-tier.min)/(next.min-tier.min)*100)):100;
  el.innerHTML=`
    <div style="display:inline-block;text-align:center;padding:1rem 2rem;background:var(--card);border:.5px solid var(--border2);border-radius:4px;min-width:200px">
      <div style="font-size:32px;color:${tier.color};margin-bottom:4px">${tier.symbol}</div>
      <div style="font-family:'Cormorant Garamond',serif;font-size:21px;color:${tier.color};letter-spacing:2px">${tier.name}</div>
      <div style="font-size:14px;color:var(--muted);margin-top:2px;letter-spacing:1px">${tier.desc}</div>
      ${next?`
      <div style="margin-top:.75rem">
        <div style="height:2px;background:rgba(24,24,44,.80);border-radius:1px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${tier.color};transition:width 1s ease"></div>
        </div>
        <div style="font-size:14px;color:var(--muted);margin-top:3px">${d.sessions||0} / ${next.min} sessions → ${next.name}</div>
      </div>`:'<div style="font-size:14px;color:var(--gold);margin-top:.5rem">Maximum attainment</div>'}
    </div>`;
}

// ═══════════════════════════ SESSION GRAPH ═══════════════════════════
function renderSessionGraph(){
  const canvas=document.getElementById('session-graph');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const W=canvas.offsetWidth||600;
  const H=60;
  canvas.width=W;canvas.height=H;
  ctx.clearRect(0,0,W,H);

  const {sessionLog=[]}=DB.load();
  const today=new Date();
  const days=Array.from({length:30},(_,i)=>{
    const d=new Date(today);d.setDate(d.getDate()-(29-i));
    return d.toISOString().slice(0,10);
  });
  const counts=days.map(day=>sessionLog.filter(s=>s.date===day).reduce((a,s)=>a+s.minutes,0));
  const maxVal=Math.max(...counts,1);
  const barW=Math.floor(W/30)-2;

  days.forEach((day,i)=>{
    const val=counts[i];
    const barH=Math.round((val/maxVal)*(H-8));
    const x=i*(barW+2);
    const y=H-barH;
    ctx.fillStyle=val>0?'rgba(201,168,76,0.7)':'rgba(255,255,255,0.04)';
    ctx.beginPath();
    ctx.roundRect?ctx.roundRect(x,y,barW,barH,2):ctx.rect(x,y,barW,barH);
    ctx.fill();
  });
}

// ═══════════════════════════ TESLA 369 TRACKER ═══════════════════════════
const TT={
  saveDesire(v){
    const d=DB.load();
    if(!d.teslaTracker)d.teslaTracker={};
    d.teslaTracker.desire=v;
    DB.save(d);
  },

  markSlot(day,slot){
    const d=DB.load();
    if(!d.teslaTracker)d.teslaTracker={};
    const key=`${day}-${slot}`;
    if(d.teslaTracker[key])delete d.teslaTracker[key];
    else d.teslaTracker[key]=true;
    DB.save(d);stats=d;
    this.render();
  },

  render(){
    const el=document.getElementById('tesla-grid');
    const desire=document.getElementById('tesla-desire');
    if(!el)return;
    const d=DB.load();
    const tt=d.teslaTracker||{};
    if(desire&&tt.desire)desire.value=tt.desire;

    el.innerHTML=Array.from({length:33},(_,day)=>{
      const slots=['M','N','E']; // Morning, Noon, Evening
      const counts=[3,6,9];
      const allDone=slots.every(s=>tt[`${day}-${s}`]);
      return`<div style="background:var(--card);border:.5px solid ${allDone?'var(--gold)':'var(--border)'};border-radius:4px;padding:6px;text-align:center;cursor:pointer">
        <div style="font-size:14px;color:var(--muted);margin-bottom:4px;letter-spacing:.5px">Day ${day+1}</div>
        <div style="display:flex;gap:3px;justify-content:center">
          ${slots.map((s,si)=>`<div data-act="tt-mark-slot" data-day="${day}" data-slot="${s}" data-stop="true" role="button" tabindex="0"
            aria-pressed="${tt[`${day}-${s}`]?'true':'false'}" aria-label="Day ${day+1} ${s==='M'?'Morning × 3':s==='N'?'Midday × 6':'Evening × 9'}"
            style="width:18px;height:18px;border-radius:50%;border:.5px solid ${tt[`${day}-${s}`]?'var(--gold)':'var(--border)'};
            background:${tt[`${day}-${s}`]?'rgba(201,168,76,.25)':'transparent'};
            font-size:13px;display:flex;align-items:center;justify-content:center;color:${tt[`${day}-${s}`]?'var(--gold)':'var(--muted)'};
            cursor:pointer" title="${s==='M'?'Morning × 3':s==='N'?'Midday × 6':'Evening × 9'}">${tt[`${day}-${s}`]?'✓':counts[si]}</div>`).join('')}
        </div>
      </div>`;
    }).join('');
  }
};

function updateStats(){
  const d=DB.load();
  const sg=document.getElementById('stats-grid');
  if(sg)sg.innerHTML=[
    {n:d.sessions||0,l:'Sessions'},
    {n:d.minutes||0,l:'Minutes'},
    {n:(d.streak||[]).length,l:'Day Streak'},
    {n:(d.waveCompletions||[]).reduce((a,b)=>a+b,0),l:'Wave Completions'}
  ].map(s=>`<div class="stat-block"><div class="stat-num">${s.n}</div><div class="stat-label">${s.l}</div></div>`).join('');

  const sg2=document.getElementById('streak-grid');
  if(sg2)sg2.innerHTML=Array.from({length:21},(_,i)=>{
    const done=(d.streak||[]).includes(i);
    return`<div class="s-dot ${done?'done':''}" data-act="toggle-day" data-id="${i}" role="button" tabindex="0" aria-pressed="${done?'true':'false'}" aria-label="Day ${i+1}${done?' complete':''}">${done?'✓':i+1}</div>`;
  }).join('');

  const wp=document.getElementById('wave-progress');
  if(wp)wp.innerHTML=WAVES.map((w,i)=>{
    const comp=(d.waveCompletions||[])[i]||0;
    const needed=WAVE_REQS[i+1]||3;
    const pct=Math.min(100,Math.round((comp/needed)*100));
    return`<div class="wp-row">
      <div class="wp-name">${w.name.replace('Wave ','W')}</div>
      <div class="wp-track"><div class="wp-fill" style="width:${pct}%"></div></div>
      <div class="wp-pct" style="font-size:14px;color:var(--muted)">${comp}×</div>
    </div>`;
  }).join('');

  renderTierDisplay();
  renderSessionGraph();
  TT.render();
  checkTierUnlock();
  if(typeof INSIGHT!=='undefined') INSIGHT.render(); // V6·T4 signal trends
}

function toggleDay(i){
  if(stats.streak.includes(i))stats.streak=stats.streak.filter(d=>d!==i);
  else stats.streak.push(i);
  DB.save(stats);
  updateStats();
}

function markDay(){
  const d=stats.streak.length;
  if(!stats.streak.includes(d))stats.streak.push(d);
  stats.sessions++;stats.minutes+=20;
  DB.save(stats);
  updateStats();toast('Day '+(d+1)+' marked. You are consistent.');
}

// ═══════════════════════════ COUNCIL ═══════════════════════════
function buildCouncil(){
  document.getElementById('agents-grid').innerHTML=AGENTS.map(a=>`
  <div class="agent-card fade-in">
    <div class="agent-symbol">${a.symbol}</div>
    <div class="agent-name">${a.name}</div>
    <div class="agent-domain">${a.domain}</div>
  </div>`).join('');

  document.getElementById('insights-list').innerHTML=INSIGHTS.map(ins=>`
  <div class="insight-box fade-in">
    <div class="insight-agent">${ins.agent}</div>
    <div class="insight-text">"${ins.text}"</div>
  </div>`).join('');
}

// ═══════════════════════════ V2 #2 · ADAPTIVE SESSION ENGINE ═══════════════════════════
// The Council reads the last ≤7 journal entries and recommends a Wave +
// Frequency + Breath + intention for the next session. Result cached for
// 30 min so we don't burn tokens on every tab switch.
const PRESESSION={
  CACHE_KEY:'gp_presession_cache',
  CACHE_TTL_MS:30*60*1000,
  MIN_ENTRIES:2,
  MAX_ENTRIES:7,
  _inflight:null,
  _lastRec:null,

  init(){
    document.getElementById('gp-rec-x').addEventListener('click',()=>this._hide());
    document.getElementById('gp-rec-apply').addEventListener('click',()=>this._apply());
    // Restore last recommendation instantly if cached, even before any API call
    const cached=this._readCache();
    if(cached) this._render(cached.rec,cached.when);
  },

  // Called on boot + after every journal save
  async request(force=false){
    const entries=this._collectEntries();
    if(entries.length<this.MIN_ENTRIES){ this._hide(); this._hideLoading(); return; }
    if(!force){
      const cached=this._readCache();
      if(cached && Date.now()-cached.when < this.CACHE_TTL_MS){ this._render(cached.rec,cached.when); return; }
    }
    // V2 sources the key from the encrypted vault inside main.js — the
    // renderer only needs to know one exists. V1 still pulls it out of
    // localStorage to forward to the proxy.
    const hasKey = (typeof QM!=='undefined') && QM.hasKey();
    if(!hasKey) return; // silently skip — banner stays hidden until they set a key
    if(this._inflight) return this._inflight;
    this._showLoading();
    this._inflight=(async()=>{
      try{
        const rec=await GP_API.preSession({entries});
        const when=Date.now();
        this._writeCache(rec,when);
        this._render(rec,when);
      }catch(e){
        console.warn('Pre-session failed:',e.message||e);
        // Don't show an error toast — recommendation is a nice-to-have, not a blocker
      }finally{
        this._hideLoading();
        this._inflight=null;
      }
    })();
    return this._inflight;
  },

  _collectEntries(){
    const journal=(DB.load().journal||[]).slice(-this.MAX_ENTRIES);
    const entries=journal.map(j=>({
      date:new Date(j.date).toLocaleDateString(),
      session:j.session||null,
      data:Array.isArray(j.data)?j.data:[]
    }));
    // Fold the latest mood check-in in as the most-recent context so the
    // Council's recommendation reflects how the practitioner is arriving today.
    try{
      if(typeof MOOD!=='undefined'){
        const m=MOOD.latest();
        if(m) entries.push({
          date:new Date(m.date).toLocaleDateString(),
          session:'Arrival check-in',
          data:[{prompt:'Current state (self-reported)', response:MOOD.summary(m)}]
        });
      }
      if(typeof VOICE_AFFECT!=='undefined'){
        const v=VOICE_AFFECT.latest();
        if(v) entries.push({
          date:new Date(v.date).toLocaleDateString(),
          session:'Voice check-in',
          data:[{prompt:'Voice signals (on-device, user-confirmed)', response:`${(v.labels||[]).join(', ')} — sounds like ${v.guess}`}]
        });
      }
      if(typeof CAMERA_AFFECT!=='undefined'){
        const c=CAMERA_AFFECT.latest();
        if(c) entries.push({
          date:new Date(c.date).toLocaleDateString(),
          session:'Stillness check-in',
          data:[{prompt:'Movement/stillness (on-device, user-confirmed)', response:`${(c.labels||[]).join(', ')} — reads as ${c.guess}`}]
        });
      }
    }catch(e){}
    return entries;
  },

  _readCache(){
    try{
      const raw=JSON.parse(localStorage.getItem(this.CACHE_KEY)||'null');
      if(raw&&raw.rec&&raw.when) return raw;
    }catch(e){}
    return null;
  },
  _writeCache(rec,when){
    try{ localStorage.setItem(this.CACHE_KEY,JSON.stringify({rec,when})); }catch(e){}
  },

  _showLoading(){
    document.getElementById('gp-rec-loading').classList.add('visible');
    document.getElementById('gp-rec').classList.remove('visible');
  },
  _hideLoading(){
    document.getElementById('gp-rec-loading').classList.remove('visible');
  },
  _hide(){
    document.getElementById('gp-rec').classList.remove('visible');
  },

  _render(rec,when){
    this._lastRec=rec;
    if(typeof ATMOSPHERE!=='undefined') ATMOSPHERE.apply(); // V3: re-attune field to the fresh reading
    document.getElementById('gp-rec-intention').textContent='"'+(rec.intention||'')+'"';
    document.getElementById('gp-rec-rationale').textContent=rec.rationale||'';

    const waveRoman=['I','II','III','IV','V','VI','VII'][((rec.recommendedWave|0)-1)]||'I';
    const chips=[
      {label:'Wave',     value:'Wave '+waveRoman},
      {label:'Frequency',value:(rec.recommendedFreq||432)+' Hz'},
      {label:'Breath',   value:rec.recommendedBreath||'Coherence 5-5'}
    ];
    document.getElementById('gp-rec-chips').innerHTML=chips.map(c=>
      `<span class="gp-rec-chip"><span class="gp-rec-chip-label">${escapeHTML(c.label)}</span> ${escapeHTML(c.value)}</span>`
    ).join('');

    const ageMin=Math.round((Date.now()-when)/60000);
    document.getElementById('gp-rec-when').textContent=
      ageMin<1?'just now':ageMin===1?'1 min ago':ageMin+' min ago';

    document.getElementById('gp-rec').classList.add('visible');
  },

  _apply(){
    const rec=this._lastRec;
    if(!rec){ toast('No recommendation to apply.'); return; }

    // 1. Wave — open the card and pulse it (only if unlocked)
    const waveIdx=Math.max(0,Math.min(6,(rec.recommendedWave|0)-1));
    document.querySelectorAll('.wave-card').forEach(c=>{ c.classList.remove('gp-recommended','open'); });
    const waveEl=document.getElementById('wave-'+waveIdx);
    if(waveEl){
      if(!waveEl.classList.contains('wave-locked')) waveEl.classList.add('open');
      waveEl.classList.add('gp-recommended');
      setTimeout(()=>waveEl.classList.remove('gp-recommended'),8000);
    }

    // 2. Frequency — visual highlight only, don't auto-start the oscillator
    const freqIdx=SOLFEGGIO.findIndex(s=>s.hz===(rec.recommendedFreq|0));
    if(freqIdx>=0){
      document.querySelectorAll('.solf-card').forEach(c=>c.classList.remove('gp-recommended'));
      const fEl=document.getElementById('solf-'+freqIdx);
      if(fEl){ fEl.classList.add('gp-recommended'); setTimeout(()=>fEl.classList.remove('gp-recommended'),8000); }
    }

    // 3. Breath — setBreath is safe (no auto-start), then visually pulse
    const breathIdx=BREATH_PATTERNS.findIndex(p=>p.name===rec.recommendedBreath);
    if(breathIdx>=0){
      setBreath(breathIdx);
      const bEl=document.getElementById('bp-'+breathIdx);
      if(bEl){ bEl.classList.add('gp-recommended'); setTimeout(()=>bEl.classList.remove('gp-recommended'),8000); }
    }

    // 4. Switch to Sessions screen + scroll top. show() needs event.target so we bypass.
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    document.getElementById('screen-sessions').classList.add('active');
    const navBtn=Array.from(document.querySelectorAll('.nav-btn')).find(b=>b.dataset.arg==='sessions');
    if(navBtn) navBtn.classList.add('active');
    window.scrollTo({top:0,behavior:'smooth'});

    toast('Council applied · Wave '+(rec.recommendedWave|0)+' · '+(rec.recommendedFreq|0)+' Hz');
  }
};

// ═══════════════════════════ V4e · CODE OF THE DAY ═══════════════════════════
// Deterministic per-day rotation through the 9 codes. Same day = same code
// for everyone (community sync). Cached per-day so picks are stable until
// midnight even if the user reloads.
const CODE_OF_DAY={
  KEY:'gp_cotd',
  CODES:[
    {code:'1111',intent:'Alignment · Presence · Quantum Self',text:'Today belongs to the version of you who already lives in freedom. Move from that vibration, not toward it.'},
    {code:'528 Hz',intent:'Healing · DNA Repair · Vitality',text:'Every cell is listening. Speak to your body today as if it were a beloved animal — with reverence, not management.'},
    {code:'432 Hz',intent:'Peace · Groundedness · Natural Order',text:'Match the breath of the planet today. Slow down enough to feel the field carrying you.'},
    {code:'888',intent:'Abundance · Receiving · Flow',text:'Practice receiving without flinching today. Notice what wants to come in that you reflexively decline.'},
    {code:'369',intent:'Manifestation · Certainty · Creation',text:'Three times today, speak the future as already complete. Tesla\'s code is rhythm — not wishing.'},
    {code:'55515',intent:'Wealth · Freedom · Life Upgrade',text:'Every change accelerating in your reality is in your favor — even the ones disguised as loss. Stay with it.'},
    {code:'Focus 15',intent:'Liberation · Time Freedom · Authorship',text:'You exist beyond the limits of time. The past does not define the next hour. Choose now from the timeless self.'},
    {code:'Shadow',intent:'Integration · Wholeness · Jung',text:'What you judged in someone yesterday is the doorway today. Walk in.'},
    {code:'Gateway',intent:'Consciousness · OBE · Monroe',text:'Mind awake, body asleep — the doorway is always already open. You just have to let the body fall.'},
  ],
  init(){
    const today=new Date().toISOString().slice(0,10);
    let saved=null; try{ saved=JSON.parse(localStorage.getItem(this.KEY)||'null'); }catch(e){}
    if(!saved || saved.date!==today){
      // Deterministic hash from date so everyone on the planet sees the same code today
      const h=[...today].reduce((a,c)=>((a<<5)-a+c.charCodeAt(0))|0,0);
      const idx=Math.abs(h)%this.CODES.length;
      saved={date:today,idx};
      try{ localStorage.setItem(this.KEY,JSON.stringify(saved)); }catch(e){}
    }
    const c=this.CODES[saved.idx];
    this._current=c; // exposed for ATMOSPHERE
    document.getElementById('gp-cotd-code').textContent=c.code;
    document.getElementById('gp-cotd-intent').textContent=c.intent;
    document.getElementById('gp-cotd-text').textContent='"'+c.text+'"';
  }
};

// ═══════════════════════════ V3 · ADAPTIVE ATMOSPHERE ═══════════════════════════
// The environment attunes to who you are today. On open (and after each new
// journal entry), the particle field's color/intensity + the resonance pitch
// are set from three signals already in the app:
//   1. The Council's latest pre-session recommendation (recommendedFreq)
//   2. Your HRV trend (improving coherence → brighter, calmer field)
//   3. The Code of the Day (its frequency, when it has one)
// Non-intrusive: it tints the field and (if Field Resonance is on) the drone.
// It never starts audio on its own or forces a session.
const ATMOSPHERE={
  SOLF:[174,285,396,417,432,528,639,741,852,963],

  // Pull a Hz out of strings like "528 Hz", "528", "Wave III · 528 Hz"
  _hzFrom(v){
    if(v==null) return null;
    const m=String(v).match(/(\d{3})\s*hz/i) || String(v).match(/\b(\d{3})\b/);
    if(!m) return null;
    const n=parseInt(m[1],10);
    return this.SOLF.includes(n)?n:null;
  },

  // Source priority: Council rec → code-of-day → default 528 (heart/coherence)
  _chooseFrequency(){
    const rec=(typeof PRESESSION!=='undefined') && PRESESSION._lastRec;
    const fromRec=rec && this._hzFrom(rec.recommendedFreq);
    if(fromRec) return {hz:fromRec, why:'attuned to the Council\'s reading of your recent entries'};
    const cod=(typeof CODE_OF_DAY!=='undefined') && CODE_OF_DAY._current;
    const fromCod=cod && this._hzFrom(cod.code);
    if(fromCod) return {hz:fromCod, why:'set to today\'s code'};
    return {hz:528, why:'resting at 528 Hz — heart coherence'};
  },

  // HRV trend → coherence 0..1 (improving/higher = more coherent)
  _coherence(){
    let arr=[]; try{ arr=JSON.parse(localStorage.getItem('gp_biometric')||'[]'); }catch(e){}
    if(arr.length<2) return 0.5;
    const s=arr.slice().sort((a,b)=>a.at-b.at);
    const recent=s.slice(-5), prior=s.slice(-10,-5);
    const avg=a=>a.reduce((t,x)=>t+x.hrv,0)/a.length;
    const r=avg(recent), p=prior.length?avg(prior):r;
    // Map improvement (-/+) into 0..1 around a 0.5 baseline
    const delta=(r-p)/(p||1);
    return Math.max(0,Math.min(1, 0.5 + delta*1.5));
  },

  apply(){
    const {hz,why}=this._chooseFrequency();
    const coherence=this._coherence();
    // Drive the visual field (colors + intensity) and the resonance pitch
    if(typeof THREE_FIELD!=='undefined'){
      THREE_FIELD.setFrequency(hz,true);
      if(THREE_FIELD._state){ THREE_FIELD._state.intensity=0.45+coherence*0.4; }
    }
    if(typeof FIELD_AUDIO!=='undefined') FIELD_AUDIO.setFrequency(hz,true);

    // Subtle indicator on the home screen
    const el=document.getElementById('gp-atmosphere');
    if(el){
      const feel = coherence>0.62 ? 'coherent' : coherence<0.38 ? 'settling' : 'attuned';
      el.innerHTML=`<span class="gp-atmosphere-dot"></span>Today's field · <b>${hz} Hz</b> · ${why} · <b>${feel}</b>`;
      el.style.display='flex';
    }
  },

  // V3.3 · mid-session evolution. Called each second of a running session
  // with pct 0..1. The field calms and refines as the practitioner descends
  // (brighter/denser at entry → quieter/finer in deep theta). Color stays
  // tied to the real active frequency (reactGeometry owns that) so we only
  // shape intensity + particle size here — non-conflicting.
  sessionTick(pct){
    pct=Math.max(0,Math.min(1,pct));
    if(typeof THREE_FIELD!=='undefined' && THREE_FIELD._ready){
      if(THREE_FIELD._state) THREE_FIELD._state.intensity = 0.82 - pct*0.46;   // 0.82 → 0.36
      if(THREE_FIELD._points && THREE_FIELD._points.material){
        THREE_FIELD._points.material.size = 0.62 + (1-pct)*0.34;               // denser feel early
      }
    }
  }
};

// ═══════════════════════════ V3 · CONSCIOUSNESS SIGNATURE (living data) ═══════════════════════════
// A generative mandala drawn entirely from the practitioner's own data:
//   • orbital rings        = waves mastered (waveCompletions ≥ unlock threshold)
//   • points per ring      = scaled by total sessions
//   • hue                  = dominant frequency (ATMOSPHERE's chosen Hz)
//   • rotation speed       = HRV coherence
//   • journal count        = inner bloom petals
// Animates softly. This is "living data" — your practice rendered as art.
const SIGNATURE={
  _raf:null,_canvas:null,_ctx:null,_t:0,
  start(){
    this._canvas=document.getElementById('gp-signature'); if(!this._canvas) return;
    this._ctx=this._canvas.getContext('2d');
    if(this._raf) cancelAnimationFrame(this._raf);
    this._loop();
  },
  stop(){ if(this._raf){ cancelAnimationFrame(this._raf); this._raf=null; } },
  _data(){
    const d=DB.load();
    const waves=(d.waveCompletions||[]).filter(c=>c>=3).length;        // mastered waves
    const sessions=d.sessions||0;
    const journal=(d.journal||[]).length;
    const reqs=[0,3,5,7,5,5,3];
    const rings=Math.max(1, waves||1) + 2;                              // always show a few rings
    const hz=(typeof ATMOSPHERE!=='undefined') ? (ATMOSPHERE._chooseFrequency().hz) : 528;
    const coherence=(typeof ATMOSPHERE!=='undefined') ? ATMOSPHERE._coherence() : 0.5;
    return {waves,sessions,journal,rings,hz,coherence};
  },
  _hue(hz){ // map 174–963Hz to a hue arc (indigo→gold→violet feel)
    const n=Math.max(0,Math.min(1,(hz-174)/(963-174)));
    return 250 - n*210; // 250(indigo) → 40(gold)
  },
  _loop(){
    this._raf=requestAnimationFrame(()=>this._loop());
    const c=this._ctx, cv=this._canvas; if(!c) return;
    // Skip drawing when the Progress screen isn't visible (saves cycles)
    const scr=document.getElementById('screen-progress');
    if(!scr||!scr.classList.contains('active')) return;
    const W=cv.width,H=cv.height,cx=W/2,cy=H/2;
    const D=this._data();
    this._t+=0.003+D.coherence*0.004;
    c.clearRect(0,0,W,H);
    const hue=this._hue(D.hz);

    // Inner bloom — petals from journal entries
    const petals=Math.max(6,Math.min(24, 6+D.journal));
    c.save(); c.translate(cx,cy); c.rotate(this._t*0.5);
    for(let i=0;i<petals;i++){
      const a=(i/petals)*Math.PI*2;
      c.beginPath();
      c.ellipse(Math.cos(a)*22, Math.sin(a)*22, 10, 3, a, 0, Math.PI*2);
      c.fillStyle=`hsla(${hue},60%,60%,0.10)`; c.fill();
    }
    c.restore();

    // Orbital rings — one per ring, points scaled by sessions
    for(let r=0;r<D.rings;r++){
      const radius=40 + r*((Math.min(W,H)/2 - 50)/D.rings);
      const pts=Math.max(12, Math.min(120, 12 + D.sessions*2 + r*6));
      const dir=r%2?-1:1;
      const rot=this._t*dir*(0.6 - r*0.04);
      const light=45 + r*4;
      for(let i=0;i<pts;i++){
        const a=(i/pts)*Math.PI*2 + rot;
        const x=cx+Math.cos(a)*radius, y=cy+Math.sin(a)*radius;
        const sz=0.7 + (Math.sin(this._t*2 + i)*0.5+0.5)*1.1;
        c.beginPath(); c.arc(x,y,sz,0,Math.PI*2);
        c.fillStyle=`hsla(${hue + r*6},65%,${light}%,${0.35+0.4*(r/D.rings)})`;
        c.fill();
      }
    }
    // Core
    const pulse=0.5+Math.sin(this._t*1.5)*0.5;
    const grad=c.createRadialGradient(cx,cy,0,cx,cy,18+pulse*6);
    grad.addColorStop(0,`hsla(${hue},80%,75%,0.9)`);
    grad.addColorStop(1,`hsla(${hue},80%,60%,0)`);
    c.fillStyle=grad; c.beginPath(); c.arc(cx,cy,24,0,Math.PI*2); c.fill();
  }
};

// ═══════════════════════════ V3 · FOCUS MODE + EARNED MINIMALISM ═══════════════════════════
const FOCUS={
  KEY:'gp_focus',
  init(){
    // Restore last focus state
    if(localStorage.getItem(this.KEY)==='1') document.body.classList.add('gp-focus');
    // 'f' toggles focus when not typing in a field
    document.addEventListener('keydown',(e)=>{
      if(e.key!=='f'&&e.key!=='F') return;
      const t=e.target.tagName;
      if(t==='INPUT'||t==='TEXTAREA'||t==='SELECT'||e.metaKey||e.ctrlKey) return;
      this.toggle();
    });
    // Reflect the practitioner's tier so the chrome quiets as they advance
    this.applyTier();
  },
  toggle(){
    const on=document.body.classList.toggle('gp-focus');
    try{ localStorage.setItem(this.KEY,on?'1':'0'); }catch(e){}
    toast(on?'Focus mode — press f to exit':'Focus mode off');
  },
  applyTier(){
    try{ document.body.dataset.tier=String((DB.load().tier)||0); }catch(e){}
  }
};

// ═══════════════════════════ V3.4 · ORBITAL NAVIGATION (experimental) ═══════════════════════════
// An opt-in 3D ring of section nodes floating over the particle field. The
// flat nav stays the default; this is an alternative launcher (press "o"
// when enabled in Settings → Visuals). A genuine prototype — a standard
// CSS-3D carousel rather than full WebGL raycasting, kept honest about its
// experimental status.
const ORBITAL={
  KEY:'gp_orbital',
  _open:false,_angle:0,_target:0,_nodes:[],_raf:null,_drag:null,_R:340,
  enabled(){ return localStorage.getItem(this.KEY)==='1'; },
  setEnabled(on){ try{ localStorage.setItem(this.KEY,on?'1':'0'); }catch(e){}
    toast(on?'Orbital nav on — press O to open':'Orbital nav off'); if(!on&&this._open) this.close(); },
  init(){
    const box=document.getElementById('gp-orbital-toggle');
    if(box){ box.checked=this.enabled(); box.onchange=()=>this.setEnabled(box.checked); }
    document.addEventListener('keydown',(e)=>{
      const t=e.target.tagName, typing=(t==='INPUT'||t==='TEXTAREA'||t==='SELECT');
      if((e.key==='o'||e.key==='O') && this.enabled() && !typing && !e.metaKey && !e.ctrlKey){ this.toggle(); }
      if(this._open && e.key==='Escape') this.close();
      if(this._open && e.key==='ArrowLeft'){ this._target += 360/Math.max(1,this._nodes.length); }
      if(this._open && e.key==='ArrowRight'){ this._target -= 360/Math.max(1,this._nodes.length); }
    });
  },
  _build(){
    const ring=document.getElementById('gp-orbital-ring'); if(!ring) return;
    ring.innerHTML='';
    const navs=Array.from(document.querySelectorAll('.nav .nav-btn'));
    this._R=Math.min(window.innerWidth,window.innerHeight)*0.36;
    const n=navs.length;
    this._nodes=navs.map((b,i)=>{
      const id=b.dataset.arg||null;
      const node=document.createElement('button');
      node.className='gp-orbital-node';
      node.textContent=b.textContent.trim();
      const baseAngle=(i/n)*360;
      node.style.transform=`rotateY(${baseAngle}deg) translateZ(${this._R}px)`;
      node.onclick=(ev)=>{ ev.stopPropagation(); this.close(); if(id) showScreen(id); };
      ring.appendChild(node);
      return {node,baseAngle};
    });
  },
  toggle(){ this._open?this.close():this.open(); },
  open(){
    if(this._open) return; this._open=true;
    const ov=document.getElementById('gp-orbital'); if(!ov) return;
    ov.classList.add('show'); ov.setAttribute('aria-hidden','false');
    this._build();
    ov.onpointerdown=(e)=>{ this._drag={x:e.clientX,a:this._target}; };
    window.addEventListener('pointermove',this._onMove=(e)=>{ if(this._drag) this._target=this._drag.a+(e.clientX-this._drag.x)*0.4; });
    window.addEventListener('pointerup',this._onUp=()=>{ this._drag=null; });
    this._spin();
  },
  close(){
    if(!this._open) return; this._open=false;
    const ov=document.getElementById('gp-orbital');
    ov.classList.remove('show'); ov.setAttribute('aria-hidden','true'); ov.onpointerdown=null;
    if(this._raf){ cancelAnimationFrame(this._raf); this._raf=null; }
    if(this._onMove) window.removeEventListener('pointermove',this._onMove);
    if(this._onUp) window.removeEventListener('pointerup',this._onUp);
    this._drag=null;
  },
  _spin(){
    this._raf=requestAnimationFrame(()=>this._spin());
    if(!this._drag) this._target+=0.12;                 // gentle auto-rotate
    this._angle += (this._target-this._angle)*0.1;
    const ring=document.getElementById('gp-orbital-ring');
    if(ring) ring.style.transform=`translateZ(-${this._R}px) rotateY(${this._angle}deg)`;
    // Fade nodes at the back so the front reads clearly
    this._nodes.forEach(o=>{
      const world=((o.baseAngle+this._angle)%360+360)%360;
      const facing=Math.cos(world*Math.PI/180);         // 1 front, -1 back
      o.node.style.opacity=(0.30+0.70*((facing+1)/2)).toFixed(3);
    });
  }
};

// ═══════════════════════════ V3 · RITUAL ARRIVAL ═══════════════════════════
// A short, skippable launch sequence: arrive → one guided breath → set a
// single intention → the app reveals. Sets the tone instead of dumping you
// on a dashboard. Remembered: a checkbox disables it on future launches.
const ARRIVAL={
  KEY:'gp_arrival_disabled',
  _timers:[],
  shouldShow(){ return localStorage.getItem(this.KEY)!=='1'; },

  begin(){
    if(!this.shouldShow()) return;
    const ov=document.getElementById('gp-arrival'); if(!ov) return;
    ov.classList.add('show'); ov.setAttribute('aria-hidden','false');
    const breath=document.getElementById('gp-arrival-breath');
    const label=document.getElementById('gp-arrival-breath-label');
    const text=document.getElementById('gp-arrival-text');
    const prompt=document.getElementById('gp-arrival-prompt');
    const inp=document.getElementById('gp-arrival-intention');
    const reduced=document.body.classList.contains('gp-reduced')||
      (window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const t=(fn,ms)=>{ this._timers.push(setTimeout(fn,ms)); };
    if(inp) inp.onkeydown=(e)=>{ if(e.key==='Enter') this.complete(); };

    if(reduced){
      text.textContent='Arrive. Set one intention.'; label.textContent='∞';
      prompt.classList.add('show'); inp&&inp.focus();
      return;
    }
    // Guided single breath (4s in · ~1.5s hold · 4s out) → intention prompt
    text.textContent='Arrive.';
    t(()=>{ text.textContent='Breathe in…'; label.textContent='In'; breath.classList.add('inhale'); }, 1400);
    t(()=>{ text.textContent='Hold.'; label.textContent='Hold'; }, 5500);
    t(()=>{ text.textContent='And release…'; label.textContent='Out'; breath.classList.remove('inhale'); }, 7000);
    t(()=>{ text.textContent='What is your intention?'; label.textContent='∞';
            prompt.classList.add('show'); inp&&inp.focus(); }, 11200);
  },

  _finish(){
    this._timers.forEach(clearTimeout); this._timers=[];
    const never=document.getElementById('gp-arrival-never');
    if(never&&never.checked){ try{ localStorage.setItem(this.KEY,'1'); }catch(e){} }
    const ov=document.getElementById('gp-arrival');
    ov.classList.add('closing'); ov.setAttribute('aria-hidden','true');
    setTimeout(()=>{ ov.classList.remove('show','closing'); if(typeof SETUP!=='undefined') SETUP.maybeBegin(); },1000);
  },

  complete(){
    const inp=document.getElementById('gp-arrival-intention');
    const intention=((inp&&inp.value)||'').trim();
    this._finish();
    if(intention){
      setTimeout(()=>{
        const ta=document.querySelector('#journal-grid textarea');
        if(ta && !ta.value) ta.value=intention; // seed the journal's first prompt
        toast('Intention set · '+intention.slice(0,60));
      },1100);
    }
  },

  skip(){ this._finish(); }
};

// ═══════════════════════════ FIRST-RUN SETUP WIZARD ═══════════════════════════
// Shown once, after the arrival ritual: pick what draws you here, optionally add
// the Council key (kept in the OS keychain), then land on Today. Idempotent —
// gated by a localStorage flag so it never reappears once completed.
const SETUP = {
  KEY:'gp_setup_done',
  GOAL_KEY:'gp_goal',
  GOALS:[
    {k:'relaxation',label:'Deep rest'},
    {k:'gateway',   label:'Gateway training'},
    {k:'healing',   label:'Healing'},
    {k:'manifest',  label:'Manifestation'},
    {k:'shadow',    label:'Shadow work'},
    {k:'explore',   label:'Just exploring'},
  ],
  _goal:null,
  shouldShow(){ try{ return localStorage.getItem(this.KEY)!=='1'; }catch(e){ return false; } },
  maybeBegin(){
    if(!this.shouldShow()) return;
    const ov=document.getElementById('gp-setup'); if(!ov || ov.classList.contains('show')) return;
    const goals=document.getElementById('gp-setup-goals');
    if(goals) goals.innerHTML=this.GOALS.map(g=>`<button data-act="setup-goal" data-arg="${g.k}">${g.label}</button>`).join('');
    this._showStep(1);
    this._prevFocus=document.activeElement;
    ov.classList.add('show'); ov.setAttribute('aria-hidden','false');
  },
  _showStep(n){
    document.querySelectorAll('#gp-setup .gp-setup-step').forEach(s=>{ s.hidden=(parseInt(s.dataset.step,10)!==n); });
    const f=document.querySelector('#gp-setup .gp-setup-step:not([hidden]) button, #gp-setup .gp-setup-step:not([hidden]) input');
    if(f) setTimeout(()=>{ try{ f.focus(); }catch(e){} },0);
  },
  pickGoal(k){
    this._goal=k;
    document.querySelectorAll('#gp-setup-goals button').forEach(b=>b.classList.toggle('sel', b.dataset.arg===k));
  },
  next(){ this._showStep(2); },
  finish(){
    const keyEl=document.getElementById('gp-setup-key');
    const key=keyEl?keyEl.value.trim():'';
    if(key && typeof KEYS!=='undefined'){ try{ KEYS.set('anthropic', key); }catch(e){} }
    try{ localStorage.setItem(this.KEY,'1'); }catch(e){}
    if(this._goal){ try{ localStorage.setItem(this.GOAL_KEY,this._goal); }catch(e){} }
    const ov=document.getElementById('gp-setup');
    if(ov){ ov.classList.remove('show'); ov.setAttribute('aria-hidden','true'); }
    if(this._prevFocus && this._prevFocus.focus){ try{ this._prevFocus.focus(); }catch(e){} }
    if(typeof showScreen==='function') showScreen('today');
    toast('Welcome. Your field is open.');
  }
};

// ═══════════════════════════ V4a · MONTHLY PATTERN RECOGNITION ═══════════════════════════
const PATTERNS={
  async analyze(){
    const btn=document.getElementById('gp-pat-btn');
    const results=document.getElementById('gp-pat-results');
    // 30-day window
    const cutoff=Date.now()-30*24*60*60*1000;
    const entries=(DB.load().journal||[]).filter(j=>{
      const t=new Date(j.date).getTime();
      return !isNaN(t) && t>=cutoff;
    });
    if(entries.length<3){ GP_ASYNC.empty(results, 'Add at least 3 journal entries in the last 30 days, then the Council can read your patterns.'); return; }
    btn.disabled=true; btn.textContent='Reading…';
    GP_ASYNC.loading(results, 'Reading the last 30 days…');
    try{
      const payload=entries.map(e=>({
        date:new Date(e.date).toLocaleDateString(),
        data:e.data||[]
      }));
      const r=await GP_API.monthlyPatterns({entries:payload});
      results.innerHTML=`
        <div class="gp-pat-block">
          <div class="gp-pat-block-h">Recurring Themes</div>
          <ul>${(r.themes||[]).map(t=>`<li>${escapeHTML(t)}</li>`).join('')}</ul>
        </div>
        ${r.breakthroughs?.length?`<div class="gp-pat-block">
          <div class="gp-pat-block-h">Breakthroughs</div>
          <ul>${r.breakthroughs.map(t=>`<li>${escapeHTML(t)}</li>`).join('')}</ul>
        </div>`:''}
        <div class="gp-pat-block">
          <div class="gp-pat-block-h">Unintegrated Shadows</div>
          <ul>${(r.shadows||[]).map(t=>`<li>${escapeHTML(t)}</li>`).join('')}</ul>
        </div>
        <div class="gp-pat-block">
          <div class="gp-pat-block-h">Coherence Arc</div>
          <div class="gp-pat-arc">"${escapeHTML(r.coherenceArc||'')}"</div>
        </div>
        <div class="gp-pat-block">
          <div class="gp-pat-block-h">Council's Suggestion</div>
          <div style="color:var(--gold);font-size:15px;line-height:1.7">${escapeHTML(r.suggestion||'')}</div>
        </div>
      `;
      results.classList.add('visible');
    }catch(e){
      const raw=parseFailRaw(e);
      if(raw){
        results.innerHTML='<div class="gp-pat-block"><div class="gp-pat-block-h">Unstructured Response</div><pre style="white-space:pre-wrap;font-size:15px;color:var(--muted);max-height:240px;overflow:auto">'+escapeHTML(raw)+'</pre></div>';
        results.classList.add('visible');
      } else {
        // Inline, recoverable error instead of a transient toast.
        GP_ASYNC.error(results, 'The Council could not be reached: '+humanError(e), 'patterns-analyze');
      }
    }finally{
      btn.disabled=false; btn.textContent='Analyze Last 30 Days';
    }
  }
};

// ═══════════════════════════ V4b · CUSTOM AFFIRMATION GENERATOR ═══════════════════════════
const AFFIRM_GEN={
  _last:null,
  async generate(){
    const intention=document.getElementById('gp-genaff-intention').value.trim();
    const code=document.getElementById('gp-genaff-code').value;
    if(!intention || !code){ toast('Pick a code and write an intention first.'); return; }
    const resultEl=document.getElementById('gp-genaff-result');
    resultEl.classList.remove('visible');
    try{
      const r=await GP_API.generateAffirmation({intention,code});
      this._last={code,text:r.affirmation,intent:r.intent};
      document.getElementById('gp-genaff-aff').textContent='"'+r.affirmation+'"';
      document.getElementById('gp-genaff-intent2').textContent=r.intent||'';
      resultEl.classList.add('visible');
      document.getElementById('gp-genaff-save').disabled=false;
    }catch(e){
      toast('Affirmation: '+humanError(e));
    }
  },
  save(){
    if(!this._last) return;
    const d=DB.load();
    d.customAffirmations=[...(d.customAffirmations||[]),{...this._last,date:new Date().toISOString()}];
    DB.save(d);
    toast('Saved to My Affirmations.');
    if(typeof buildAffirmations==='function') buildAffirmations(); // re-render the wheel + list
    document.getElementById('gp-genaff-save').disabled=true;
  }
};

// ═══════════════════════════ V4c · SHADOW WORK DIALOGUE ═══════════════════════════
const SHADOW={
  _history:[],
  _open:false,
  _busy:false,

  open(){
    if(this._open) return;
    this._open=true;
    this._history=[];
    document.getElementById('gp-shadow-modal').classList.add('visible');
    document.getElementById('gp-shadow-log').innerHTML='';
    // V5d: restore last voice-toggle preference + persist on change
    const vbox=document.getElementById('gp-shadow-voice');
    if(vbox){
      vbox.checked = localStorage.getItem('gp_shadow_voice')==='1';
      vbox.onchange=()=>{
        try{ localStorage.setItem('gp_shadow_voice', vbox.checked?'1':'0'); }catch(e){}
      };
    }
    // Auto-kick off — Jung speaks first
    this._appendSystem('Jung is listening. Speak whatever is surfacing.');
    setTimeout(()=>this.send(true),300);
    // Esc to close
    this._esc=(ev)=>{ if(ev.key==='Escape') this.close(); };
    document.addEventListener('keydown',this._esc);
    // Enter to send
    const ta=document.getElementById('gp-shadow-input');
    ta.value='';
    ta.focus();
    this._enter=(ev)=>{
      if(ev.key==='Enter' && !ev.shiftKey){ ev.preventDefault(); this.send(); }
    };
    ta.addEventListener('keydown',this._enter);
    // Focus trap: keep Tab within the modal so keyboard users can't tab out
    // into the hidden app behind it. Remember the trigger to restore on close.
    this._prevFocus = document.activeElement;
    const modal = document.getElementById('gp-shadow-modal');
    this._trap = (ev)=>{
      if(ev.key!=='Tab') return;
      const f = modal.querySelectorAll('a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])');
      const items = Array.from(f).filter(el=>el.offsetParent!==null);
      if(!items.length) return;
      const first=items[0], last=items[items.length-1];
      if(ev.shiftKey && document.activeElement===first){ ev.preventDefault(); last.focus(); }
      else if(!ev.shiftKey && document.activeElement===last){ ev.preventDefault(); first.focus(); }
    };
    modal.addEventListener('keydown', this._trap);
  },

  close(){
    if(!this._open) return;
    this._open=false;
    const modal=document.getElementById('gp-shadow-modal');
    modal.classList.remove('visible');
    if(this._esc){ document.removeEventListener('keydown',this._esc); this._esc=null; }
    const ta=document.getElementById('gp-shadow-input');
    if(this._enter){ ta.removeEventListener('keydown',this._enter); this._enter=null; }
    if(this._trap){ modal.removeEventListener('keydown',this._trap); this._trap=null; }
    // Restore focus to whatever opened the dialogue.
    if(this._prevFocus && this._prevFocus.focus){ try{ this._prevFocus.focus(); }catch(e){} this._prevFocus=null; }
    // Save the dialogue as a journal entry under a "Shadow Dialogue" session
    if(this._history.length>=2){
      const entry={
        id:Date.now(),
        date:new Date().toISOString(),
        session:'Shadow Dialogue',
        data:this._history.map((m,i)=>({
          prompt: m.role==='assistant' ? 'Jung' : 'Me',
          response: m.content
        }))
      };
      DB.addJournalEntry(entry);
      if(typeof renderJournalHistory==='function') renderJournalHistory();
      toast('Shadow dialogue saved to journal.');
      PRESESSION.request(true); // new entry → re-read recommendations
    }
  },

  async send(isOpening=false){
    if(this._busy) return;
    const ta=document.getElementById('gp-shadow-input');
    const text=isOpening===true ? '' : ta.value.trim();
    if(!isOpening && !text) return;
    if(!isOpening){
      this._appendMsg('user',text);
      this._history.push({role:'user',content:text});
      ta.value='';
    }
    this._busy=true;
    this._appendThinking();
    try{
      const r=await GP_API.shadowDialogue({history:this._history,message:isOpening?'(beginning)':text});
      this._removeThinking();
      this._appendMsg('jung',r.reply);
      this._history.push({role:'assistant',content:r.reply});
      // V5d: speak Jung's reply through the active TTS engine if Voice is on.
      // Slower rate than session cues to match the contemplative register.
      const voiceBox=document.getElementById('gp-shadow-voice');
      if(voiceBox && voiceBox.checked && VOICE.enabled){
        try{ VOICE.speak(r.reply,{rate:0.72}); }catch(e){ console.warn('Shadow TTS failed:',e); }
      }
      if(r.isComplete){
        this._appendSystem('Integration reached. The dialogue closes naturally — but you can keep talking, or close to save.');
      }
    }catch(e){
      this._removeThinking();
      this._appendSystem('Council unreachable: '+(e.message||e));
    }finally{
      this._busy=false;
    }
  },

  _appendMsg(who,text){
    const log=document.getElementById('gp-shadow-log');
    const d=document.createElement('div');
    d.className='gp-shadow-msg '+(who==='jung'?'jung':'user');
    d.textContent=text;
    log.appendChild(d);
    log.scrollTop=log.scrollHeight;
  },
  _appendSystem(text){
    const log=document.getElementById('gp-shadow-log');
    const d=document.createElement('div');
    d.className='gp-shadow-msg system';
    d.textContent='— '+text+' —';
    log.appendChild(d);
    log.scrollTop=log.scrollHeight;
  },
  _appendThinking(){
    const log=document.getElementById('gp-shadow-log');
    const d=document.createElement('div');
    d.className='gp-shadow-thinking';
    d.id='gp-shadow-thinking';
    d.innerHTML='<span class="gp-dot"></span><span class="gp-dot"></span><span class="gp-dot"></span> Jung is considering…';
    log.appendChild(d);
    log.scrollTop=log.scrollHeight;
  },
  _removeThinking(){
    const t=document.getElementById('gp-shadow-thinking');
    if(t) t.remove();
  }
};

// ═══════════════════════════ V4d · SYNCHRONICITY LOG + AI ANALYSIS ═══════════════════════════
const SYNC={
  init(){
    this.render();
  },
  add(){
    const ta=document.getElementById('gp-sync-text');
    const text=ta.value.trim();
    if(!text){ toast('Describe the synchronicity first.'); return; }
    const d=DB.load();
    d.synchronicities=[...(d.synchronicities||[]),{
      id:Date.now(),
      date:new Date().toISOString(),
      text
    }];
    DB.save(d);
    ta.value='';
    this.render();
    toast('Synchronicity anchored.');
  },
  remove(id){
    const d=DB.load();
    d.synchronicities=(d.synchronicities||[]).filter(s=>s.id!==id);
    DB.save(d);
    this.render();
  },
  render(){
    const syncs=(DB.load().synchronicities||[]).slice().reverse();
    document.getElementById('gp-sync-count').textContent=syncs.length;
    const list=document.getElementById('gp-sync-list');
    if(!syncs.length){
      list.innerHTML='<div style="font-size:15px;color:var(--muted);font-style:italic;padding:1rem;text-align:center">No syncs yet. The field becomes visible the moment you start watching.</div>';
      const wrap=document.getElementById('gp-sync-field-wrap'); if(wrap) wrap.style.display='none';
      this._stopField();
      return;
    }
    list.innerHTML=syncs.map(s=>{
      const dt=new Date(s.date);
      const date=dt.toLocaleDateString('en',{month:'short',day:'numeric'});
      const time=dt.toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'});
      return `<div class="gp-sync-item">
        <div class="text">"${escapeHTML(s.text)}"</div>
        <div class="meta">${date}<br>${time}<br><a href="#" data-act="sync-remove" data-id="${s.id}" style="color:var(--muted);text-decoration:none;font-size:13px">remove</a></div>
      </div>`;
    }).join('');
    // V3.2 · render the living Synchronicity Field
    const wrap=document.getElementById('gp-sync-field-wrap'); if(wrap) wrap.style.display='block';
    this._startField();
  },

  // ── V3.2 · Synchronicity Field (generative) ──
  _fieldRaf:null,_fieldT:0,
  _startField(){
    const cv=document.getElementById('gp-sync-field'); if(!cv) return;
    this._fieldCtx=cv.getContext('2d');
    if(this._fieldRaf) cancelAnimationFrame(this._fieldRaf);
    this._fieldLoop();
  },
  _stopField(){ if(this._fieldRaf){ cancelAnimationFrame(this._fieldRaf); this._fieldRaf=null; } },
  _fieldLoop(){
    this._fieldRaf=requestAnimationFrame(()=>this._fieldLoop());
    const scr=document.getElementById('screen-synchronicity');
    if(!scr||!scr.classList.contains('active')) return; // only draw when visible
    const c=this._fieldCtx, cv=c&&c.canvas; if(!c) return;
    const W=cv.width,H=cv.height,cx=W/2,cy=H/2,maxR=Math.min(W,H)/2-16;
    const syncs=(DB.load().synchronicities||[]);
    this._fieldT+=0.004;
    c.clearRect(0,0,W,H);

    // Concentric guide rings (today → older)
    c.strokeStyle='rgba(201,168,76,0.08)'; c.lineWidth=1;
    for(let r=1;r<=3;r++){ c.beginPath(); c.arc(cx,cy,maxR*r/3,0,Math.PI*2); c.stroke(); }

    const now=Date.now(), span=30*24*3600*1000; // 30-day window for radius
    const pts=syncs.map(s=>{
      const dt=new Date(s.date);
      const tod=(dt.getHours()*60+dt.getMinutes())/1440;          // 0..1 time of day → angle
      const age=Math.min(1,(now-dt.getTime())/span);              // 0(new)..1(old) → radius
      const ang=tod*Math.PI*2 - Math.PI/2;
      const rad=20 + age*(maxR-20);
      return {x:cx+Math.cos(ang)*rad, y:cy+Math.sin(ang)*rad, age, t:dt.getTime()};
    });

    // Connect temporally-near syncs (clusters) with faint lines
    c.lineWidth=1;
    for(let i=0;i<pts.length;i++){
      for(let j=i+1;j<pts.length;j++){
        if(Math.abs(pts[i].t-pts[j].t) < 6*3600*1000){           // within 6h
          c.strokeStyle='rgba(201,168,76,0.10)';
          c.beginPath(); c.moveTo(pts[i].x,pts[i].y); c.lineTo(pts[j].x,pts[j].y); c.stroke();
        }
      }
    }
    // Points — newer = brighter/larger, with a soft twinkle
    pts.forEach((p,i)=>{
      const tw=0.6+Math.sin(this._fieldT*2+i)*0.4;
      const a=(1-p.age)*0.8+0.2;
      const sz=2 + (1-p.age)*3;
      const glow=c.createRadialGradient(p.x,p.y,0,p.x,p.y,sz*3);
      glow.addColorStop(0,`rgba(240,216,138,${a*tw})`);
      glow.addColorStop(1,'rgba(240,216,138,0)');
      c.fillStyle=glow; c.beginPath(); c.arc(p.x,p.y,sz*3,0,Math.PI*2); c.fill();
      c.fillStyle=`rgba(255,245,210,${a})`; c.beginPath(); c.arc(p.x,p.y,sz*0.6,0,Math.PI*2); c.fill();
    });
  },
  async analyze(){
    const syncs=DB.load().synchronicities||[];
    if(syncs.length<3){ toast('Need at least 3 synchronicities for field analysis.'); return; }
    const out=document.getElementById('gp-sync-analysis');
    out.innerHTML='<div style="font-size:15px;color:var(--muted);letter-spacing:2px;text-transform:uppercase">Council reading the field…</div>';
    out.classList.add('visible');
    try{
      const payload=syncs.map(s=>({
        date:new Date(s.date).toLocaleString(),
        text:s.text
      }));
      const r=await GP_API.analyzeSynchronicities({syncs:payload});
      out.innerHTML=`
        <div class="gp-pat-block">
          <div class="gp-pat-block-h">Recurring Symbols</div>
          <ul>${(r.recurringSymbols||[]).map(t=>`<li>${escapeHTML(t)}</li>`).join('')||'<li style="color:var(--muted);font-style:italic">None yet — keep watching.</li>'}</ul>
        </div>
        <div class="gp-pat-block">
          <div class="gp-pat-block-h">Time Clusters</div>
          <div style="font-size:16px;color:var(--silver);line-height:1.7">${escapeHTML(r.timeClusters||'')}</div>
        </div>
        <div class="gp-pat-block">
          <div class="gp-pat-block-h">Themes</div>
          <ul>${(r.themes||[]).map(t=>`<li>${escapeHTML(t)}</li>`).join('')}</ul>
        </div>
        <div class="gp-pat-block">
          <div class="gp-pat-block-h">What the Field Is Showing You</div>
          <div class="gp-pat-arc">"${escapeHTML(r.fieldMessage||'')}"</div>
        </div>
      `;
    }catch(e){
      out.innerHTML='<div style="color:#c04040;font-size:15px">Field reading failed: '+escapeHTML(humanError(e))+'</div>'+(function(){const raw=parseFailRaw(e); return raw?'<pre style="white-space:pre-wrap;font-size:15px;color:var(--muted);max-height:240px;overflow:auto;margin-top:.5rem">'+escapeHTML(raw)+'</pre>':'';})();
    }
  }
};

// ═══════════════════════════ V4f · PRACTICE REMINDERS ═══════════════════════════
const REMINDERS={
  async init(){
    try{
      const cfg=await GP_API.reminders.get();
      document.getElementById('gp-rem-enabled').checked = !!cfg.enabled;
      const t=cfg.times || {morning:'07:30',midday:'13:00',evening:'21:00'};
      document.getElementById('gp-rem-morning').value=t.morning;
      document.getElementById('gp-rem-midday').value=t.midday;
      document.getElementById('gp-rem-evening').value=t.evening;
    }catch(e){ /* no-op outside Electron */ }
  },
  async save(){
    const cfg={
      enabled: document.getElementById('gp-rem-enabled').checked,
      times: {
        morning: document.getElementById('gp-rem-morning').value || '07:30',
        midday:  document.getElementById('gp-rem-midday').value  || '13:00',
        evening: document.getElementById('gp-rem-evening').value || '21:00',
      }
    };
    try{
      await GP_API.reminders.set(cfg);
      toast(cfg.enabled?'Reminders enabled':'Reminders disabled');
    }catch(e){ toast('Reminder settings need the desktop app.'); }
  }
};

// ═══════════════════════════ V5e · DATA EXPORT ═══════════════════════════
// Snapshots the full DB to a timestamped JSON file the user can save anywhere.
// Includes journal, synchronicities, custom affirmations, streaks, tier,
// session log, and the 369 tracker — everything portable.
const EXPORT={
  download(){
    const data=DB.load();
    const payload={
      _meta:{
        app:'Gateway Protocol',
        version:'2.0.0',
        exportedAt:new Date().toISOString(),
      },
      data
    };
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download='gateway-protocol-backup-'+new Date().toISOString().slice(0,10)+'.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },200);
    toast('Backup downloaded — '+(data.journal?.length||0)+' entries, '+(data.synchronicities?.length||0)+' syncs');
  }
};

// V6·T7 — data portability: import a backup, and delete just the on-device
// affect/check-in history without touching the rest.
const IMPORT={
  trigger(){ const i=document.getElementById('gp-import-input'); if(i) i.click(); },
  async handle(input){
    const file=input.files&&input.files[0]; if(!file) return;
    let payload;
    try{ payload=JSON.parse(await file.text()); }
    catch(e){ toast('Import failed: not valid JSON'); input.value=''; return; }
    const data=(payload && payload.data) ? payload.data : payload; // accept wrapped or raw
    if(!data || typeof data!=='object' || Array.isArray(data)){ toast('Import failed: unrecognized backup'); input.value=''; return; }
    if(!confirm('Import this backup? It will REPLACE your current data on this device.')){ input.value=''; return; }
    const merged={...DB.defaults(), ...data}; // fill any missing keys from the schema
    DB.save(merged);
    stats=DB.load();
    try{ updateStats(); if(typeof renderJournalHistory==='function') renderJournalHistory(); if(typeof renderToday==='function') renderToday(); }catch(e){}
    toast('Imported ✓ — '+((merged.journal||[]).length)+' entries restored');
    input.value='';
  }
};
const DELETE_AFFECT={
  run(){
    if(!confirm('Delete all mood, voice, and camera check-in history? This cannot be undone.')) return;
    const d=DB.load(); d.moods=[]; d.voiceCheckins=[]; d.cameraCheckins=[]; DB.save(d);
    try{ if(typeof renderToday==='function') renderToday(); if(typeof updateStats==='function') updateStats(); }catch(e){}
    toast('Check-in data deleted ✓');
  }
};

// V6·T9 — Collective Field: an anonymized, aggregate read of the configured
// server (active rooms + feed size from the existing health endpoint). No new
// server endpoint, no identifiers — just "you're not practicing alone."
const COLLECTIVE = {
  _timer:null,
  async refresh(){
    const el=document.getElementById('gp-collective'); if(!el) return;
    const url=(typeof NETWORK!=='undefined' && NETWORK._cfg && NETWORK._cfg.serverUrl) ? NETWORK._cfg.serverUrl : '';
    if(!url){ el.innerHTML='<div class="gp-net-empty">Configure a server URL in Settings to see the live field.</div>'; return; }
    try{
      const res=await fetch(url.replace(/\/+$/,'')+'/', {cache:'no-store', headers:{'Accept':'application/json'}});
      const d=await res.json();
      const rooms=d.rooms|0, feed=d.feedSize|0;
      const line = rooms>0
        ? `<strong>${rooms}</strong> practice room${rooms===1?'':'s'} active right now — you are not practicing alone.`
        : `No rooms active this moment — open one and others can join you.`;
      el.innerHTML=`<div class="gp-collective-live">${line}</div><div class="gp-collective-sub">${feed} transmission${feed===1?'':'s'} in the shared feed · anonymous, aggregate counts only.</div>`;
    }catch(e){
      el.innerHTML='<div class="gp-net-empty">Couldn’t reach the field right now.</div>';
    }
  },
  start(){ this.refresh(); clearInterval(this._timer); this._timer=setInterval(()=>this.refresh(), 60000); },
  stop(){ if(this._timer){ clearInterval(this._timer); this._timer=null; } }
};

// ═══════════════════════════ V7 · NETWORK (Practice Rooms + Feed) ═══════════════════════════
const NETWORK={
  _cfg:{serverUrl:'',autoJoinFeed:false},
  _ws:null,
  _activeRoom:null,
  _activeWave:0,
  _isHost:false,
  _hostId:null,
  _myId:null,

  async init(){
    try{ this._cfg=await GP_API.network.get(); }catch(e){}
    const urlInput=document.getElementById('gp-net-url');
    if(urlInput) urlInput.value=this._cfg.serverUrl||'';
    const autoBox=document.getElementById('gp-net-auto-share');
    if(autoBox) autoBox.checked=!!this._cfg.autoJoinFeed;
    const shareBox=document.getElementById('gp-mirror-share-feed');
    if(shareBox) shareBox.checked=!!this._cfg.autoJoinFeed;
    // Event delegation on the feed list — react buttons read their id from
    // a data attribute rather than having it inlined in onclick, so a
    // malicious feed server can't inject script via item.id.
    const list=document.getElementById('gp-feed-list');
    if(list && !list._delegated){
      list._delegated=true;
      list.addEventListener('click', evt => {
        const btn=evt.target.closest('button[data-feed-id]');
        if(btn) this.react(btn.dataset.feedId, btn);
      });
    }
    this._renderServerStatus();
    if(this._cfg.serverUrl) this._probeServer();
  },

  async saveConfig(){
    const raw=(document.getElementById('gp-net-url').value||'').trim().replace(/\/+$/,'');
    // Only accept http(s):// schemes — guards against the user (or a
    // copy-paste accident) entering javascript:/data:/file: URLs that
    // would otherwise flow into fetch() and `new WebSocket()`.
    if(raw && !/^https?:\/\/[^\s]+$/i.test(raw)){
      toast('Server URL must start with http:// or https://');
      return;
    }
    this._cfg={
      serverUrl:raw,
      autoJoinFeed:document.getElementById('gp-net-auto-share').checked,
    };
    try{ await GP_API.network.set(this._cfg); }catch(e){}
    document.getElementById('gp-mirror-share-feed').checked=this._cfg.autoJoinFeed;
    this._renderServerStatus();
    if(this._cfg.serverUrl) this._probeServer();
  },

  // Quick-set buttons for the canonical URLs
  async useHosted(){
    document.getElementById('gp-net-url').value='https://gateway-protocol.fly.dev';
    await this.saveConfig();
    this.loadFeed();
    toast('Connected to hosted Gateway Protocol server');
  },
  async useLocal(){
    document.getElementById('gp-net-url').value='http://localhost:7070';
    await this.saveConfig();
    this.loadFeed();
    toast('Pointed at localhost:7070 — run `npm start` in /server');
  },
  async clearServer(){
    document.getElementById('gp-net-url').value='';
    await this.saveConfig();
    toast('Network features disabled — fully local mode');
  },

  async saveShareConsent(){
    this._cfg.autoJoinFeed=document.getElementById('gp-mirror-share-feed').checked;
    document.getElementById('gp-net-auto-share').checked=this._cfg.autoJoinFeed;
    try{ await GP_API.network.set(this._cfg); }catch(e){}
  },

  _renderServerStatus(){
    const el=document.getElementById('gp-net-server-status');
    if(!el) return;
    if(this._cfg.serverUrl){
      el.classList.add('live');
      el.innerHTML='<span class="dot"></span>Server: '+escapeHTML(this._cfg.serverUrl);
    } else {
      el.classList.remove('live');
      el.innerHTML='<span class="dot"></span>Server: not configured';
    }
  },

  async _probeServer(){
    const probeEl=document.getElementById('gp-net-server-probe');
    if(!probeEl) return;
    probeEl.textContent='Probing…';
    try{
      const res=await fetch(this._cfg.serverUrl+'/',{cache:'no-store'});
      const data=await res.json();
      probeEl.style.color='var(--gold)';
      probeEl.textContent=`✓ Connected · ${data.rooms} active rooms · ${data.feedSize} feed items · up ${data.uptime}s`;
    }catch(e){
      probeEl.style.color='#c04040';
      probeEl.textContent='✗ Cannot reach '+this._cfg.serverUrl+' — '+(e.message||e);
    }
  },

  // ── Practice Rooms ──
  generateCode(){
    const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s=''; for(let i=0;i<6;i++) s+=chars[Math.floor(Math.random()*chars.length)];
    document.getElementById('gp-room-code-input').value=s;
  },

  joinRoom(){
    if(!this._cfg.serverUrl){ toast('Set a server URL in Settings first.'); return; }
    const code=(document.getElementById('gp-room-code-input').value||'').trim().toUpperCase();
    const wave=parseInt(document.getElementById('gp-room-wave-select').value,10)||0;
    if(!/^[A-Z0-9]{4,12}$/.test(code)){ toast('Room code must be 4–12 letters/numbers.'); return; }
    this._activeRoom=code;
    this._activeWave=wave;
    const wsUrl=this._cfg.serverUrl.replace(/^http/,'ws')+'/room/'+code;
    try{
      this._ws=new WebSocket(wsUrl);
    }catch(e){ toast('WebSocket failed: '+e.message); return; }
    this._ws.onopen=()=>{
      if(wave>0) this._ws.send(JSON.stringify({type:'set-wave',wave}));
      this._showActive();
    };
    this._ws.onmessage=(ev)=>this._handleMessage(ev.data);
    this._ws.onclose=()=>{ if(this._activeRoom){ toast('Room disconnected'); this._hideActive(); } };
    this._ws.onerror=()=>{ toast('Connection error — is the server running?'); };
  },

  _showActive(){
    document.getElementById('gp-room-idle').style.display='none';
    document.getElementById('gp-room-active').style.display='block';
    document.getElementById('gp-room-active-code').textContent=this._activeRoom;
  },
  _hideActive(){
    if(this._ws){ try{ this._ws.close(); }catch(e){} this._ws=null; }
    this._activeRoom=null;this._activeWave=0;this._isHost=false;this._hostId=null;
    document.getElementById('gp-room-idle').style.display='block';
    document.getElementById('gp-room-active').style.display='none';
  },

  leaveRoom(){
    this._hideActive();
    toast('Left practice room.');
  },

  _handleMessage(raw){
    let msg; try{ msg=JSON.parse(raw); }catch(e){ return; }
    if(msg.type==='presence'){
      if(msg.you) this._myId=msg.you;
      if(msg.hostId) this._hostId=msg.hostId;
      this._isHost=this._myId===this._hostId;
      const presEl=document.getElementById('gp-room-active-presence');
      presEl.textContent=msg.count===1
        ? '1 practitioner in the field'
        : msg.count+' practitioners in the field';
      document.getElementById('gp-room-active-host').textContent=this._isHost
        ? '◈ You are hosting · timer controls below mirror this room'
        : '◈ Following host · your timer will mirror theirs';
    }
    if(msg.type==='state'){
      const stateEl=document.getElementById('gp-room-active-state');
      const mm=String(Math.floor((msg.timerSeconds||0)/60)).padStart(2,'0');
      const ss=String((msg.timerSeconds||0)%60).padStart(2,'0');
      // Every field from `msg` is host-broadcast and therefore untrusted —
      // a malicious host in a shared room could otherwise inject script.
      stateEl.innerHTML=`
        <div style="font-size:15px;letter-spacing:2px;text-transform:uppercase;color:var(--muted)">Wave ${escapeHTML(String(msg.wave||'—'))} · ${escapeHTML(String(msg.sessionName||'no session'))}</div>
        <div style="font-family:'Cormorant Garamond',serif;font-size:32px;color:var(--gold2);letter-spacing:4px;text-align:center;margin:.5rem 0">${mm}:${ss}</div>
        <div style="font-size:16px;color:var(--gold);font-style:italic;text-align:center">${escapeHTML(msg.phase||'')}</div>
        <div style="font-size:14px;color:${msg.running?'var(--gold)':'var(--muted)'};letter-spacing:2px;text-transform:uppercase;text-align:center;margin-top:.4rem">${msg.running?'◈ Active':'idle'}</div>
      `;
    }
    if(msg.type==='cue'){
      // Show the host's broadcast cue as a toast (and via Voice if enabled)
      toast('◈ '+msg.text);
      if(VOICE.enabled) try{ VOICE.speak(msg.text,{rate:0.78}); }catch(e){}
    }
  },

  // Called by the local session timer when host — broadcasts state outward
  broadcastTimer(state){
    if(!this._ws || this._ws.readyState!==1 || !this._isHost) return;
    this._ws.send(JSON.stringify({type:'timer',action:'tick',timerSeconds:state.timerSeconds,phase:state.phase,sessionName:state.sessionName,timerMax:state.timerMax}));
  },
  broadcastTimerStart(state){
    if(!this._ws || this._ws.readyState!==1 || !this._isHost) return;
    this._ws.send(JSON.stringify({type:'timer',action:'start',timerSeconds:state.timerSeconds||0,timerMax:state.timerMax,sessionName:state.sessionName}));
  },
  broadcastTimerStop(){
    if(!this._ws || this._ws.readyState!==1 || !this._isHost) return;
    this._ws.send(JSON.stringify({type:'timer',action:'pause'}));
  },

  // ── Feed ──
  async loadFeed(){
    if(!this._cfg.serverUrl){
      document.getElementById('gp-feed-list').innerHTML='<div class="gp-net-empty">Set a server URL in Settings to load the feed.</div>';
      return;
    }
    const wave=document.getElementById('gp-feed-wave-filter').value;
    const code=document.getElementById('gp-feed-code-filter').value.trim();
    const params=new URLSearchParams();
    if(wave) params.set('wave',wave);
    if(code) params.set('code',code);
    params.set('limit','50');
    try{
      const res=await fetch(this._cfg.serverUrl+'/feed?'+params.toString());
      const {items}=await res.json();
      const list=document.getElementById('gp-feed-list');
      if(!items.length){ list.innerHTML='<div class="gp-net-empty">No transmissions match. Be the first to share.</div>'; return; }
      list.innerHTML=items.map(item=>{
        const ago=this._timeAgo(item.at);
        // Everything below is server-provided — a malicious server could
        // return script-shaped strings. Escape every field; carry the
        // feed id on a data attribute consumed by event delegation above.
        return `<div class="gp-feed-item">
          <div class="gp-feed-item-meta">
            ${item.wave?`<span class="gp-feed-tag">${escapeHTML(item.wave)}</span>`:''}
            ${item.frequency?`<span class="gp-feed-tag">${escapeHTML(item.frequency)}</span>`:''}
            ${item.code?`<span class="gp-feed-tag">${escapeHTML(item.code)}</span>`:''}
            <span style="opacity:.7">${escapeHTML(ago)}</span>
          </div>
          <div class="gp-feed-text">"${escapeHTML(item.transmission)}"</div>
          <button class="gp-feed-react" data-feed-id="${escapeHTML(item.id)}">◈ I needed this · ${Number(item.reactions)||0}</button>
        </div>`;
      }).join('');
    }catch(e){
      document.getElementById('gp-feed-list').innerHTML='<div class="gp-net-empty" style="color:#c04040">Feed unreachable: '+escapeHTML(e.message||String(e))+'</div>';
    }
  },

  async react(id,btn){
    if(!this._cfg.serverUrl) return;
    // X-Gateway-Client is a custom header → forces a CORS preflight. The
    // server requires it on every mutating route, so a CSRF form on a
    // random page can't drive these endpoints.
    try{
      const res=await fetch(this._cfg.serverUrl+'/feed/'+id+'/react',{
        method:'POST',
        headers:{'X-Gateway-Client':'1'},
      });
      const data=await res.json();
      if(data.ok) btn.textContent='◈ I needed this · '+data.reactions;
    }catch(e){}
  },

  // Called automatically after a Council mirror response if autoJoinFeed is on
  async maybeShareTransmission(rec){
    if(!this._cfg.autoJoinFeed || !this._cfg.serverUrl) return;
    if(!rec || !rec.transmission) return;
    try{
      await fetch(this._cfg.serverUrl+'/feed',{
        method:'POST',
        headers:{'Content-Type':'application/json','X-Gateway-Client':'1'},
        body:JSON.stringify({
          wave:rec.wave||'',
          frequency:rec.frequency||'',
          code:rec.code||'',
          transmission:rec.transmission,
        }),
      });
    }catch(e){ console.warn('Feed share failed:',e); }
  },

  _timeAgo(ts){
    const s=Math.round((Date.now()-ts)/1000);
    if(s<60) return s+'s ago';
    if(s<3600) return Math.round(s/60)+'m ago';
    if(s<86400) return Math.round(s/3600)+'h ago';
    return Math.round(s/86400)+'d ago';
  }
};

// ═══════════════════════════ V7c · SEMANTIC JOURNAL MEMORY ═══════════════════════════
// Embeds journal entries via OpenAI text-embedding-3-small, stores vectors
// in IDB (under the same idbStore wrapper used for DB persistence), and
// before each Mirror call retrieves the top-k most-relevant past entries
// via cosine similarity. Makes the Council long-term aware.
const MEMORY={
  IDB_KEY:'journal_embeddings', // stores Array<{id, vector, date, summary}>
  K:3,

  async _load(){
    try{ return (await idbStore.get(this.IDB_KEY)) || []; }
    catch(e){ return []; }
  },
  async _save(arr){
    try{ await idbStore.set(this.IDB_KEY,arr); }catch(e){ console.warn('MEMORY save:',e); }
  },

  // Embed every journal entry that doesn't have a vector yet. Runs lazily —
  // typically once per new entry, fire-and-forget after saveJournal.
  async embedNewEntries(){
    // In V2 the OpenAI key lives in the OS-encrypted vault inside main.js, so
    // the renderer only knows whether one is configured. In V1 (browser +
    // proxy) the key is in localStorage. Both reduce to: is a key available?
    let haveKey=false;
    if(GP_ELECTRON){
      haveKey = (typeof KEYS!=='undefined' && KEYS._saved && KEYS._saved.openai)
             || (typeof VOICE!=='undefined' && !!VOICE.oaiKey);
    }else{
      if(typeof VOICE!=='undefined' && VOICE.oaiKey) haveKey=true;
      else { try{ haveKey=!!JSON.parse(localStorage.getItem('gp_voice')||'{}').oaiKey; }catch(e){} }
    }
    if(!haveKey) return; // can't embed without OpenAI; silently skip
    const journal=DB.load().journal||[];
    const existing=await this._load();
    const haveIds=new Set(existing.map(e=>e.id));
    const todo=journal.filter(j=>!haveIds.has(j.id));
    if(!todo.length) return;
    for(const j of todo){
      const text=(j.data||[]).map(d=>d.prompt+': '+d.response).join('\n');
      if(!text.trim()) continue;
      try{
        const {vector}=await GP_API.embed({text});
        existing.push({
          id:j.id,
          vector,
          date:j.date,
          summary:text.slice(0,200),
        });
      }catch(e){
        console.warn('Embedding failed for entry',j.id,e.message||e);
        break; // probably out of quota or no key — stop trying this batch
      }
    }
    await this._save(existing);
  },

  // Find top-K most-similar past entries to the given query text.
  async retrieve(queryText, k=this.K){
    const stored=await this._load();
    if(stored.length<2) return [];
    let queryVec;
    try{ ({vector:queryVec}=await GP_API.embed({text:queryText})); }
    catch(e){ console.warn('Query embedding failed:',e); return []; }

    // Cosine similarity
    const scored=stored.map(s=>{
      let dot=0, na=0, nb=0;
      for(let i=0;i<queryVec.length;i++){
        dot+=queryVec[i]*s.vector[i];
        na+=queryVec[i]*queryVec[i];
        nb+=s.vector[i]*s.vector[i];
      }
      const sim=dot/(Math.sqrt(na)*Math.sqrt(nb)+1e-9);
      return {...s, sim};
    });
    scored.sort((a,b)=>b.sim-a.sim);
    // Map back to full journal entries (so we get the full data, not just summary)
    const journal=DB.load().journal||[];
    return scored.slice(0,k).map(s=>{
      const full=journal.find(j=>j.id===s.id);
      return full ? {date:new Date(full.date).toLocaleDateString(),session:full.session,data:full.data,sim:s.sim} : null;
    }).filter(Boolean);
  }
};

// ═══════════════════════════ V7d · BIOMETRIC TRACKING ═══════════════════════════
const BIO={
  KEY:'gp_biometric',
  _load(){ try{ return JSON.parse(localStorage.getItem(this.KEY)||'[]'); }catch(e){ return []; } },
  _save(arr){ try{ localStorage.setItem(this.KEY,JSON.stringify(arr)); }catch(e){} },

  add(){
    const v=parseFloat(document.getElementById('gp-bio-hrv').value);
    const ctx=document.getElementById('gp-bio-context').value;
    if(!v || v<5 || v>500){ toast('Enter a valid HRV value (5–500 ms).'); return; }
    const arr=this._load();
    arr.push({at:Date.now(),hrv:v,context:ctx});
    this._save(arr);
    document.getElementById('gp-bio-hrv').value='';
    this.render();
    toast('HRV logged ('+v+' ms · '+ctx+').');
  },

  render(){
    const arr=this._load();
    const trendEl=document.getElementById('gp-bio-trend');
    const histEl=document.getElementById('gp-bio-history');
    if(!arr.length){
      if(trendEl) trendEl.innerHTML='<span style="color:var(--muted);font-style:italic">No readings yet. Log your first HRV value above.</span>';
      if(histEl) histEl.innerHTML='';
      return;
    }
    // Compute baseline avg from last 7 vs prior 7 readings
    const sorted=arr.slice().sort((a,b)=>a.at-b.at);
    const recent=sorted.slice(-7);
    const prior=sorted.slice(-14,-7);
    const avg=a=>a.reduce((s,x)=>s+x.hrv,0)/a.length;
    const recentAvg=avg(recent);
    const priorAvg=prior.length?avg(prior):recentAvg;
    const delta=recentAvg-priorAvg;
    const pct=priorAvg?((delta/priorAvg)*100):0;
    const arrow=delta>=0?'▲':'▼';
    const cls=delta>=0?'up':'down';
    if(trendEl){
      trendEl.innerHTML=`
        <span>Recent avg: <strong style="color:var(--gold)">${recentAvg.toFixed(0)} ms</strong> (last ${recent.length})</span>
        <span>vs prior: <span class="${cls}">${arrow} ${Math.abs(pct).toFixed(1)}%</span></span>
      `;
    }
    if(histEl){
      histEl.innerHTML=sorted.slice().reverse().slice(0,10).map(e=>{
        const d=new Date(e.at);
        return `<div style="display:flex;justify-content:space-between;padding:2px 0">
          <span>${d.toLocaleDateString()} ${d.toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})}</span>
          <span style="color:var(--gold)">${e.hrv} ms · ${e.context}</span>
        </div>`;
      }).join('');
    }
  }
};

// ═══════════════════════════ V7e · GATEWAY INSTITUTE CERTIFICATIONS ═══════════════════════════
const INSTITUTE={
  TRACKS:[
    {id:'voyage', name:'Gateway Voyage',
     sub:'Complete each of the 7 Waves at least 3 times. Mirrors the Monroe Institute residential program.',
     check: stats => {
       const w = stats.waveCompletions || [0,0,0,0,0,0,0];
       const completedWaves = w.filter(c => c >= 3).length;
       return { progress: completedWaves, target: 7, done: completedWaves >= 7 };
     }},
    {id:'adept', name:'Adept',
     sub:'Accumulate 50 hours of total practice across any sessions.',
     check: stats => {
       const hours = (stats.minutes || 0) / 60;
       return { progress: Math.round(hours*10)/10, target: 50, done: hours >= 50, unit:'h' };
     }},
    {id:'sovereign', name:'Sovereign',
     sub:'Sustain a 21-day continuous practice streak.',
     check: stats => {
       const streak = (stats.streak || []).length;
       return { progress: streak, target: 21, done: streak >= 21 };
     }},
    {id:'cartographer', name:'Cartographer',
     sub:'Anchor 30 journal entries — building a personal map of consciousness.',
     check: stats => {
       const n = (stats.journal || []).length;
       return { progress: n, target: 30, done: n >= 30 };
     }},
  ],

  render(){
    const stats=DB.load();
    const list=document.getElementById('gp-cert-list');
    if(!list) return;
    list.innerHTML=this.TRACKS.map(t=>{
      const {progress,target,done,unit=''}=t.check(stats);
      const earnedKey='gp_cert_'+t.id;
      const earnedAt=localStorage.getItem(earnedKey);
      return `<div class="gp-cert-card ${done?'earned':''}">
        <div>
          <div class="gp-cert-name">${escapeHTML(t.name)}${done?' · ✓':''}</div>
          <div class="gp-cert-sub">${escapeHTML(t.sub)}</div>
          ${earnedAt?`<div style="font-size:14px;color:var(--gold);letter-spacing:1.5px;margin-top:.3rem">Earned ${new Date(+earnedAt).toLocaleDateString()}</div>`:''}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.4rem">
          <div class="gp-cert-progress">${progress}${unit} / ${target}${unit}</div>
          ${done?`<button class="gp-cert-issue" data-act="institute-issue" data-id="${t.id}">${earnedAt?'Re-issue':'Issue Certificate'}</button>`:''}
        </div>
      </div>`;
    }).join('');
  },

  async issue(trackId){
    const track=this.TRACKS.find(t=>t.id===trackId);
    if(!track){ return; }
    const stats=DB.load();
    const {progress,target,done,unit=''}=track.check(stats);
    if(!done){ toast('Track not yet complete.'); return; }
    // Mark earned
    localStorage.setItem('gp_cert_'+trackId, Date.now().toString());

    // Build the certificate payload
    const cert={
      type:'GatewayInstituteCertificate',
      track:track.name,
      trackId:track.id,
      issued:new Date().toISOString(),
      progress:`${progress}${unit} of ${target}${unit}`,
      practitioner:'(anonymous)', // could be linked to a name later
      stats:{
        sessions:stats.sessions||0,
        minutes:stats.minutes||0,
        journalEntries:(stats.journal||[]).length,
        waveCompletions:stats.waveCompletions||[],
      },
      issuer:'Gateway Protocol · Self-Sovereign Issuance',
    };

    // Sign with a per-install secret stored in IDB. This is a HMAC-SHA256
    // signature — not a true PKI cert chain, but tamper-evident: verifying
    // the cert requires the same install secret. For real "verifiable
    // anywhere" certs you'd swap this for ed25519 + a published pubkey.
    let secret;
    try{
      secret=await idbStore.get('gp_signing_secret');
      if(!secret){
        const raw=crypto.getRandomValues(new Uint8Array(32));
        secret=Array.from(raw).map(b=>b.toString(16).padStart(2,'0')).join('');
        await idbStore.set('gp_signing_secret',secret);
      }
    }catch(e){ secret='fallback-key'; }

    const payloadStr=JSON.stringify(cert);
    const enc=new TextEncoder();
    const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const sigBuf=await crypto.subtle.sign('HMAC',key,enc.encode(payloadStr));
    const sigHex=Array.from(new Uint8Array(sigBuf)).map(b=>b.toString(16).padStart(2,'0')).join('');

    const signed={...cert, signature:sigHex, signatureMethod:'HMAC-SHA256 (per-install secret)'};

    // Download as JSON
    const blob=new Blob([JSON.stringify(signed,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=`gateway-certificate-${track.id}-${Date.now()}.json`;
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },200);

    // Also offer a printable PDF version (just opens a styled new window for OS print → PDF)
    this._openPrintableCert(signed);

    toast('Certificate issued · '+track.name);
    this.render();
  },

  _openPrintableCert(c){
    const w=window.open('','_blank','width=900,height=700');
    if(!w) return;
    w.document.write(`<!doctype html><html><head><title>${c.track} · Certificate</title>
    <style>
      body{margin:0;padding:0;background:#0a0a0d;color:#e8e2d4;font-family:Georgia,serif}
      .cert{max-width:780px;margin:60px auto;padding:80px 60px;background:radial-gradient(ellipse at top,rgba(201,168,76,.08),transparent 70%),#0a0a0d;border:1px solid rgba(201,168,76,.4);border-radius:6px;text-align:center}
      h1{font-family:'Cormorant Garamond',Georgia,serif;font-weight:300;font-size:42px;letter-spacing:8px;color:#f0d88a;margin:0 0 12px}
      .sub{font-size:15px;letter-spacing:4px;text-transform:uppercase;color:#c9a84c;margin-bottom:50px}
      .name{font-family:'Cormorant Garamond',Georgia,serif;font-size:64px;font-weight:300;color:#f0d88a;margin:30px 0;letter-spacing:6px}
      .line{font-size:16px;color:#aaa;margin:6px 0;font-style:italic}
      .meta{margin-top:50px;font-size:15px;color:#888;letter-spacing:2px;text-transform:uppercase;line-height:2}
      .sig{margin-top:40px;padding-top:20px;border-top:.5px solid #333;font-size:14px;color:#666;font-family:monospace;word-break:break-all;letter-spacing:0}
      @media print{body{background:white;color:black}.cert{border-color:#c9a84c}h1,.name{color:#c9a84c}.line{color:#555}.meta,.sig{color:#888}}
    </style></head><body><div class="cert">
      <div class="sub">◈ Gateway Institute · Certificate of Completion</div>
      <div class="name">${escapeHTML(c.track)}</div>
      <div class="line">Awarded for sustained, sovereign practice</div>
      <div class="line">${escapeHTML(c.progress)}</div>
      <div class="meta">
        Issued ${new Date(c.issued).toLocaleDateString('en',{year:'numeric',month:'long',day:'numeric'})}<br>
        ${c.stats.sessions} sessions · ${Math.round(c.stats.minutes/60)} hours · ${c.stats.journalEntries} journal entries
      </div>
      <div class="sig"><strong style="color:#888">Signature (${escapeHTML(c.signatureMethod)}):</strong><br>${c.signature}</div>
    </div></body></html>`);
    w.document.close();
  }
};

// ═══════════════════════════ V7f · CUSTOM PROTOCOL BUILDER ═══════════════════════════
const PROTOBUILD={
  addPhase(){
    const wrap=document.getElementById('gp-proto-phases');
    const row=document.createElement('div');
    row.className='gp-phase-row';
    row.innerHTML='<input type="number" min="1" max="60" placeholder="min" value="5"><input type="text" placeholder="Phase name + cue">';
    wrap.appendChild(row);
  },
  _collectPhases(){
    const rows=document.querySelectorAll('#gp-proto-phases .gp-phase-row');
    const phases=[];
    for(const r of rows){
      const dur=parseInt(r.querySelector('input[type=number]').value,10);
      const cue=r.querySelector('input[type=text]').value.trim();
      if(dur>0 && cue) phases.push({dur,cue,name:cue.split(' — ')[0]||cue});
    }
    return phases;
  },
  save(){
    const name=document.getElementById('gp-proto-name').value.trim();
    const intention=document.getElementById('gp-proto-intention').value.trim();
    const phases=this._collectPhases();
    if(!name || !intention || phases.length<1){ toast('Need a name, intention, and at least one phase.'); return; }
    const d=DB.load();
    d.customProtocols=[...(d.customProtocols||[]),{
      id:Date.now(),
      name, intention, phases,
      totalMin:phases.reduce((a,p)=>a+p.dur,0),
      createdAt:new Date().toISOString(),
    }];
    DB.save(d);
    document.getElementById('gp-proto-name').value='';
    document.getElementById('gp-proto-intention').value='';
    this.render();
    toast('Custom protocol saved: '+name);
  },
  // Retroactively validate every stored protocol through the same sanitizer
  // used on import. Older builds imported without validation, so a protocol
  // persisted before this fix could still carry attacker-shaped fields; this
  // rewrites the store once with clean copies so render AND run only ever see
  // shape-checked data. Idempotent — a second pass changes nothing.
  _migrateStored(){
    const stored=DB.load().customProtocols||[];
    const clean=[]; let changed=false;
    for(const p of stored){
      const c=this._sanitizeProtocol(p);
      if(!c){ changed=true; continue; } // unrecoverable → drop
      c.id=p.id; c.createdAt=p.createdAt;
      if(c.name!==p.name || c.intention!==p.intention || c.totalMin!==p.totalMin || JSON.stringify(c.phases)!==JSON.stringify(p.phases)) changed=true;
      clean.push(c);
    }
    if(changed){ const d=DB.load(); d.customProtocols=clean; DB.save(d); }
    return clean;
  },
  render(){
    const list=document.getElementById('gp-proto-saved');
    if(!list) return;
    const protos=this._migrateStored();
    if(!protos.length){ list.innerHTML='<div style="font-size:15px;color:var(--muted);font-style:italic;text-align:center;padding:.5rem">No custom protocols yet.</div>'; return; }
    list.innerHTML=protos.slice().reverse().map(p=>`
      <div class="gp-proto-item">
        <div><div class="name">${escapeHTML(p.name)}</div><div style="font-size:14px;color:var(--muted)">${Array.isArray(p.phases)?p.phases.length:0} phases · ${parseInt(p.totalMin,10)||0} min</div></div>
        <div class="actions">
          <button data-act="protobuild-run" data-id="${p.id}">Run</button>
          <button data-act="protobuild-export-one" data-id="${p.id}">Export</button>
          <button data-act="protobuild-remove" data-id="${p.id}">×</button>
        </div>
      </div>
    `).join('');
  },
  run(id){
    const raw=(DB.load().customProtocols||[]).find(x=>x.id===id);
    const p=raw && this._sanitizeProtocol(raw); // never run on unsanitized data
    if(!p) return;
    // Synthesize a session-shape object and select it via existing selectSession
    const sess={
      name:p.name, dur:p.totalMin, icon:'◈',
      phases:p.phases.map(ph=>ph.name),
      customCues:p.phases.map(ph=>ph.cue), // available if a future scheduler reads them
      isCustom:true,
    };
    showScreen('sessions');
    selectSession(sess);
    toast('Custom protocol loaded · Press Begin');
  },
  exportOne(id){
    const p=(DB.load().customProtocols||[]).find(x=>x.id===id);
    if(!p) return;
    const blob=new Blob([JSON.stringify({type:'GatewayProtocol-CustomProtocol-v1',protocol:p},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download='protocol-'+p.name.replace(/[^\w]+/g,'-').toLowerCase()+'.json';
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },200);
  },
  remove(id){
    if(!confirm('Remove this custom protocol?')) return;
    const d=DB.load();
    d.customProtocols=(d.customProtocols||[]).filter(p=>p.id!==id);
    DB.save(d);
    this.render();
  },
  importFile(){
    document.getElementById('gp-proto-import-input').click();
  },
  // Coerce an untrusted (imported) protocol into a known-good shape, or null.
  // Imported files are attacker-controllable: every field is type-checked,
  // numerics are parsed to numbers, strings are length-capped, and unknown
  // fields are dropped. This is the only thing that should ever produce a
  // protocol object from external data — never spread the raw JSON.
  _sanitizeProtocol(raw){
    if(!raw || typeof raw!=='object' || Array.isArray(raw)) return null;
    const clampInt=(v,min,max)=>{ const n=parseInt(v,10); return Number.isFinite(n)?Math.min(Math.max(n,min),max):min; };
    const name=String(raw.name==null?'':raw.name).trim().slice(0,120);
    if(!name) return null;
    const intention=String(raw.intention==null?'':raw.intention).trim().slice(0,500);
    if(!Array.isArray(raw.phases)) return null;
    const phases=raw.phases.slice(0,40).map(ph=>{
      if(!ph || typeof ph!=='object') return null;
      const cue=String(ph.cue==null?'':ph.cue).trim().slice(0,300);
      if(!cue) return null;
      const nm=String(ph.name==null?(cue.split(' — ')[0]||cue):ph.name).trim().slice(0,120);
      return { dur:clampInt(ph.dur,1,180), cue, name:nm };
    }).filter(Boolean);
    if(!phases.length) return null;
    return { name, intention, phases, totalMin:phases.reduce((a,p)=>a+p.dur,0) };
  },
  async handleImport(input){
    const file=input.files[0];
    if(!file) return;
    try{
      const txt=await file.text();
      const obj=JSON.parse(txt);
      if(!obj || obj.type!=='GatewayProtocol-CustomProtocol-v1' || !obj.protocol){
        toast('Not a valid Gateway Protocol export.'); return;
      }
      const clean=this._sanitizeProtocol(obj.protocol);
      if(!clean){ toast('That protocol file is malformed or unsupported.'); return; }
      const d=DB.load();
      d.customProtocols=[...(d.customProtocols||[]),{...clean, id:Date.now(), createdAt:new Date().toISOString()}];
      DB.save(d);
      this.render();
      toast('Imported: '+clean.name);
    }catch(e){ toast('Import failed: '+e.message); }
    input.value='';
  }
};

// ═══════════════════════════ V8 · UPDATE NOTIFIER ═══════════════════════════
// Manual-install update flow. The app polls the configured network server's
// /version endpoint on launch; if the deployed version is newer than this
// build's, a low-key top banner offers a "Get update" link that opens
// /download in the user's real browser via setWindowOpenHandler. There's
// no silent self-update because the .dmg is unsigned — Squirrel/electron-
// updater requires code signing on macOS to relaunch a fresh app bundle.
const UPDATE_CHECK={
  SKIP_KEY:'gp_update_skip',
  async run(){
    if(!GP_ELECTRON || !window.gp.checkUpdate) return;
    let r;
    try{ r=await window.gp.checkUpdate(); }catch(e){ return; }
    if(!r || !r.updateAvailable) return;
    let skipped=null;
    try{ skipped=localStorage.getItem(this.SKIP_KEY); }catch(_){}
    if(skipped===r.latest) return; // user explicitly skipped this version
    this._show(r);
  },
  _show(r){
    if(document.getElementById('gp-update-banner')) return;
    const css=document.createElement('style');
    css.textContent=
      '#gp-update-banner{position:fixed;top:0;left:0;right:0;z-index:9999;'+
        'background:rgba(15,15,18,.96);backdrop-filter:blur(8px);'+
        'border-bottom:.5px solid var(--gold);'+
        'font-family:Montserrat,system-ui,sans-serif;font-size:15px;letter-spacing:1.5px;'+
        'color:var(--silver);text-transform:uppercase;'+
        'display:flex;justify-content:center;align-items:center;gap:18px;'+
        'padding:10px 16px;animation:gp-upd-in .35s ease-out}'+
      '#gp-update-banner .glyph{color:var(--gold);font-family:"Cormorant Garamond",serif;font-size:16px;text-transform:none;letter-spacing:0}'+
      '#gp-update-banner a{color:var(--gold);text-decoration:none;border-bottom:.5px solid var(--gold);padding-bottom:1px}'+
      '#gp-update-banner a:hover{color:var(--gold2);border-color:var(--gold2)}'+
      '#gp-update-banner button{background:transparent;border:none;color:var(--muted);'+
        'font-size:15px;letter-spacing:1.5px;text-transform:uppercase;cursor:pointer;padding:0 6px}'+
      '#gp-update-banner button:hover{color:var(--silver)}'+
      '@keyframes gp-upd-in{from{transform:translateY(-100%);opacity:0}to{transform:translateY(0);opacity:1}}';
    document.head.appendChild(css);
    const el=document.createElement('div');
    el.id='gp-update-banner';
    el.innerHTML=
      '<span class="glyph">◈</span>'+
      '<span>Version '+escapeHTML(r.latest)+' is available</span>'+
      '<a href="#" id="gp-upd-get">Get update</a>'+
      '<button id="gp-upd-skip" title="Don\'t show again for this version">Skip</button>'+
      '<button id="gp-upd-later" title="Remind me on next launch">×</button>';
    document.body.appendChild(el);
    document.getElementById('gp-upd-get').onclick=(e)=>{
      e.preventDefault();
      // setWindowOpenHandler in main.js routes this to shell.openExternal
      window.open(r.downloadUrl,'_blank','noopener');
    };
    document.getElementById('gp-upd-skip').onclick=()=>{
      try{ localStorage.setItem(this.SKIP_KEY, r.latest); }catch(_){}
      el.remove();
    };
    document.getElementById('gp-upd-later').onclick=()=>{ el.remove(); };
  }
};

// Single source of truth for "is motion calmed right now". Driven by the
// body.gp-reduced class that VISUALS manages, so both the OS preference and
// the manual Settings toggle flow through one check.
function isReducedMotion(){ return document.body.classList.contains('gp-reduced'); }

// ═══════════════════════════ VISUALS (Settings → Visuals) ═══════════════════════════
// Owns two app-wide visual preferences:
//   Quality: high (glowing sprite field) | low (hard points, weak GPUs)
//   Motion : auto (follow OS reduce setting) | full | calm
// Reconciles the OS prefers-reduced-motion setting with the user's explicit
// choice and is the only thing that toggles body.gp-reduced + THREE_FIELD calm.
const VISUALS={
  _quality:'high',
  _motion:'auto',
  _readable:'standard',
  init(){
    // Mirror THREE_FIELD.init's default exactly (deterministic, not persisted):
    // honor an explicit saved choice, else 'low' on small/mobile viewports so
    // the High/Low buttons match the field that actually rendered.
    let savedQ=null; try{ savedQ=localStorage.getItem('gp_field_quality'); }catch(e){}
    const smallScreen=(window.matchMedia && window.matchMedia('(max-width:600px)').matches);
    this._quality = savedQ || (smallScreen ? 'low' : 'high');
    try{ this._motion=localStorage.getItem('gp_motion')||'auto'; }catch(e){}
    try{ this._readable=localStorage.getItem('gp_readable')||'standard'; }catch(e){}
    // React to OS-level changes while in 'auto'.
    const mq=window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMq=()=>{ if(this._motion==='auto') this._applyMotion(); };
    mq.addEventListener ? mq.addEventListener('change',onMq) : mq.addListener(onMq);
    this._applyMotion();
    this._applyReadable();
    this._syncUI();
  },
  _applyReadable(){
    document.body.classList.toggle('gp-readable',this._readable==='high');
  },
  setReadable(r){
    this._readable=(r==='high')?'high':'standard';
    try{ localStorage.setItem('gp_readable',this._readable); }catch(e){}
    this._applyReadable();
    this._syncUI();
  },
  _osReduced(){ return window.matchMedia('(prefers-reduced-motion: reduce)').matches; },
  _calm(){ return this._motion==='calm' || (this._motion==='auto' && this._osReduced()); },
  _applyMotion(){
    const calm=this._calm();
    document.body.classList.toggle('gp-reduced',calm);
    if(typeof THREE_FIELD!=='undefined' && THREE_FIELD.setCalm) THREE_FIELD.setCalm(calm);
  },
  setMotion(m){
    this._motion=(m==='calm'||m==='full'||m==='auto')?m:'auto';
    try{ localStorage.setItem('gp_motion',this._motion); }catch(e){}
    this._applyMotion();
    this._syncUI();
  },
  setQuality(q){
    this._quality=(q==='low')?'low':'high';
    try{ localStorage.setItem('gp_field_quality',this._quality); }catch(e){}
    if(typeof THREE_FIELD!=='undefined' && THREE_FIELD.setQuality) THREE_FIELD.setQuality(this._quality);
    this._syncUI();
  },
  _syncUI(){
    const set=(id,on)=>{const el=document.getElementById(id);if(el)el.classList.toggle('active',on);};
    set('gp-vis-q-high',this._quality!=='low');
    set('gp-vis-q-low', this._quality==='low');
    set('gp-vis-m-auto',this._motion==='auto');
    set('gp-vis-m-full',this._motion==='full');
    set('gp-vis-m-calm',this._motion==='calm');
    set('gp-vis-r-standard',this._readable!=='high');
    set('gp-vis-r-high',this._readable==='high');
  }
};

// Tiny escape helper used by V4 panels
function escapeHTML(s){
  return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Translate the GP_PARSE_FAIL:: errors that anthropicJSONCall throws on a
// double parse failure into something a practitioner can read. The Mirror
// panel already has bespoke raw-text rendering; other panels just need
// the friendly message.
function humanError(e){
  const msg=(e && e.message) || String(e||'');
  if(msg.indexOf('GP_PARSE_FAIL::')===0){
    return 'The Council returned unstructured text — usually a one-off. Try again.';
  }
  return msg;
}

// Recover the raw model output from a GP_PARSE_FAIL error so a panel can
// optionally surface it instead of just toasting. Returns null for any
// non-parse-fail error.
function parseFailRaw(e){
  const msg=(e && e.message) || '';
  const m=/^GP_PARSE_FAIL::(.+)$/.exec(msg);
  if(!m) return null;
  try{ return JSON.parse(m[1]).raw; }catch(_){ return null; }
}

// ═══════════════════════════ UTILITIES ═══════════════════════════
function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2500);
}

function observeFadeIns(){
  const obs=new IntersectionObserver(entries=>{
    entries.forEach(e=>{if(e.isIntersecting)e.target.classList.add('visible')});
  },{threshold:.1});
  document.querySelectorAll('.fade-in').forEach(el=>obs.observe(el));
}

function confirmReset(){
  if(confirm('Reset all progress, streak, and journal data? This cannot be undone.')){
    DB.clear();
    stats=DB.load();
    updateStats();
    renderJournalHistory();
    toast('Data cleared. New journey begins.');
  }
}

// ═══════════════════════════ START ═══════════════════════════
// Boot sequence:
//   1. Restore encrypted API keys from electron-store (V2)
//   2. Hydrate DB from IndexedDB (V5f) — migrates from localStorage on first run
//   3. Re-seed the module-level `stats` from the hydrated cache so updateStats
//      reads the right thing immediately
//   4. init() builds the UI
(async()=>{
  try{ await GP_API.hydrateKeys(); }catch(e){ console.warn('Boot · keys:',e); }
  try{ await DB.hydrate(); }catch(e){ console.warn('Boot · DB hydrate:',e); }
  stats=DB.load(); // re-pull after hydrate in case IDB had fresher data
  init();
  // V3: ritual arrival overlay (skippable; disabled via its own checkbox / Settings)
  try{ ARRIVAL.begin(); }catch(e){ console.warn('Arrival:',e); }
  // First-run setup: if arrival is disabled it won't trigger setup on close,
  // so kick it directly. maybeBegin() is idempotent (gated by its own flag).
  try{ if(!ARRIVAL.shouldShow()) SETUP.maybeBegin(); }catch(e){ console.warn('Setup:',e); }
  // V8 — check for a newer build after the UI has settled. Update checks
  // are informational, not blocking; if the server is unreachable or
  // not configured the banner just doesn't appear.
  setTimeout(()=>UPDATE_CHECK.run(), 2500);
  // PWA: register the service worker on the hosted web build only. Guarded to
  // http(s) so it never runs in Electron (file://), where there's no SW + no
  // need for an offline shell (the app is already local).
  if('serviceWorker' in navigator && location.protocol.startsWith('http')){
    window.addEventListener('load',()=>{ navigator.serviceWorker.register('/sw.js').catch(()=>{}); });
  }
})();
