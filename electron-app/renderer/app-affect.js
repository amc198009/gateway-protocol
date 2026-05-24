// Gateway Protocol — V6 affect modules (extracted from app.js · V6·T8 step 1).
// Loaded as a classic script BEFORE app.js (see index.html) so these globals
// exist when app.js boot runs. These modules reference app.js globals (DB,
// toast, escapeHTML, showScreen, SESSIONS, KEYS, …) only at call time, after
// both scripts have executed.
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
