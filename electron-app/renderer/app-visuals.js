// Gateway Protocol — visual & audio engine (extracted from app.js · V6·T8 step 4).
// HRV coherence visualizer, cinematic mode, the Three.js particle field,
// the iOS audio unlock, and the ambient field-audio layer. Loaded as a classic
// script before app.js so init() can call them; they reference app.js globals
// (DB, toast, VISUALS, …) and THREE only at call time, after all scripts run.
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
    // V6·T2b — the cinematic pulse ring glows with live coherence (CSS reads
    // --gp-coherence). The field visibly responds as the breath settles.
    try{ document.documentElement.style.setProperty('--gp-coherence', (this._score/100).toFixed(3)); }catch(e){}
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
    try{ document.documentElement.style.setProperty('--gp-coherence','0'); }catch(e){} // reset the ring glow
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
