/**
 * Gateway Protocol — Voice Proxy
 * ───────────────────────────────────────────────────────────────
 * Single proxy for both ElevenLabs and OpenAI TTS.
 * Both APIs block direct browser calls (no CORS headers).
 * This runs on your machine and relays requests for you.
 *
 * REQUIREMENTS: Node.js (any version ≥ 14)
 * START:        node proxy.js
 * STOP:         Ctrl+C
 *
 * No npm install needed — uses only Node.js built-ins.
 * ───────────────────────────────────────────────────────────────
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT = 5050;
const HTML_FILE = path.join(__dirname, 'gateway-protocol.html');

// ── CORS headers added to every response ──
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── Stream an HTTPS request to the browser response ──
function relay(options, payload, clientRes, label) {
  const req = https.request(options, upRes => {
    if (upRes.statusCode !== 200) {
      let err = '';
      upRes.on('data', d => err += d);
      upRes.on('end', () => {
        clientRes.writeHead(upRes.statusCode, { 'Content-Type': 'application/json' });
        clientRes.end(err);
        console.error(`[${label}] Error ${upRes.statusCode}: ${err.slice(0, 120)}`);
      });
      return;
    }
    clientRes.writeHead(200, {
      'Content-Type':                'audio/mpeg',
      'Access-Control-Allow-Origin': '*',
      'Transfer-Encoding':           'chunked',
    });
    upRes.pipe(clientRes);
  });

  req.on('error', err => {
    console.error(`[${label}] Request failed: ${err.message}`);
    clientRes.writeHead(502);
    clientRes.end('Upstream error: ' + err.message);
  });

  req.write(payload);
  req.end();
}

// ── Route handlers ──
const routes = {

  // ElevenLabs TTS
  '/tts': (body, res) => {
    const { text, voiceId, model, stability, similarity, key } = body;
    if (!key) { res.writeHead(401); res.end('Missing ElevenLabs API key'); return; }

    const payload = JSON.stringify({
      text,
      model_id: model || 'eleven_multilingual_v2',
      voice_settings: {
        stability:        stability  ?? 0.72,
        similarity_boost: similarity ?? 0.82,
        style: 0,
        use_speaker_boost: true,
      },
    });

    relay({
      hostname: 'api.elevenlabs.io',
      path:     `/v1/text-to-speech/${voiceId}/stream`,
      method:   'POST',
      headers: {
        'xi-api-key':     key,
        'Content-Type':   'application/json',
        'Accept':         'audio/mpeg',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, payload, res, 'ElevenLabs');

    console.log(`[ElevenLabs] "${text.slice(0, 60)}…"`);
  },

  // OpenAI TTS
  '/oai-tts': (body, res) => {
    const { text, voice, model, speed, key } = body;
    if (!key) { res.writeHead(401); res.end('Missing OpenAI API key'); return; }

    const payload = JSON.stringify({
      model:           model   || 'tts-1',
      input:           text,
      voice:           voice   || 'nova',
      speed:           speed   ?? 0.78,
      response_format: 'mp3',
    });

    relay({
      hostname: 'api.openai.com',
      path:     '/v1/audio/speech',
      method:   'POST',
      headers: {
        'Authorization': 'Bearer ' + key,
        'Content-Type':  'application/json',
        'Accept':        'audio/mpeg',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, payload, res, 'OpenAI');

    console.log(`[OpenAI]     "${text.slice(0, 60)}…"`);
  },

  // Anthropic Claude — Quantum Mirror council transmissions
  '/mirror': (body, res) => {
    const { entry, key } = body;
    if (!key) { res.writeHead(401); res.end('Missing Anthropic API key'); return; }

    const systemPrompt = `You are the Council of Five — five of the greatest minds ever assembled on consciousness, healing, and human potential: Robert Monroe (Gateway Process pioneer), Dr. Bruce Lipton (Biology of Belief, subconscious reprogramming), Dr. Joe Dispenza (neuroscience of transformation), Nikola Tesla (frequency and resonance), and Carl Jung (depth psychology, shadow work).

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

    const payload = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Here is my journal entry:\n\n${entry}` }]
    });

    const chunks = [];
    const apiReq = https.request({
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'x-api-key':         key,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
        'Content-Length':    Buffer.byteLength(payload),
      },
    }, apiRes => {
      apiRes.on('data', d => chunks.push(d));
      apiRes.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        res.writeHead(apiRes.statusCode, {
          'Content-Type':                'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(raw);
        console.log(`[Mirror]     Council transmission sent`);
      });
    });

    apiReq.on('error', err => {
      console.error(`[Mirror] Error: ${err.message}`);
      res.writeHead(502);
      res.end(JSON.stringify({ error: err.message }));
    });

    apiReq.write(payload);
    apiReq.end();
    console.log(`[Mirror]     Consulting the Council of Five…`);
  },
  // Anthropic Claude — Adaptive Session Engine (V2 #2)
  // Reads last ≤7 journal entries, recommends wave + freq + breath + intention.
  '/pre-session': (body, res) => {
    const { entries, key } = body;
    if (!key) { res.writeHead(401); res.end('Missing Anthropic API key'); return; }
    if (!Array.isArray(entries) || entries.length < 2) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Need at least 2 journal entries' }));
      return;
    }

    const systemPrompt = `You are the Council of Five — Monroe, Lipton, Dispenza, Tesla, Jung — preparing a practitioner for their next Gateway Protocol session.

You are given their last journal entries in chronological order (oldest first, most recent last). Read for patterns ACROSS entries, not just the most recent one:
- What state are they cycling through?
- What shadow theme keeps resurfacing?
- What have they been over-practicing or avoiding?
- What is the next true edge — the practice that would meet them where they actually are, not where they want to be?

Then return a JSON object with EXACTLY these fields:

{
  "recommendedWave": <integer 1-7>,
  "recommendedFreq": <integer Hz, one of 174,285,396,417,432,528,639,741,852,963>,
  "recommendedBreath": <string, one of "Coherence 5-5","Gateway 5-5-5","Box 4-4-4-4","Dispenza 4-0-8","Tesla 3-6-9","Pranayama 4-7-8">,
  "intention": <string, 1 sentence, second person>,
  "rationale": <string, 2-3 sentences>
}

Return ONLY valid JSON. No preamble. No markdown fences.`;

    const dossier = entries.map((e, i) => {
      const num = i + 1;
      const when = e.date || 'unknown date';
      const ctx = e.session ? ` (during ${e.session})` : '';
      const lines = (e.data || []).map(d => `  ${d.prompt}: ${d.response}`).join('\n');
      return `─── Entry ${num} · ${when}${ctx} ───\n${lines}`;
    }).join('\n\n');

    const payload = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Here are my last ${entries.length} journal entries:\n\n${dossier}` }]
    });

    const chunks = [];
    const apiReq = https.request({
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'x-api-key':         key,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
        'Content-Length':    Buffer.byteLength(payload),
      },
    }, apiRes => {
      apiRes.on('data', d => chunks.push(d));
      apiRes.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        // Parse out the inner JSON the model returned, so the renderer
        // gets a clean recommendation object — matching Electron path.
        try {
          const env = JSON.parse(raw);
          if (apiRes.statusCode !== 200) {
            res.writeHead(apiRes.statusCode, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
            res.end(raw);
            return;
          }
          const txt = env.content?.[0]?.text || '';
          const clean = txt.replace(/```json|```/g, '').trim();
          const recommendation = JSON.parse(clean);
          res.writeHead(200, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
          res.end(JSON.stringify(recommendation));
        } catch (e) {
          res.writeHead(502, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
          res.end(JSON.stringify({ error: 'Council response could not be parsed' }));
        }
        console.log(`[Pre-Session] Recommendation sent`);
      });
    });

    apiReq.on('error', err => {
      console.error(`[Pre-Session] Error: ${err.message}`);
      res.writeHead(502);
      res.end(JSON.stringify({ error: err.message }));
    });

    apiReq.write(payload);
    apiReq.end();
    console.log(`[Pre-Session] Consulting the Council on ${entries.length} entries…`);
  },
};

// ── Server ──
const server = http.createServer((req, res) => {
  cors(res);

  // Serve the HTML app at GET /
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    fs.readFile(HTML_FILE, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('gateway-protocol.html not found in same folder as proxy.js');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST')    { res.writeHead(405); res.end('POST only'); return; }

  const handler = routes[req.url];
  if (!handler) { res.writeHead(404); res.end('Unknown route: ' + req.url); return; }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      handler(JSON.parse(body), res);
    } catch (e) {
      res.writeHead(400);
      res.end('Bad JSON: ' + e.message);
    }
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ◈  Gateway Protocol — Voice Proxy');
  console.log('  ───────────────────────────────────────────');
  console.log(`  App URL:  http://localhost:${PORT}`);
  console.log('');
  console.log('  ⚠  Open the app at the URL above — NOT the .html file directly.');
  console.log('     Opening via http:// fixes localStorage and security warnings.');
  console.log('');
  console.log('  Routes:');
  console.log(`  GET  /        →  Serves gateway-protocol.html`);
  console.log(`  POST /tts     →  ElevenLabs TTS`);
  console.log(`  POST /oai-tts →  OpenAI TTS`);
  console.log(`  POST /mirror  →  Quantum Mirror (Anthropic Claude)`);
  console.log(`  POST /pre-session → Adaptive Session Engine (V2 #2)`);
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});
