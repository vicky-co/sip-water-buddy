
(function(){
  const api = window.sip;
  const WIN_W = 470, WIN_H = 420, HX = 150;   // HX: hero centre inside the window
  const W = WIN_W;
  let big = false, aiming = false;              // big: window temporarily covers every screen
  const GROUND = 15;                            // px from window bottom to the feet
  let FOLLOW_X = HX - 130; const FRONT_X = HX + 12; // pet left edge: behind the hero (or centred when the hero is hidden) / in front of the hero
  const $ = s => document.querySelector(s);
  const stage = $('#stage'), scene = $('#scene'), svg = $('#fig svg');
  const dogEl = $('#dog'), dogSvg = $('#dog svg'), ballEl = $('#ball');
  const P = {}, Dg = {};
  ['body','legF','shinF','legB','shinB','armF','foreF','armB','foreB','head','cup','mouth','eye','shadow','shadesFace','shadesHand','shadesSpin']
    .forEach(id => P[id] = document.getElementById(id));
  ['dRoot','dBL','dFL','dBR','dFR','dTail','dHead','dEye','dMouth','dTongue','dBall'].forEach(id => Dg[id] = document.getElementById(id));

  const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
  const lerp = (a,b,t) => a + (b-a)*t;
  const smooth = (a,b,t) => { const x = clamp((t-a)/(b-a), 0, 1); return x*x*(3-2*x); };
  const rot = (el,a,cx,cy) => el.setAttribute('transform', `rotate(${a.toFixed(2)} ${cx} ${cy})`);

  let wa = { x:0, y:0, width:1920, height:1080 }, areas = [];
  let pos = { x:0, y:0 }, lastSent = '';
  let dir = 1, phase = 0, clock = 0, blinkAt = 3;
  let count = 0, goal = 8, interval = 30, hasDog = true, heroOn = true, petOn = true;
  const NAMES = { hero: 'Hero', pet: 'Buddy' };
  const lead = () => heroOn ? NAMES.hero : NAMES.pet;
  let steps = [], step = null, stepT = 0, flair = null, flairT = 0, target = null, activity = null, askT = 0;

  // ================= HERO POSES (negative angle = swing forward) =================
  const base = () => ({ legF:0, shinF:0, legB:0, shinB:0, armF:4, foreF:-10, armB:8, foreB:-24,
    head:-3, bob:0, jump:0, sway:0, flip:1, cup:false, face:true, hand:false, spin:0, mouth:'smirk', wink:false });
  const lerpPose = (a, b, k) => { const o = { ...b }; for (const key in a) if (typeof a[key] === 'number') o[key] = lerp(a[key], b[key], k); return o; };
  function idle(t){ const o = base(), b = Math.sin(t*2.2); o.bob = 0.8*b; o.armF = 4 + 2*b; o.head = -3 + 2*Math.sin(t*0.7); return o; }
  function walk(p){
    const s = Math.sin(p), c = Math.cos(p), o = base();
    o.legF = -26*s; o.shinF = 6 + 44*Math.max(0, c);
    o.legB =  26*s; o.shinB = 6 + 44*Math.max(0, -c);
    // both arms swing, each opposite to the leg on its own side (the elbow bends as the arm comes forward)
    o.armF =  26*s; o.foreF = -14 - 18*Math.max(0, -s);
    o.armB = -26*s; o.foreB = -14 - 18*Math.max(0,  s);
    o.bob = -2.8*Math.abs(c); o.sway = 3*s; o.head = -5 + 2*Math.sin(2*p);
    return o;
  }
  const crouch = () => Object.assign(base(), { bob:30, legF:-80, shinF:80, legB:15, shinB:75, sway:18,
    armF:20, foreF:-6, armB:-50, foreB:-40, head:12, mouth:'flat' });
  const POSES = {
    landing(t){
      if (t < 0.45){ const k = t/0.45, o = base();
        Object.assign(o, { jump:-170*(1-k*k), legF:-50, shinF:90, legB:20, shinB:80, armF:-150, armB:-120, foreF:-20, foreB:-20, mouth:'open' });
        return o; }
      if (t < 1.1) return crouch();
      return lerpPose(crouch(), idle(clock), smooth(1.1, 1.6, t));
    },
    shades(t){
      const o = base();
      if (t < 0.5){ const k = smooth(0, 0.45, t); o.armF = lerp(4,-22,k); o.foreF = lerp(-10,-142,k); }
      else if (t < 1.6){ const k = smooth(0.5, 0.85, t); o.armF = lerp(-22,-110,k); o.foreF = lerp(-142,-30,k);
        o.face = false; o.hand = true; o.spin = (t-0.5)*900; o.head = -8; o.wink = t > 1.1 && t < 1.35; o.mouth = 'smile'; }
      else if (t < 2.2){ const k = smooth(1.6, 2.1, t); o.armF = lerp(-110,-22,k); o.foreF = lerp(-30,-142,k);
        o.face = t >= 2.12; o.hand = !o.face; o.spin = t < 2.0 ? (t-0.5)*900 : 0; o.head = -8; }
      else { const k = smooth(2.2, 2.6, t); o.armF = lerp(-22,4,k); o.foreF = lerp(-142,-10,k); }
      return o;
    },
    point(t){ const o = base(); Object.assign(o, { armF:-88, foreF:-4, armB:35, foreB:-110, head:-6, sway:-3,
        bob:2*Math.abs(Math.sin(t*8)), mouth:'smile', wink: t > 0.5 && t < 0.75 }); return o; },
    collar(t){ const o = base(); Object.assign(o, { armF:-30, foreF:-150 + 55*Math.max(0, Math.sin(t*7)), head:-8 + 4*Math.sin(t*5), sway:-2 }); return o; },
    step(t){
      const w = t*Math.PI*2/0.6, s = Math.sin(w), l = Math.max(0, s), r = Math.max(0, -s), o = base();
      Object.assign(o, { legF:-50*l, shinF:80*l, legB:-50*r, shinB:80*r, armF:-140 + 25*s, foreF:-30,
        armB:-140 - 25*s, foreB:-30, bob:-4*Math.abs(s), head:4*s, sway:4*s, mouth:'open' });
      return o;
    },
    spin(t){ const o = base(); Object.assign(o, { yaw: t < 1 ? t*720 : 0, flip: t < 1 ? Math.cos(t*Math.PI*4) : 1, armF:-80, foreF:-10, armB:80, foreB:-10, bob:-2 });
      if (Math.abs(o.flip) < 0.15) o.flip = o.flip < 0 ? -0.15 : 0.15; return o; },
    drink(t, D){ const o = base(), up = smooth(0, 0.55, t) * (1 - smooth(D-0.55, D, t));
      Object.assign(o, { cup:true, armF:lerp(4,-22,up), foreF:lerp(-10,-142,up), head:-16*up - 4*Math.sin(t*7)*up, mouth: up > 0.6 ? 'o' : 'smile' });
      return o; },
    shrug(t){ const o = base(), k = smooth(0, 0.3, t);
      Object.assign(o, { armF:lerp(4,10,k), foreF:lerp(-10,-85,k), armB:lerp(8,-10,k), foreB:lerp(-24,-85,k),
        head:8 + 4*Math.sin(t*10)*Math.exp(-t*2), bob:-3*k, mouth:'flat' }); return o; },
    wave(t){ const o = idle(t); Object.assign(o, { armF:-165, foreF:-15 + 28*Math.sin(t*9), head:-6, mouth:'open' }); return o; },
    throw(t){ const o = base();
      if (t < 0.3){ const k = smooth(0, 0.3, t); Object.assign(o, { armF:lerp(4,70,k), foreF:-40, sway:-4*k, mouth:'flat' }); }
      else { const k = smooth(0.3, 0.45, t); Object.assign(o, { armF:lerp(70,-120,k), foreF:lerp(-40,-10,k), sway:lerp(-4,6,k), mouth:'open' }); }
      return o; },
    pet(t){ const k = smooth(0, 0.4, t), o = base();
      Object.assign(o, { sway:22*k, bob:12*k, legF:-25*k, shinF:30*k, legB:10*k, shinB:25*k,
        armF:lerp(4, -35 + 10*Math.sin(t*8), k), foreF:lerp(-10,-5,k), head:14*k, mouth:'smile' }); return o; },
  };
  const FLAIRS = { point:1.6, collar:1.6, shades:2.6, spin:1.2 };
  POSES.aerial = () => idle(clock);   // driven by the avatar's own clip

  // ================= Settings =================
  const SET = { dogLook:'golden', dogFlip:false, avatar:'default', bark:'bigdog', barkOne:0.3, dogSpeed:1, sound:{ mute:false, voice:true, dog:true, fx:true, volume:0.6 } };

  // ================= Sound (all synthesized, no files) =================
  const Sound = (() => {
    let ctx = null, master = null, noiseBuf = null, barkBuf = null, barkWant = null; const barkCache = {};
    const on = k => !SET.sound.mute && SET.sound[k];
    function ac(){
      try {
        if (!ctx){ ctx = new AudioContext(); master = ctx.createGain(); master.connect(ctx.destination); }
        if (ctx.state === 'suspended') ctx.resume();
        master.gain.value = SET.sound.mute ? 0 : SET.sound.volume;
        return ctx;
      } catch(e){ return null; }
    }
    function tone(f0, f1, t, dur, type, vol){
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur/3)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.03);
    }
    function noise(t, dur, vol, type, f0, f1, q){
      if (!noiseBuf){ noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random()*2 - 1; }
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noiseBuf; f.type = type; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur); f.Q.value = q || 1;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.03);
    }
    // A "woof": voiced, slightly rough bark. Pitch jumps up then drops, and two
    // vocal-tract formants glide from rounded lips ("w") to open mouth ("oo") and back ("f").
    let rough = null;
    function woof(t, p){
      if (!rough){ rough = new Float32Array(1024); for (let i = 0; i < 1024; i++){ const x = i/511.5 - 1; rough[i] = Math.tanh(1.6*x); } }
      const D = 0.24;
      const src = ctx.createOscillator(); src.type = 'sawtooth';
      src.frequency.setValueAtTime(230*p, t);
      src.frequency.linearRampToValueAtTime(470*p, t + 0.035);
      src.frequency.exponentialRampToValueAtTime(260*p, t + 0.17);
      src.frequency.exponentialRampToValueAtTime(170*p, t + D);
      const sub = ctx.createOscillator(); sub.type = 'square';           // chesty body
      sub.frequency.setValueAtTime(115*p, t); sub.frequency.linearRampToValueAtTime(235*p, t + 0.035); sub.frequency.exponentialRampToValueAtTime(110*p, t + D);
      const subG = ctx.createGain(); subG.gain.value = 0.35;
      const breath = ctx.createBufferSource(); breath.buffer = noiseBuf;  // throat noise
      const breathG = ctx.createGain(); breathG.gain.setValueAtTime(0.5, t); breathG.gain.exponentialRampToValueAtTime(0.12, t + 0.06);
      const mix = ctx.createGain(); mix.gain.value = 1;
      src.connect(mix); sub.connect(subG); subG.connect(mix); breath.connect(breathG); breathG.connect(mix);
      const shaper = ctx.createWaveShaper(); shaper.curve = rough; mix.connect(shaper);
      const out = ctx.createGain();
      const formant = (f0, f1, f2, q, g) => { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
        f.frequency.setValueAtTime(f0*p, t); f.frequency.linearRampToValueAtTime(f1*p, t + 0.045); f.frequency.exponentialRampToValueAtTime(f2*p, t + D);
        const fg = ctx.createGain(); fg.gain.value = g; shaper.connect(f); f.connect(fg); fg.connect(out); };
      formant(380, 820, 420, 6, 1.3);     // F1: w → open → oo
      formant(900, 1500, 850, 7, 0.8);    // F2
      formant(2400, 2600, 2200, 8, 0.12); // F3 bite
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7; lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(900, t + D);
      const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 3000;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.6, t + 0.012);
      env.gain.setValueAtTime(0.6, t + 0.07);
      env.gain.linearRampToValueAtTime(0.24, t + 0.15);
      env.gain.exponentialRampToValueAtTime(0.0001, t + D + 0.02);
      out.connect(lp); lp.connect(lp2); lp2.connect(env); env.connect(master);
      // soft "f" at the tail
      const tail = ctx.createBufferSource(); tail.buffer = noiseBuf;
      const tf = ctx.createBiquadFilter(); tf.type = 'bandpass'; tf.frequency.value = 1800; tf.Q.value = 0.8;
      const tg = ctx.createGain(); tg.gain.setValueAtTime(0.0001, t + 0.12); tg.gain.exponentialRampToValueAtTime(0.05, t + 0.16); tg.gain.exponentialRampToValueAtTime(0.0001, t + D + 0.06);
      tail.connect(tf); tf.connect(tg); tg.connect(master);
      for (const n of [src, sub, breath, tail]){ n.start(t); n.stop(t + D + 0.1); }
    }
    const play = (k, fn) => { if (!on(k)) return; if (!ac()) return;
      if (!noiseBuf){ noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random()*2 - 1; }
      fn(ctx.currentTime + 0.01); };
    return {
      refresh(){ if (master) master.gain.value = SET.sound.mute ? 0 : SET.sound.volume; },
      chime(){ play('fx', t => [659, 880, 1047].forEach((f, i) => tone(f, f, t + i*.15, .5, 'sine', .16))); },
      babble(text){ play('voice', t => { const n = clamp(Math.round(text.length/5), 3, 14);
        for (let i = 0; i < n; i++){ const f = 115 + Math.random()*85, tt = t + i*0.085;
          tone(f, f*(Math.random() < .5 ? 1.18 : .86), tt, .075, 'triangle', .12); tone(f*2, f*2.1, tt, .06, 'sawtooth', .025); } }); },
      hmm(){ play('voice', t => tone(170, 115, t, .4, 'triangle', .14)); },
      whistle(){ play('voice', t => { tone(1400, 2100, t, .16, 'sine', .07); tone(2000, 1500, t + .19, .25, 'sine', .07); }); },
      cheer(){ play('fx', t => [523, 659, 784, 1047].forEach((f, i) => tone(f, f, t + i*.09, .3, 'triangle', .12))); },
      thud(){ play('fx', t => { tone(140, 45, t, .25, 'sine', .4); noise(t, .15, .15, 'lowpass', 500); }); },
      whoosh(){ play('fx', t => noise(t, .4, .2, 'bandpass', 300, 2600, .8)); },
      swish(){ play('fx', t => noise(t, .18, .12, 'bandpass', 1500, 3500, 1.2)); },
      snap(){ play('fx', t => noise(t, .05, .3, 'highpass', 2500)); },
      gulp(){ play('fx', t => tone(320, 140, t, .12, 'sine', .2)); },
      boing(){ play('fx', t => { tone(220, 520, t, .15, 'sine', .15); tone(260, 600, t + .18, .1, 'sine', .07); }); },
      beat(dur){ play('fx', t => { const n = Math.floor((dur || 3.6)/0.3), mel = [392, 440, 523, 440, 587, 523, 440, 392];
        for (let i = 0; i < n; i++){ const tt = t + i*.3; if (i % 2 === 0) tone(110, 40, tt, .18, 'sine', .35); else noise(tt, .06, .1, 'highpass', 6000);
          tone(mel[i % 8], mel[i % 8], tt, .22, 'square', .03); } }); },
      bark(n){ play('pet', t => {
        if (barkBuf){ // recorded bark: one bark = first part of the clip, otherwise the whole clip
          const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = barkBuf; src.connect(g); g.connect(master);
          const len = n === 1 ? Math.min(SET.barkOne, barkBuf.duration) : barkBuf.duration;
          g.gain.setValueAtTime(1, t); g.gain.setValueAtTime(1, t + Math.max(0, len - 0.05)); g.gain.linearRampToValueAtTime(0.0001, t + len);
          src.start(t); src.stop(t + len + 0.02); return;
        }
        for (let i = 0; i < (n || 2); i++) woof(t + i*0.3, i % 2 ? 0.9 : 1); }); },
      async setBark(id){
        barkBuf = null; barkWant = id;
        if (id === 'synth' || !api.loadSound) return;
        try {
          if (!barkCache[id]){
            const raw = await api.loadSound(id); if (!raw) return;
            const ab = raw instanceof ArrayBuffer ? raw.slice(0) : raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
            if (!ac()) return;
            barkCache[id] = await ctx.decodeAudioData(ab);
          }
          if (barkWant === id) barkBuf = barkCache[id];
        } catch(e){ console.log('Bark sound failed to load: ' + (e && e.message)); }
      },
      bang(){ play('fx', t => { noise(t, .25, .45, 'lowpass', 1800, 200); tone(90, 40, t, .2, 'sine', .3); }); },
      chomp(){ play('pet', t => { noise(t, .05, .25, 'bandpass', 1200, 900, 2); noise(t + .12, .05, .2, 'bandpass', 1100, 800, 2); }); },
      sniff(){ play('pet', t => { for (let i = 0; i < 3; i++) noise(t + i*.11, .06, .12, 'highpass', 3000); }); },
      whine(){ play('pet', t => tone(900, 1300, t, .35, 'sine', .07)); },
      pant(){ play('pet', t => { for (let i = 0; i < 5; i++) noise(t + i*.16, .09, .08, 'bandpass', 1800, 1200, 1.5); }); },
    };
  })();
  // One-shot sounds tied to moments inside each move
  const SFX = { landing:[[0.42,'thud']], drink:[[0.6,'gulp'],[1.0,'gulp'],[1.4,'gulp']], spin:[[0.01,'whoosh']],
    shades:[[0.55,'whoosh'],[1.15,'whistle']], step:[[0.01,'beat']], shrug:[[0.1,'hmm']], point:[[0.15,'snap']],
    collar:[[0.25,'swish']], aerial:[[0.4,'whoosh'],[1.3,'whoosh'],[2.4,'thud']] };
  function sfx(name, t0, t1, dur){
    if (!heroOn) return;
    for (const [at, snd] of (SFX[name] || [])) if (t0 < at && t1 >= at) Sound[snd](dur);
  }

  // ================= 3D avatar =================
  let canvas3d = $('#hero3d');
  let avatar = null, use3D = false, frameDt = 0.016;
  // ---- 3D dog ----
  const dog3dWrap = $('#dog3dWrap'), dogBall3d = $('#dogBall3d');
  let dogCanvas = $('#dog3d'), dog3d = null, useDog3D = false, loadedDogKey = null, loadingDogKey = null;
  async function loadDogId(id, flip){
    const key = id + (flip ? ':flip' : '');
    if (id === '2d'){ useDog3D = false; report({ pet: 'cartoon (chosen in Settings)' }); return; }
    if (key === loadedDogKey){ useDog3D = !!dog3d; report({ pet: 'ready' }); return; }
    if (key === loadingDogKey || !api.loadPet || !window.createPet3D) return;
    loadingDogKey = key;
    try {
      const buf = await api.loadPet(id); if (!buf) throw new Error('Pet file not found');
      const ab = buf instanceof ArrayBuffer ? buf.slice(0) : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      const fresh = dogCanvas.cloneNode(false);
      const next = await window.createPet3D(fresh, ab, { width:150, height:120, ground:4, length:92, tall:64, flip });
      if (loadingDogKey !== key){ next.dispose(); return; }
      if (dog3d) dog3d.dispose();
      dogCanvas.replaceWith(fresh); dogCanvas = fresh; dog3d = next; loadedDogKey = key;
      report({ pet: 'ready' });
      console.log('3D pet loaded: ' + id + (next.clipNames.length ? ' (animations: ' + next.clipNames.join(', ') + ')' : next.rigged ? ' (auto-rigged: legs, head and tail move)' : ' (whole-body moves)'));
    } catch(e){
      console.log('Pet ' + id + ' failed: ' + (e && e.message));
      report({ pet: 'failed: ' + brief(e && e.message) });
      if (api.petError) api.petError(id, (e && e.message) || 'Unknown error');
    } finally {
      if (loadingDogKey === key) loadingDogKey = null;
      useDog3D = !!dog3d && SET.dogLook !== '2d';
    }
  }
  function set3DMode(){
    use3D = !!avatar && SET.avatar !== '2d';
    canvas3d.style.display = use3D ? 'block' : 'none';
    $('#fig').classList.toggle('ghost3d', use3D);
  }
  const report = st => { try { if (api.reportStatus) api.reportStatus(st); } catch(e){} };
  const brief = m => String(m || 'unknown error').replace(/\s+/g, ' ').slice(0, 70);
  let loadedAvatarId = null, loadingAvatarId = null;
  async function loadAvatarId(id){
    if (id === '2d'){ report({ hero: 'cartoon (chosen in Settings)' }); return; }
    if (id === loadedAvatarId){ report({ hero: 'ready' }); return; }
    if (id === loadingAvatarId) return;
    if (!api.loadAvatar || !window.createAvatar3D){ console.log('3D avatar files are missing'); report({ hero: 'not started (3D files missing)' }); return; }
    loadingAvatarId = id;
    try {
      const buf = await api.loadAvatar(id); if (!buf) throw new Error('Avatar file not found');
      const ab = buf instanceof ArrayBuffer ? buf.slice(0) : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      const fresh = canvas3d.cloneNode(false);              // new canvas = new WebGL context
      const next = await window.createAvatar3D(fresh, ab, { width:200, height:420, ground:GROUND });
      if (loadingAvatarId !== id){ next.dispose(); return; }
      if (avatar) avatar.dispose();
      canvas3d.replaceWith(fresh); canvas3d = fresh; avatar = next; loadedAvatarId = id;
      if (avatar.clipName) FLAIRS.aerial = avatar.clipDuration; else delete FLAIRS.aerial;
      console.log('3D avatar loaded: ' + id + (avatar.clipName ? ' (bonus move: ' + avatar.clipName + ')' : ''));
      report({ hero: 'ready' });
    } catch(e){
      console.log('Avatar ' + id + ' failed: ' + (e && e.message));
      report({ hero: 'failed: ' + brief(e && e.message) });
      if (api.avatarError) api.avatarError(id, (e && e.message) || 'Unknown error');
    } finally { if (loadingAvatarId === id) loadingAvatarId = null; set3DMode(); }
  }
  const flairNames = () => Object.keys(FLAIRS).filter(k => k !== 'aerial' || use3D);
  function startFlair(name){ flair = name; flairT = 0; if (name === 'aerial' && avatar) avatar.playClip(); }
  const randomFlair = () => { const k = flairNames(); startFlair(k[Math.floor(Math.random()*k.length)]); };

  function renderNames(){
    $('#chipPet').textContent = '\u{1F43E} Pet ' + NAMES.pet;
    $('#speedLbl').textContent = NAMES.pet;
    const tr = $('#tricks'); $('#tricksBtn').textContent = '\u{1F43E} Tricks ' + (tr.hidden ? '\u25BE' : '\u25B4'); $('#tricksBtn').title = NAMES.pet + "'s tricks";
  }
  const chipVisible = n => n === 'both' ? (heroOn && petOn) : n === 'pet' ? petOn : n === 'hero' ? heroOn : true;
  function updateChips(){
    document.querySelectorAll('[data-needs]').forEach(b => { b.hidden = !chipVisible(b.dataset.needs); });
    if (!petOn) $('#tricks').hidden = true;
  }
  function applySettings(s){
    if (!s) return;
    if (s.names){ NAMES.hero = s.names.hero || NAMES.hero; NAMES.pet = s.names.pet || NAMES.pet; }
    if (s.show){
      heroOn = s.show !== 'pet'; petOn = s.show !== 'hero'; hasDog = petOn;
      scene.classList.toggle('no-hero', !heroOn); FOLLOW_X = heroOn ? HX - 130 : HX - 45;
      if (!heroOn) report({ hero: 'hidden (Settings > Characters)' });
      if (!petOn) report({ pet: 'hidden (Settings > Characters)' });
    }
    if (s.heroLook) SET.avatar = s.heroLook;
    if (s.petSoundOne) SET.barkOne = s.petSoundOne;
    if (s.petSound && (s.petSound !== SET.bark || !applySettings.barkSet)){ SET.bark = s.petSound; applySettings.barkSet = true; Sound.setBark(s.petSound); }
    if (s.petSpeed) SET.dogSpeed = s.petSpeed;
    if (heroOn) loadAvatarId(SET.avatar);
    if (s.petLook) SET.dogLook = s.petLook;
    if ('petFlip' in s) SET.dogFlip = !!s.petFlip;
    if (petOn){
      useDog3D = !!dog3d && SET.dogLook !== '2d' && loadedDogKey === SET.dogLook + (SET.dogFlip ? ':flip' : '');
      loadDogId(SET.dogLook, SET.dogFlip);
    } else useDog3D = false;
    if (s.sound) Object.assign(SET.sound, s.sound);
    Sound.refresh(); set3DMode(); renderNames(); updateChips();
    $('#muteBtn').textContent = SET.sound.mute ? '\u{1F507}' : '\u{1F50A}';
    document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('on', +b.dataset.speed === SET.dogSpeed));
  }
  if (api.onSettings) api.onSettings(applySettings);
  const saveSetting = (local, core) => { applySettings(local); if (api.setSetting) api.setSetting(core); };
  $('#muteBtn').addEventListener('click', () => saveSetting({ sound:{ mute: !SET.sound.mute } }, { sound:{ mute: !SET.sound.mute } }));
  document.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); saveSetting({ petSpeed: +b.dataset.speed }, { pet:{ speed: +b.dataset.speed } }); }));
  $('#gearBtn').addEventListener('click', () => { if (api.openSettings) api.openSettings(); });
  applySettings({ petSound: SET.bark });
  // Settings window "play" button: hear a sound without changing the choice
  if (api.onTestSound) api.onTestSound(async id => {
    const keep = SET.bark; if (id && id !== keep) await Sound.setBark(id);
    Sound.bark(2);
    if (id && id !== keep) setTimeout(() => Sound.setBark(keep), 1800);
  });
  const MOUTH = { smirk:'M6 26 q3 2 6 -1', smile:'M5 25.5 q3.5 3.5 7 0', open:'M5 25.5 q3.5 5 7 0 z', flat:'M6 27 h5', o:'M8 26.5 a1.6 1.6 0 1 0 0.01 0' };

  function applyHero(o){
    if (!heroOn) return;
    if (use3D){ avatar.apply(o, frameDt); return; }
    rot(P.legF,o.legF,0,84); rot(P.shinF,o.shinF,0,116); rot(P.legB,o.legB,0,84); rot(P.shinB,o.shinB,0,116);
    rot(P.armF,o.armF,0,45); rot(P.foreF,o.foreF,0,66); rot(P.armB,o.armB,0,45); rot(P.foreB,o.foreB,0,66);
    rot(P.head,o.head,0,34);
    P.body.setAttribute('transform', `translate(0 ${(o.bob + o.jump).toFixed(2)}) rotate(${o.sway.toFixed(2)} 0 84)`);
    P.shadow.setAttribute('rx', (20*(1 + o.jump/250)).toFixed(2));
    P.cup.style.display = o.cup ? 'inline' : 'none';
    P.shadesFace.style.display = o.face ? '' : 'none';
    P.shadesHand.style.display = o.hand ? 'inline' : 'none';
    rot(P.shadesSpin, o.spin, 0, 89);
    const m = MOUTH[o.mouth] || MOUTH.smirk;
    if (P.mouth.getAttribute('d') !== m){ P.mouth.setAttribute('d', m); P.mouth.setAttribute('fill', (o.mouth==='open'||o.mouth==='o') ? '#5A2A1E' : 'none'); }
    let ry = 2.2;
    if (o.wink) ry = 0.3;
    if (clock > blinkAt){ ry = 0.3; if (clock > blinkAt + 0.12) blinkAt = clock + 2.5 + Math.random()*3; }
    P.eye.setAttribute('ry', ry);
    svg.style.transform = `scaleX(${o.flip.toFixed(3)})`;
  }

  // ================= The pet (the built-in cartoon pet is a dog) =================
  const D = { x: FOLLOW_X, y: 0, face: 1, q: 0, barkT: 0, tiltAt: 4, drop: 0 };
  const dogBase = () => ({ x:D.x, face:D.face, jump:0, root:'stand', bob:0, fl:0, fr:0, bl:0, br:0,
    tail:20*Math.sin(clock*9), head:0, mouth:false, ball:false, bounce:0, happy:false });
  function dogTrot(o){ o.moving = true; o.q = D.q; o.fast = SET.dogSpeed >= 1.5; const s = Math.sin(D.q); o.fr = 28*s; o.bl = 28*s; o.fl = -28*s; o.br = -28*s;
    o.bob = -1.5*Math.abs(Math.cos(D.q)); o.tail = 25*Math.sin(clock*14); return o; }
  function dogSit(o){ o.root = 'sit'; o.bl = -70; o.br = -70; o.fl = 20; o.fr = 20; o.tail = 25*Math.sin(clock*7); return o; }
  function dogMoveTo(tx, speed, dt){
    const dx = tx - D.x; if (Math.abs(dx) < 2){ D.x = tx; return true; }
    D.face = dx > 0 ? 1 : -1; const st = Math.min(Math.abs(dx), speed*dt); D.x += D.face*st; D.q += st/7; return false;
  }
  function dogMoveTo2(tx, ty, speed, dt){
    const dx = tx - D.x, dy = ty - D.y, d = Math.hypot(dx, dy);
    if (d < 2){ D.x = tx; D.y = ty; return true; }
    if (Math.abs(dx) > 1) D.face = dx > 0 ? 1 : -1;
    const st = Math.min(d, speed*dt); D.x += dx/d*st; D.y += dy/d*st; D.q += st/7; return false;
  }
  function dogDefault(dt, heroWalking){
    if (Math.abs(D.y) > 1){ dogMoveTo2(FOLLOW_X, 0, 400, dt); return dogTrot(dogBase()); }
    D.y = 0;
    if (heroWalking){
      if (dogMoveTo(FOLLOW_X, 420, dt)){ D.face = 1; D.q += 170*dt/7; }
      return dogTrot(dogBase());
    }
    if (Math.abs(D.x - FOLLOW_X) > 2){ dogMoveTo(FOLLOW_X, 260, dt); return dogTrot(dogBase()); }
    D.face = 1;
    const o = dogSit(dogBase());
    if (clock > D.tiltAt){ o.head = -15; if (clock > D.tiltAt + 1) D.tiltAt = clock + 4 + Math.random()*4; }
    return o;
  }
  function applyDog(o){
    if (!hasDog){ dogEl.style.display = 'none'; return; }
    dogEl.style.display = '';
    if (D.barkT > 0){ o.jump += -16*Math.abs(Math.sin((0.6 - D.barkT)*Math.PI/0.3)); o.mouth = true; }
    dogEl.style.transform = `translate(${o.x.toFixed(1)}px, ${(o.jump + D.drop + D.y).toFixed(1)}px)`;
    dogEl.style.zIndex = o.x > HX - 20 ? 3 : 1;
    if (useDog3D){
      dogSvg.style.visibility = 'hidden'; dog3dWrap.style.display = 'block';
      dog3dWrap.style.transform = `scaleX(${o.face})`;
      dogBall3d.style.display = o.ball ? 'block' : 'none';
      dog3d.apply(o, frameDt); return;
    }
    dogSvg.style.visibility = ''; dog3dWrap.style.display = 'none';
    dogSvg.style.transform = `scaleX(${o.face})`;
    let rt = `translate(0 ${o.bob.toFixed(2)})`;
    if (o.root === 'sit') rt = 'translate(0 5) rotate(-20 24 44)';
    if (o.root === 'dance') rt = `translate(0 ${o.bounce.toFixed(2)}) rotate(-55 26 66)`;
    if (o.root === 'rot') rt = `translate(0 ${(o.ty || 0).toFixed(2)}) rotate(${o.ang.toFixed(1)} 45 42)`;
    Dg.dRoot.setAttribute('transform', rt);
    rot(Dg.dFL, o.fl, 58, 44); rot(Dg.dFR, o.fr, 63, 44); rot(Dg.dBL, o.bl, 22, 44); rot(Dg.dBR, o.br, 27, 44);
    rot(Dg.dTail, o.tail, 14, 31); rot(Dg.dHead, o.head, 62, 26);
    Dg.dMouth.setAttribute('d', o.mouth ? 'M79 27 q4 6 8 0 z' : 'M79 28 q4 2 8 0');
    Dg.dMouth.setAttribute('fill', o.mouth ? '#5a1f1f' : 'none');
    Dg.dTongue.style.display = o.ball ? 'none' : '';
    Dg.dBall.style.display = o.ball ? 'inline' : 'none';
    Dg.dEye.setAttribute('ry', o.happy ? 0.5 : 2);
  }

  // ================= Effects =================
  const toScreenX = x => dir === 1 ? x : W - x;
  function fx(text, sceneX, yUp){
    const el = document.createElement('span'); el.className = 'fx'; el.textContent = text;
    el.style.left = toScreenX(sceneX) + 'px'; el.style.bottom = (GROUND + yUp) + 'px';
    stage.appendChild(el); setTimeout(() => el.remove(), 1400);
  }
  const dogHeadX = () => D.face === 1 ? D.x + 78 : D.x + 12;
  function showBall(b){
    ballEl.style.display = b ? 'block' : 'none';
    if (b) ballEl.style.transform = `translate(${(b.x - 6.5).toFixed(1)}px, ${(-(GROUND + b.y + 13)).toFixed(1)}px)`;
  }
  ballEl.style.top = WIN_H + 'px';

  // ================= Play activities (while he waits for your answer) =================
  // ================= The pet's tricks =================
  const TRICKS = {
    chase:{ dur:2.6, dog(t, st, dt){ if (st.x0 === undefined) st.x0 = D.x;
      const a = t*11, o = dogBase(); D.face = Math.sin(a) > 0 ? 1 : -1; D.q += dt*28; dogTrot(o);
      o.face = D.face; o.x = st.x0 + 12*Math.cos(a); o.mouth = true; o.tail = 60*Math.sin(clock*30);
      if (t > 2.3){ o.x = st.x0; o.face = 1; D.face = 1; } return o; },
      sounds:[[0.3,'bark1'],[2.35,'bark']], fx:[[2.4,'🌀','dog']] },
    roll:{ dur:1.9, dog(t){ const o = dogSit(dogBase());
      if (t > 0.3 && t < 1.25){ Object.assign(o, { root:'rot', ang:360*smooth(0.3, 1.25, t), ty:7, fl:-45, fr:-45, bl:45, br:45, tail:0, happy:true }); }
      else if (t >= 1.25){ Object.assign(o, { root:'stand', fl:0, fr:0, bl:0, br:0, bob:2*Math.sin(t*45)*Math.max(0, 1.9 - t), tail:40*Math.sin(clock*25), mouth:true }); }
      return o; }, sounds:[[0.35,'swish'],[1.35,'bark1']] },
    dead:{ dur:3.4, hero(t){ return t < 1.0 ? Object.assign(POSES.point(t), { mouth:'open' }) : idle(clock); },
      dog(t){ const o = dogBase();
        if (t < 0.55) return dogSit(o);
        if (t < 0.95){ const k = smooth(0.55, 0.95, t); return Object.assign(o, { root:'rot', ang:180*k, ty:9*k, fl:20*k, fr:20*k, bl:20*k, br:20*k, tail:0 }); }
        if (t < 2.6) return Object.assign(o, { root:'rot', ang:180, ty:9, fl:10 + (t > 2.0 ? 8*Math.sin(t*25) : 0), fr:-10, bl:15, br:-5, tail:-30, happy:true });
        const k = smooth(2.6, 2.85, t);
        return Object.assign(o, { root:'rot', ang:180*(1 - k), ty:9*(1 - k), jump:-18*Math.sin(Math.PI*clamp((t - 2.6)/0.4, 0, 1)), tail:50*Math.sin(clock*25), mouth:true }); },
      sounds:[[0.5,'bang'],[0.62,'whine'],[2.65,'bark']], fx:[[0.5,'Bang! 💥','hero'],[1.4,'💤','dog'],[2.7,'Woof!','dog']] },
    five:{ dur:2.6, front:true,
      hero(t){ const k = smooth(0.2, 0.6, t)*(1 - smooth(2.0, 2.5, t)); return Object.assign(base(), { armF:lerp(4,-70,k), foreF:lerp(-10,-25,k), sway:10*k, bob:6*k, mouth:'smile' }); },
      dog(t){ const o = dogBase(); o.face = -1; const k = smooth(0.2, 0.5, t)*(1 - smooth(2.0, 2.4, t));
        if (k <= 0) return dogSit(o);
        return Object.assign(o, { root:'dance', bounce:-3*k, bl:55, br:55, fl:-30, fr:lerp(-30, -115, k) + (t > 0.8 && t < 0.95 ? -15 : 0), tail:45*Math.sin(clock*24), mouth:true }); },
      sounds:[[0.85,'snap'],[1.0,'bark1']], fx:[[0.85,'✋ High five!','hand']] },
    beg:{ dur:3.0, front:true,
      hero(t){ return (t > 1.4 && t < 2.0) ? POSES.throw(clamp((t - 1.4)*0.9, 0, 0.45)) : idle(clock); },
      dog(t){ const o = dogBase(), w = Math.sin(t*14); o.face = -1;
        Object.assign(o, { root:'dance', bounce:-3*Math.abs(w), bl:55, br:55, fl:-100 + 15*w, fr:-100 - 15*w, tail:40*Math.sin(clock*20), head:-8 });
        if (t > 1.8 && t < 2.3){ o.jump = -20*Math.sin(Math.PI*(t - 1.8)/0.5); o.mouth = true; }
        if (t > 2.3) o.happy = true; return o; },
      sounds:[[0.2,'whine'],[1.75,'whistle'],[2.05,'chomp'],[2.5,'bark1']], fx:[[1.8,'🦴','dog'],[2.4,'😋','dog']] },
    // little things he does by himself while waiting
    scratch:{ dur:1.8, solo:true, dog(t){ const o = dogSit(dogBase()); o.br = -95 + 22*Math.sin(t*38); o.head = 14; o.happy = true; return o; }, sounds:[] },
    sniff:{ dur:2.2, solo:true, dog(t, st, dt){ if (st.x0 === undefined) st.x0 = D.x;
      const o = dogBase(); D.face = Math.cos(t*2.2) > 0 ? 1 : -1; D.q += dt*9; dogTrot(o);
      o.face = D.face; o.x = st.x0 + 18*Math.sin(t*2.2); o.head = 26 + 4*Math.sin(t*30);
      if (t > 2.05){ o.x = st.x0; o.face = 1; D.face = 1; } return o; }, sounds:[[0.3,'sniff'],[1.2,'sniff']] },
  };
  const trickSound = n => n === 'bark1' ? Sound.bark(1) : n === 'bark' ? Sound.bark(2) : Sound[n] && Sound[n]();
  function makeTrick(name){
    const T = TRICKS[name], st = {}, act = { name, done:false };
    let ph = T.front ? 'go' : 'do', pt = 0;
    act.tick = dt => {
      pt += dt; let hero = idle(clock), dog;
      if (ph === 'go'){
        const there = dogMoveTo2(FRONT_X, 0, 320, dt);
        dog = there ? dogSit(dogBase()) : dogTrot(dogBase());
        if (there){ D.face = -1; ph = 'do'; pt = 0; }
        return { hero, dog };
      }
      const p0 = pt - dt;
      for (const [at, snd] of (T.sounds || [])) if (p0 < at && pt >= at) trickSound(snd);
      for (const [at, txt, where] of (T.fx || [])) if (p0 < at && pt >= at)
        fx(txt, where === 'hero' ? HX + 20 : where === 'hand' ? HX + 40 : dogHeadX(), where === 'dog' ? 70 : 150);
      if (T.hero) hero = T.hero(pt);
      dog = T.dog(pt, st, dt);
      if (pt >= T.dur){ act.done = true; D.x = clamp(D.x, -40, WIN_W); }
      return { hero, dog };
    };
    return act;
  }
  let dogSolo = null, nextSoloAt = 12;
  function dogSoloTick(dt){
    if (!hasDog) return null;
    if (!dogSolo){
      if (clock < nextSoloAt || Math.abs(D.x - FOLLOW_X) > 3 || Math.abs(D.y) > 1) return null;
      const pick = ['scratch','sniff','chase','roll'][Math.floor(Math.random()*4)];
      dogSolo = makeTrick(pick);
    }
    const r = dogSolo.tick(dt);
    if (dogSolo.done){ dogSolo = null; nextSoloAt = clock + 10 + Math.random()*10; }
    return r.dog;
  }

  function makeActivity(name, opts = {}){
    if (TRICKS[name]) return makeTrick(name);
    let t = 0, ph = 'start', pt = 0, fxAt = 0;
    const act = { name, done:false };
    if (name === 'fetch'){
      // 2-D fetch to the exact spot that was clicked (absolute screen coords in opts.target)
      const tgt = opts.target, ha = pos.x + (dir === 1 ? HX : W - HX);
      if ((tgt.x < ha - 10 && dir === 1) || (tgt.x > ha + 10 && dir === -1)){ dir = -dir; pos.x = ha - (dir === 1 ? HX : W - HX); }
      const U = union(), groundY = WIN_H - GROUND;
      const tx = tgt.x - pos.x, ty = tgt.y - pos.y;
      const BX = dir === 1 ? tx : W - tx;       // ball x in scene coords
      const BUP = groundY - ty;                 // ball height above the hero's ground line
      const DOG_Y = ty - groundY;               // dog's vertical offset to stand at that spot
      const dist = Math.hypot(BX - (HX + 30), BUP - 150);
      const topRoom = (pos.y + groundY) - (U.y + 30);
      const arc = clamp(Math.min(110 + dist*0.22, topRoom - Math.max(150, BUP)), 10, 420);
      const flight = 0.55 + dist/1400, run = (380 + dist*0.35) * SET.dogSpeed;
      let dogTX = null;
      act.tick = dt => {
        t += dt; pt += dt; let hero = idle(clock), dog;
        let b = null;
        if (ph === 'start'){
          hero = POSES.throw(pt); D.face = 1;
          dog = Object.assign(dogBase(), { head:-12 });
          if (pt > 0.35) b = { x: HX + 30, y: 150 };
          if (pt > 0.36){ ph = 'fly'; pt = 0; Sound.whoosh(); Sound.bark(1); }
        } else if (ph === 'fly'){
          hero = pt < 0.45 ? POSES.throw(0.36 + pt) : POSES.point(pt);
          const k = clamp(pt/flight, 0, 1);
          b = { x: lerp(HX + 30, BX, k), y: lerp(150, BUP, k) + 4*arc*k*(1-k) };
          if (k >= 1 && !act.landed){ act.landed = true; Sound.boing(); }
          if (k >= 1) b.y = BUP + 18*Math.abs(Math.sin((pt-flight)*Math.PI/0.25))*Math.exp(-(pt-flight)*5);
          if (dogTX === null && pt > 0.1) dogTX = BX - 84 >= D.x ? BX - 84 : BX - 10;
          const there = dogTX !== null && dogMoveTo2(dogTX, DOG_Y, run, dt);
          if (there) D.face = dogTX === BX - 84 ? 1 : -1;
          dog = there ? Object.assign(dogBase(), { head:20 }) : dogTrot(dogBase());
          if (there && pt > flight + 0.3){ ph = 'carry'; pt = 0; fx('!', dogHeadX(), 70 - D.y); Sound.pant(); }
        } else if (ph === 'carry'){
          hero = POSES.wave(clock);
          const there = dogMoveTo2(FRONT_X, 0, run, dt);
          dog = there ? dogSit(dogBase()) : dogTrot(dogBase());
          dog.ball = true;
          if (there){ D.face = -1; ph = 'drop'; pt = 0; Sound.bark(2); }
        } else if (ph === 'drop'){
          hero = POSES.pet(pt);
          dog = dogSit(dogBase()); dog.tail = 35*Math.sin(clock*20); dog.happy = true; dog.head = -10;
          b = { x: FRONT_X - 4, y: 0 };
          if (pt > fxAt){ fx('❤️', HX + 34, 70); fxAt = pt + 0.4; }
          if (pt < 0.05){ fx('Good job, ' + NAMES.pet + '!', HX, 150); Sound.babble('Good job!'); }
          if (pt > 2.2) act.done = true;
        }
        showBall(b);
        if (act.done) showBall(null);
        return { hero, dog };
      };
    } else if (name === 'pet'){
      act.tick = dt => {
        pt += dt; let hero = idle(clock), dog;
        if (ph === 'start'){
          const there = dogMoveTo(FRONT_X, 300, dt);
          dog = there ? dogSit(dogBase()) : dogTrot(dogBase());
          if (there){ D.face = -1; ph = 'pet'; pt = 0; Sound.whine(); Sound.pant(); }
        } else {
          hero = POSES.pet(pt);
          dog = dogSit(dogBase()); dog.tail = 38*Math.sin(clock*22); dog.happy = pt > 0.5; dog.head = -12 + 4*Math.sin(clock*8);
          if (pt > fxAt){ fx(Math.random() < .5 ? '❤️' : '💕', HX + 30 + Math.random()*16, 72); fxAt = pt + 0.35; }
          if (pt > 0.9 && pt - dt <= 0.9){ fx('Woof!', dogHeadX(), 60); Sound.bark(1); }
          if (pt > 2.8) act.done = true;
        }
        return { hero, dog };
      };
    } else if (name === 'dance'){
      Sound.beat(3.6); if (hasDog) Sound.bark(2);
      act.tick = dt => {
        pt += dt;
        const hero = POSES.step(pt), w = pt*Math.PI*2/0.6, s = Math.sin(w);
        let dog = dogBase();
        if (hasDog){ D.face = 1; Object.assign(dog, { face:1, root:'dance', bounce:-6*Math.abs(s), fl:-30 + 30*s, fr:-30 - 30*s, bl:55, br:55,
          tail:40*Math.sin(clock*18), mouth:true, head:-10 }); }
        if (pt > fxAt){ fx(Math.random() < .5 ? '🎵' : '🎶', HX + (Math.random()*120 - 60), 170 + Math.random()*30); fxAt = pt + 0.35; }
        if (pt > 3.6) act.done = true;
        return { hero, dog };
      };
    } else { // style: chain two random moves
      const names = flairNames(), a = names.includes('aerial') && Math.random() < .5 ? 'aerial' : names[Math.floor(Math.random()*names.length)];
      let b = names[Math.floor(Math.random()*names.length)]; if (b === a) b = 'point';
      if (a === 'aerial') avatar.playClip();
      act.tick = dt => {
        const p0 = pt; pt += dt; let hero;
        if (p0 < FLAIRS[a] && pt >= FLAIRS[a] && b === 'aerial') avatar.playClip();
        if (pt < FLAIRS[a]){ hero = POSES[a](pt, FLAIRS[a]); sfx(a, p0, pt); }
        else if (pt < FLAIRS[a] + FLAIRS[b]){ hero = POSES[b](pt - FLAIRS[a], FLAIRS[b]); sfx(b, p0 - FLAIRS[a], pt - FLAIRS[a]); }
        else { hero = idle(clock); act.done = true; }
        return { hero, dog: null };
      };
    }
    return act;
  }

  // ================= Aim mode: click anywhere on any screen =================
  const aimEl = $('#aim'), reticle = $('#reticle');
  function union(){
    const x = Math.min(...areas.map(a => a.x)), y = Math.min(...areas.map(a => a.y));
    return { x, y, width: Math.max(...areas.map(a => a.x + a.width)) - x, height: Math.max(...areas.map(a => a.y + a.height)) - y };
  }
  function localPoint(e){ // window-local px, works even if the page is scaled
    const r = aimEl.getBoundingClientRect(), k = aimEl.offsetWidth / r.width;
    return { x: (e.clientX - r.left)*k, y: (e.clientY - r.top)*k };
  }
  function startAim(){
    const U = union(); big = true; aiming = true; bubble.hidden = true;
    aimEl.style.width = U.width + 'px'; aimEl.style.height = U.height + 'px'; aimEl.hidden = false;
  }
  function endAim(){ aiming = false; aimEl.hidden = true; }
  aimEl.addEventListener('mousemove', e => { const p = localPoint(e); reticle.style.transform = `translate(${p.x}px, ${p.y}px)`; });
  aimEl.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    const U = union(), p = localPoint(e);
    endAim(); activity = makeActivity('fetch', { target: { x: U.x + p.x, y: U.y + p.y } });
  });
  const cancelAim = () => { if (!aiming) return; endAim(); big = false; showAsk(); };
  aimEl.addEventListener('contextmenu', e => { e.preventDefault(); cancelAim(); });
  $('#aimCancel').addEventListener('click', cancelAim);
  addEventListener('keydown', e => { if (e.key === 'Escape') cancelAim(); });

  // ================= When the hero is hidden, the pet acts out his moves =================
  const mimic = { key: null, st: {}, sounded: false };
  function petMimic(name, t, dt){
    if (mimic.key !== name){ mimic.key = name; mimic.st = {}; mimic.sounded = false; }
    const o = dogBase();
    switch (name){
      case 'drink': case 'step': {
        if (!mimic.sounded){ mimic.sounded = true; Sound.bark(2); }
        const s = Math.sin(t*Math.PI*2/0.6); D.face = 1;
        return Object.assign(o, { root:'dance', bounce:-6*Math.abs(s), fl:-30 + 30*s, fr:-30 - 30*s, bl:55, br:55, tail:40*Math.sin(clock*18), mouth:true, head:-10 });
      }
      case 'spin': return TRICKS.chase.dog(t, mimic.st, dt);
      case 'collar': return TRICKS.scratch.dog(t, mimic.st, dt);
      case 'shades': case 'point': case 'wave': { if (!mimic.sounded){ mimic.sounded = true; D.barkT = 0.6; Sound.bark(1); } return dogSit(o); }
      case 'shrug': { if (!mimic.sounded){ mimic.sounded = true; Sound.whine(); } const p = dogSit(o); p.head = 14; return p; }
      default: return null;
    }
  }

  // ================= Bubble =================
  const bubble = $('#bubble'), bText = $('#bText'), bActions = $('#bActions');
  let hideAt = 0;
  const bNote = $('#bNote');
  let askMode = 'water', askItem = null;
  function say(text, ms){ if (heroOn) Sound.babble(text); else Sound.bark(1); bText.textContent = text; bNote.hidden = true; bActions.hidden = true; bubble.hidden = false; hideAt = ms ? performance.now() + ms : 0; }
  function showAsk(){
    $('#waterBtns').hidden = askMode !== 'water'; $('#remBtns').hidden = askMode !== 'reminder'; $('#helloBtns').hidden = askMode !== 'hello';
    bNote.hidden = true;
    if (askMode === 'water') bText.textContent = count === 0 ? 'Boss, first glass of water today. Done?' : 'Water break, boss. Had a glass?';
    else if (askMode === 'reminder'){
      bText.textContent = askItem.title;
      const note = [askItem.note, askItem.late ? 'This was due earlier.' : ''].filter(Boolean).join(' ');
      if (note){ bNote.textContent = note; bNote.hidden = false; }
    } else bText.textContent = "Hi! I'm " + lead() + ". I'll pop up whenever a reminder is due.";
    if (!showAsk.said){ showAsk.said = true; Sound.chime(); setTimeout(() => { if (heroOn) Sound.babble(bText.textContent); else Sound.bark(1); }, 450); }
    updateChips();
    bActions.hidden = false; bubble.hidden = false; hideAt = 0; askT = 0;
  }
  function placeBubble(){
    if (bubble.hidden) return;
    const bw = bubble.offsetWidth, hx = toScreenX(heroOn ? HX : D.x + 45);
    const left = clamp(hx - bw/2, 6, W - bw - 6);
    // sit above the head; if the bubble is tall, slide down over the head a little rather than being cut off at the top of the window
    bubble.style.bottom = Math.max(0, Math.min(heroOn ? 208 : 96, WIN_H - bubble.offsetHeight - 4)) + 'px';
    bubble.style.transform = `translateX(${left.toFixed(1)}px)`;
    bubble.style.setProperty('--tail', clamp(hx - left, 22, bw - 22) + 'px');
  }
  const ivText = () => interval === 1 ? 'every minute' : interval < 60 ? `every ${interval} minutes` : interval === 60 ? 'every hour' : 'every 1.5 hours';

  // ================= Targets across all screens =================
  const inArea = a => ({ x: a.x + Math.random()*Math.max(0, a.width - WIN_W), y: a.y + Math.random()*Math.max(0, a.height - WIN_H) });
  function areaOf(p){
    const fx_ = p.x + WIN_W/2, fy = p.y + WIN_H - GROUND;
    let best = areas[0], bd = Infinity;
    for (const a of areas){
      const dx = Math.max(a.x - fx_, 0, fx_ - (a.x + a.width)), dy = Math.max(a.y - fy, 0, fy - (a.y + a.height));
      const d = dx*dx + dy*dy; if (d < bd){ bd = d; best = a; }
    }
    return best;
  }
  const anyT = () => inArea(areas[Math.floor(Math.random()*areas.length)]);
  const otherT = () => { const cur = areaOf(pos), others = areas.filter(a => a !== cur); return inArea(others.length ? others[Math.floor(Math.random()*others.length)] : cur); };
  const centerT = () => ({ x: wa.x + wa.width/2 - WIN_W/2, y: clamp(wa.y + wa.height*0.55 - WIN_H/2, wa.y, wa.y + wa.height - WIN_H) });
  function route(dest){
    const A = areaOf(pos), B = areaOf(dest);
    if (A === B) return [dest];
    const near = (u, v) => Math.abs(u - v) < 60;
    if (near(A.x + A.width, B.x) || near(B.x + B.width, A.x)){
      const lo = Math.max(A.y, B.y), hi = Math.min(A.y + A.height, B.y + B.height) - WIN_H;
      if (hi >= lo){
        const y = clamp(pos.y, lo, hi), bRight = B.x > A.x;
        const exitX = bRight ? A.x + A.width - WIN_W/2 : A.x - WIN_W/2;
        const entryX = bRight ? B.x + 20 : B.x + B.width - WIN_W - 20;
        return [{ x: pos.x, y }, { x: exitX, y }, { x: entryX, y }, dest];
      }
    }
    if (near(A.y + A.height, B.y) || near(B.y + B.height, A.y)){
      const lo = Math.max(A.x, B.x), hi = Math.min(A.x + A.width, B.x + B.width) - WIN_W;
      if (hi >= lo){
        const x = clamp(pos.x, lo, hi), bBelow = B.y > A.y;
        const entryY = bBelow ? B.y + 20 : B.y + B.height - WIN_H - 20;
        return [{ x, y: pos.y }, { x, y: entryY }, dest];
      }
    }
    return [dest];
  }

  // ================= Sequencer =================
  function run(list){ steps = list.slice(); flair = null; activity = null; dogSolo = null; showBall(null); next(); }
  function next(){
    step = steps.shift() || null; stepT = 0; mimic.key = null;
    if (!step) return;
    if (step.say !== undefined){ say(step.say, step.ms); next(); return; }
    if (step.walk){ step.path = route(step.walk()); target = step.path.shift(); }
    if (step.ask) showAsk();
  }
  const ARRIVE = [{pose:'landing',dur:1.6}];

  api.onAppear(d => {
    wa = d.wa; areas = (d.areas && d.areas.length) ? d.areas : [d.wa]; pos = { ...d.start };
    count = d.count; goal = d.goal; interval = d.interval;
    applySettings(d.settings);
    dir = pos.x < wa.x + wa.width/2 - WIN_W/2 ? 1 : -1;
    D.x = FOLLOW_X; D.face = 1;
    if (clickThrough) clickThrough.reset();
    bubble.hidden = true; stage.style.opacity = 0; showAsk.said = false;
    askItem = d.item || { type: 'water' };
    askMode = askItem.type === 'reminder' ? 'reminder' : askItem.type === 'hello' ? 'hello' : 'water';
    if (d.kind === 'intro' && askMode === 'water'){
      run([...ARRIVE, {say:`${lead()} reporting for duty${heroOn && petOn ? ' with ' + NAMES.pet : ''}. I'll drop in ${ivText()}.`, ms:5000},
           {pose:'shades',dur:2.6}, {walk:otherT}, {pose:'step',dur:2.4}, {walk:centerT}, {ask:true}]);
    } else if (askMode === 'hello'){
      run([...ARRIVE, {pose:'shades',dur:2.6}, {ask:true}]);
    } else {
      run([...ARRIVE, {walk:otherT}, {pose:'collar',dur:1.6}, {walk:centerT}, {pose:'shades',dur:2.6}, {ask:true}]);
    }
  });

  // ================= Answers (the only way he leaves) =================
  const atAsk = () => step && step.ask && !activity && !aiming;
  $('#yes').addEventListener('click', async () => {
    if (!atAsk()) return;
    bActions.hidden = true;
    const r = await api.logGlass(); count = r.count; goal = r.goal; Sound.cheer();
    const msg = count === goal ? `${count} of ${goal}. Goal complete. Semma!` :
                count > goal ? `${count} glasses today. Next level, boss.` : `Mass! That's ${count} of ${goal} today.`;
    run([{pose:'drink',dur:2.6}, {say:msg, ms:5000}, {pose:'step',dur:2.4}, {pose:'point',dur:1.6},
         {walk:otherT}, {pose:'spin',dur:1.2}, {fade:interval, info:{type:'water', minutes:interval}}]);
  });
  $('#no').addEventListener('click', () => {
    if (!atAsk()) return;
    run([{say:"5 minutes, boss. I'm coming back.", ms:4500}, {pose:'shrug',dur:1.6}, {pose:'point',dur:1.6}, {walk:anyT}, {fade:5, info:{type:'water', minutes:5}}]);
  });
  $('#skip').addEventListener('click', () => {
    if (!atAsk()) return;
    run([{say:`Okay, skipping this one. See you ${ivText().replace('every ', 'in ')}.`, ms:4500}, {pose:'collar',dur:1.6},
         {walk:anyT}, {pose:'spin',dur:1.2}, {fade:interval, info:{type:'water', minutes:interval}}]);
  });
  // reminders (anything other than water)
  const remInfo = (action, minutes) => ({ type:'reminder', id: askItem.id, action, minutes, preview: !!askItem.preview });
  $('#remDone').addEventListener('click', () => {
    if (!atAsk()) return; bActions.hidden = true; Sound.cheer();
    run([{say:'Nice work!', ms:3500}, {pose:'point',dur:1.6}, {pose:'step',dur:2.4}, {walk:otherT}, {pose:'spin',dur:1.2}, {fade:0, info:remInfo('done')}]);
  });
  const snooze = (min, label) => { if (!atAsk()) return; bActions.hidden = true;
    run([{say:`OK, I'll remind you again in ${label}.`, ms:4000}, {pose:'shrug',dur:1.6}, {pose:'point',dur:1.6}, {walk:anyT}, {fade:0, info:remInfo('snooze', min)}]); };
  $('#remS10').addEventListener('click', () => snooze(10, '10 minutes'));
  $('#remS60').addEventListener('click', () => snooze(60, 'an hour'));
  $('#remSkip').addEventListener('click', () => {
    if (!atAsk()) return; bActions.hidden = true;
    run([{say:'Skipped.', ms:3000}, {pose:'collar',dur:1.6}, {walk:anyT}, {pose:'spin',dur:1.2}, {fade:0, info:remInfo('skip')}]);
  });
  $('#helloClose').addEventListener('click', () => {
    if (!atAsk()) return; bActions.hidden = true;
    run([{say:'See you soon!', ms:2500}, {pose:'point',dur:1.6}, {walk:anyT}, {fade:0, info:{ type:'hello' }}]);
  });
  document.querySelectorAll('[data-play]').forEach(b => b.addEventListener('click', () => {
    if (!atAsk()) return;
    if (b.dataset.play === 'fetch'){ startAim(); return; }
    flair = null; dogSolo = null; bubble.hidden = true; activity = makeActivity(b.dataset.play);
  }));

  $('#tricksBtn').addEventListener('click', () => { const tr = $('#tricks'); tr.hidden = !tr.hidden; renderNames(); });
  $('#fig').addEventListener('click', () => {
    if (step && step.walk && steps.some(s => s.ask)){ steps = steps.filter(s => s.ask); next(); return; }
    if (atAsk() && !flair) randomFlair();
  });
  dogEl.addEventListener('click', () => {
    if (activity || D.barkT > 0) return;
    D.barkT = 0.6; fx('Woof!', dogHeadX(), 62); Sound.bark(2);
  });

  // ================= Windows: click through the see-through parts =================
  const clickThrough = (api.platform === 'win32' && api.setClickThrough) ? (() => {
    let ignoring = false;
    const set = v => { if (v !== ignoring){ ignoring = v; api.setClickThrough(v); } };
    document.addEventListener('mousemove', e => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      set(!(el && el.closest && el.closest('#fig, #dog, #bubble, #aim')));
    });
    return { reset(){ ignoring = false; api.setClickThrough(false); } };
  })() : null;

  // ================= Loop =================
  let last = performance.now();
  function frame(now){
    const dt = Math.min(0.1, (now - last)/1000); last = now; clock += dt; frameDt = dt;
    let pose = idle(clock), dogPose = null, heroWalking = false;

    if (step){
      stepT += dt;
      if (step.pose){
        pose = POSES[step.pose](stepT, step.dur); sfx(step.pose, stepT - dt, stepT, step.dur);
        if (step.pose === 'landing'){
          stage.style.opacity = Math.min(1, stepT/0.15);
          const k = clamp((stepT - 0.25)/0.45, 0, 1); D.drop = -200*(1 - k*k);
        }
        if (stepT >= step.dur) next();
      } else if (step.walk){
        const speed = 170, dx = target.x - pos.x, dy = target.y - pos.y, d = Math.hypot(dx, dy);
        if (d < 2){ if (step.path && step.path.length) target = step.path.shift(); else next(); }
        else {
          const st = Math.min(d, speed*dt);
          pos.x += dx/d*st; pos.y += dy/d*st;
          if (Math.abs(dx) > 1.5) dir = dx > 0 ? 1 : -1;
          phase += st/12.5; pose = walk(phase); heroWalking = true;
        }
      } else if (step.ask){
        askT += dt;
        if (aiming){
          pose = POSES.throw(0.3); pose.mouth = 'smirk';
          dogPose = Object.assign(dogBase(), { head:-14, tail:30*Math.sin(clock*16) });
        } else if (activity){
          const r = activity.tick(dt); pose = r.hero; dogPose = r.dog;
          if (activity.done){ activity = null; big = false; showBall(null); showAsk(); }
        } else if (flair){
          flairT += dt; pose = POSES[flair](flairT, FLAIRS[flair]); sfx(flair, flairT - dt, flairT);
          if (flairT >= FLAIRS[flair]){ flair = null; askT = 3; }
        } else {
          pose = askT < 3 ? POSES.wave(clock) : idle(clock);
          if (askT > 9) randomFlair();
        }
        if (!activity && !aiming){ const sp = dogSoloTick(dt); if (sp) dogPose = sp; }
      } else if (step.fade !== undefined){
        stage.style.opacity = Math.max(0, 1 - stepT/0.5);
        if (stepT >= 0.5){ const info = step.info || { type:'water', minutes: step.fade }; step = null; bubble.hidden = true; api.done(info); }
      }
    }

    if (!heroOn && !dogPose && step){
      if (step.pose && step.pose !== 'landing') dogPose = petMimic(step.pose, stepT, dt);
      else if (step.ask && flair && !activity) dogPose = petMimic(flair, flairT, dt);
    }
    if (D.barkT > 0) D.barkT -= dt;
    if (!dogPose) dogPose = dogDefault(dt, heroWalking);
    if (!step || !step.pose || step.pose !== 'landing') D.drop = 0;
    if (hideAt && now > hideAt){ bubble.hidden = true; hideAt = 0; }

    scene.style.transform = `scaleX(${dir})`;
    applyHero(pose); applyDog(dogPose); placeBubble();
    let bx = Math.round(pos.x), by = Math.round(pos.y), bw = W, bh = WIN_H;
    if (big){ const U = union(); bx = U.x; by = U.y; bw = U.width; bh = U.height;
      stage.style.transform = `translate(${Math.round(pos.x - U.x)}px, ${Math.round(pos.y - U.y)}px)`; }
    else stage.style.transform = '';
    const key = [bx, by, bw, bh].join(',');
    if (key !== lastSent){ lastSent = key; api.move(bx, by, bw, bh); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
