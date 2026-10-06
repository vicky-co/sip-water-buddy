// Shows a 3D pet (.glb) in place of the cartoon pet.
// Works with static models (whole-body hops, sits, rolls) and uses the model's own
// animation clips when it has them (walk / run / idle / sit / jump / lie ...).
(function(){
  const CLIPS = {
    walk: /walk|trot/i, run: /run|gallop|sprint/i, idle: /idle|stand|breath|wag/i,
    sit: /sit/i, jump: /jump|leap/i, lie: /lie|lay|sleep|dead|death|rest/i,
  };

  // ---------- Auto-rig for static dog meshes ----------
  // Finds the 4 legs as the separate pieces of mesh below the belly, plus head and tail
  // regions, then bends them (hip, knee, neck, tail base) on the CPU each frame.
  function autoRig(THREE, meshes, toDog, L, H){
    // Gather all vertices in "dog space" (px; +x = head, +y = up, +z = toward camera)
    const parts = [];
    let total = 0;
    for (const mesh of meshes){
      const g = mesh.geometry, pos = g.attributes.position, nor = g.attributes.normal;
      const M = toDog(mesh), Minv = M.clone().invert(), N = new THREE.Matrix3().getNormalMatrix(M), Ninv = new THREE.Matrix3().getNormalMatrix(Minv);
      const n = pos.count, P = new Float32Array(n*3), Nn = nor ? new Float32Array(n*3) : null, v = new THREE.Vector3();
      for (let i = 0; i < n; i++){
        v.fromBufferAttribute(pos, i).applyMatrix4(M); P[i*3] = v.x; P[i*3+1] = v.y; P[i*3+2] = v.z;
        if (Nn){ v.fromBufferAttribute(nor, i).applyMatrix3(N).normalize(); Nn[i*3] = v.x; Nn[i*3+1] = v.y; Nn[i*3+2] = v.z; }
      }
      const idx = g.index ? g.index.array : null;
      parts.push({ mesh, g, pos, nor, M, Minv, Ninv, P, N: Nn, n, idx, base: total }); total += n;
    }
    // Union-find over vertices (by shared triangles and by identical position across seams)
    function components(h){
      const par = new Int32Array(total); for (let i = 0; i < total; i++) par[i] = i;
      const find = a => { while (par[a] !== a){ par[a] = par[par[a]]; a = par[a]; } return a; };
      const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
      const below = new Uint8Array(total);
      const key = new Map();
      for (const pt of parts){
        for (let i = 0; i < pt.n; i++){
          if (pt.P[i*3+1] >= h) continue; const gi = pt.base + i; below[gi] = 1;
          const k = Math.round(pt.P[i*3]*20) + ',' + Math.round(pt.P[i*3+1]*20) + ',' + Math.round(pt.P[i*3+2]*20);
          const o = key.get(k); if (o === undefined) key.set(k, gi); else uni(gi, o);
        }
        const tri = pt.idx, cnt = tri ? tri.length : pt.n;
        for (let t = 0; t < cnt; t += 3){
          const a = tri ? tri[t] : t, b = tri ? tri[t+1] : t+1, c = tri ? tri[t+2] : t+2;
          const A = pt.base + a, B = pt.base + b, C = pt.base + c;
          if (below[A] && below[B]) uni(A, B); if (below[B] && below[C]) uni(B, C); if (below[A] && below[C]) uni(A, C);
        }
      }
      const groups = new Map();
      for (let i = 0; i < total; i++) if (below[i]){ const r = find(i); groups.set(r, (groups.get(r) || 0) + 1); }
      const big = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      return { find, below, big, ok: big.length === 4 && big[3][1] > total*0.004 };
    }
    // Highest cut height where 4 separate legs still exist = belly line
    let best = null;
    for (let f = 0.62; f >= 0.22; f -= 0.04){ const c = components(H*f); if (c.ok){ best = { h: H*f, c }; break; } }
    if (!best) return null;
    const legTop = best.h, { find, big } = best.c;
    const roots = big.map(b => b[0]);
    // Leg centroids → which leg is which
    const acc = roots.map(() => ({ x:0, z:0, n:0, tx:0, tz:0, tn:0, fx:0, fy:Infinity }));
    const legOf = new Int8Array(total).fill(-1);
    for (const pt of parts) for (let i = 0; i < pt.n; i++){
      const gi = pt.base + i; if (!best.c.below[gi]) continue;
      const li = roots.indexOf(find(gi)); if (li < 0) continue; legOf[gi] = li;
      const a = acc[li], x = pt.P[i*3], y = pt.P[i*3+1], z = pt.P[i*3+2];
      a.x += x; a.z += z; a.n++; if (y < a.fy){ a.fy = y; a.fx = x; }
      if (y > legTop*0.8){ a.tx += x; a.tz += z; a.tn++; }
    }
    const legs = acc.map(a => ({ fx: a.fx, fy: a.fy, cx: a.x/a.n, cz: a.z/a.n, hx: a.tn ? a.tx/a.tn : a.x/a.n, hz: a.tn ? a.tz/a.tn : a.z/a.n }));
    const byX = [...legs.keys()].sort((a, b) => legs[b].cx - legs[a].cx);       // front two first
    const name = new Array(4);
    const front = byX.slice(0, 2).sort((a, b) => legs[b].cz - legs[a].cz);     // near (+z) first
    const back = byX.slice(2).sort((a, b) => legs[b].cz - legs[a].cz);
    name[front[0]] = 'fr'; name[front[1]] = 'fl'; name[back[0]] = 'br'; name[back[1]] = 'bl';
    let xmin = Infinity, xmax = -Infinity;
    for (const pt of parts) for (let i = 0; i < pt.n; i++){ const x = pt.P[i*3]; if (x < xmin) xmin = x; if (x > xmax) xmax = x; }
    const blend = H*0.14, kneeY = legTop*0.48, yTop = legTop + blend, yFull = legTop*0.62, R = L*0.18;
    const neck = { x: xmax - (xmax - xmin)*0.30, y: H*0.62 }, tailBase = { x: xmin + (xmax - xmin)*0.16, y: H*0.62 };
    const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a)/(b - a))); return t*t*(3 - 2*t); };
    // Per-vertex weights
    for (const pt of parts){
      const list = [];
      for (let i = 0; i < pt.n; i++){
        const gi = pt.base + i, x = pt.P[i*3], y = pt.P[i*3+1], z = pt.P[i*3+2];
        // Weight fades in smoothly from above the belly line down the thigh, and with distance from the hip
        let leg = legOf[gi], w = 0;
        if (y < yTop){
          let bd = Infinity, near = -1; legs.forEach((l, k) => { const d = Math.hypot(x - l.hx, z - l.hz); if (d < bd){ bd = d; near = k; } });
          const wy = ss(yTop, yFull, y), wd = ss(R, R*0.45, bd);
          if (leg >= 0){ const own = Math.hypot(x - legs[leg].hx, z - legs[leg].hz); w = wy * Math.max(ss(R, R*0.45, own), ss(legTop, yFull, y)); }
          else { leg = near; w = wy * wd; if (w < 0.01) leg = -1; }
        }
        if (leg < 0) w = 0;
        const wk = leg >= 0 && legOf[gi] === leg ? ss(kneeY + H*0.05, kneeY - H*0.05, y) : 0;
        const wh = leg < 0 ? ss(neck.x - L*0.05, neck.x + L*0.08, x) * ss(legTop + blend*0.5, legTop + blend*1.5, y) : 0;
        const wt = leg < 0 ? ss(tailBase.x + L*0.04, tailBase.x - L*0.06, x) * ss(legTop, legTop + blend, y) : 0;
        if (w || wh || wt) list.push(i, leg >= 0 ? ['fr','fl','br','bl'].indexOf(name[leg]) : -1, w, wk, wh, wt);
      }
      pt.list = list;
    }
    const hips = {}, knees = {}, feet = {};
    legs.forEach((l, k) => { hips[name[k]] = { x: l.hx, y: legTop }; knees[name[k]] = { x: l.cx, y: kneeY }; feet[name[k]] = { x: l.fx, y: l.fy }; });
    // Each knee bends whichever way lifts its paw (depends on how the model was posed)
    const kdir = {};
    for (const k of ['fr','fl','br','bl']){ const f = feet[k], kn = knees[k], a = -0.35, dx = f.x - kn.x, dy = f.y - kn.y;
      kdir[k] = (kn.y + dx*Math.sin(a) + dy*Math.cos(a)) > f.y ? 1 : -1; }
    const LEGS = ['fr','fl','br','bl'];
    const tmp = new THREE.Vector3();
    return {
      legTop, names: name,
      pose(angles){ // degrees: leg (+ = forward), knee (+ = flex), head (+ = nose down), tail (yaw)
        const d2r = Math.PI/180;
        const cs = LEGS.map(k => { const a = (angles[k] || 0)*d2r, kf = (angles['k' + k] || 0)*d2r*kdir[k], hp = hips[k], kn = knees[k];
          // knee pivot after the hip rotation
          const kx = hp.x + (kn.x - hp.x)*Math.cos(a) - (kn.y - hp.y)*Math.sin(a), ky = hp.y + (kn.x - hp.x)*Math.sin(a) + (kn.y - hp.y)*Math.cos(a);
          return { a, kf, hp, kx, ky }; });
        const ha = -(angles.head || 0)*d2r, ta = (angles.tail || 0)*d2r;
        // Keep paws out of the ground: bend the knee more if a swing would push the paw under,
        // then lift the body by whatever is left
        const footY = (C, k) => { const f = feet[k], kn = knees[k]; let x = f.x, y = f.y;
          if (C.kf){ const c = Math.cos(-C.kf), s = Math.sin(-C.kf), dx = x - kn.x, dy = y - kn.y; x = kn.x + dx*c - dy*s; y = kn.y + dx*s + dy*c; }
          const c = Math.cos(C.a), s = Math.sin(C.a), dx = x - C.hp.x, dy = y - C.hp.y; return C.hp.y + dx*s + dy*c; };
        let sink = 0;
        LEGS.forEach((k, li) => { const C = cs[li];
          for (let it = 0; it < 14 && footY(C, k) < 0; it++) C.kf += 0.08*kdir[k];
          sink = Math.max(sink, -footY(C, k)); });
        for (const pt of parts){
          const L_ = pt.list, P = pt.P, Nn = pt.N, out = pt.pos.array, onor = pt.nor ? pt.nor.array : null;
          for (let j = 0; j < L_.length; j += 6){
            const i = L_[j], li = L_[j+1], w = L_[j+2], wk = L_[j+3], wh = L_[j+4], wt = L_[j+5];
            let x = P[i*3], y = P[i*3+1], z = P[i*3+2];
            let nx = Nn ? Nn[i*3] : 0, ny = Nn ? Nn[i*3+1] : 0, nz = Nn ? Nn[i*3+2] : 0;
            const rotZ = (ang, px, py) => { const c = Math.cos(ang), s = Math.sin(ang), dx = x - px, dy = y - py;
              x = px + dx*c - dy*s; y = py + dx*s + dy*c; const n1 = nx*c - ny*s; ny = nx*s + ny*c; nx = n1; };
            if (li >= 0){ const C = cs[li]; if (wk && C.kf) rotZ(-C.kf*wk, knees[LEGS[li]].x, knees[LEGS[li]].y); rotZ(C.a*w, C.hp.x, C.hp.y); }
            if (wh) rotZ(ha*wh, neck.x, neck.y);
            if (wt){ const c = Math.cos(ta*wt), s = Math.sin(ta*wt), dx = x - tailBase.x, dz = z;
              x = tailBase.x + dx*c + dz*s; z = -dx*s + dz*c; const n1 = nx*c + nz*s; nz = -nx*s + nz*c; nx = n1; }
            tmp.set(x, y, z).applyMatrix4(pt.Minv); out[i*3] = tmp.x; out[i*3+1] = tmp.y; out[i*3+2] = tmp.z;
            if (onor){ tmp.set(nx, ny, nz).applyMatrix3(pt.Ninv).normalize(); onor[i*3] = tmp.x; onor[i*3+1] = tmp.y; onor[i*3+2] = tmp.z; }
          }
          pt.pos.needsUpdate = true; if (pt.nor) pt.nor.needsUpdate = true;
        }
        return Math.min(sink, H*0.08);
      },
    };
  }

  // Bone offsets in degrees about each bone's lateral axis. Negative swings a limb forward / lifts the nose.
  const both = (n, v) => ({ [n + '_L']: v, [n + '_R']: v });
  const SIT  = Object.assign({}, both('h_thigh', -62), both('h_shin', 78), both('h_meta', -42), both('f_upper', 22), both('f_lower', -6), { spine: 6, neck: -8 });
  const BEG  = Object.assign({}, both('h_thigh', -34), both('h_shin', 52), both('h_meta', -10), both('f_upper', -64), both('f_lower', 74), { spine: -14, neck: -6, head: 8 });
  const DOWN = Object.assign({}, both('h_thigh', -40), both('h_shin', 52), both('h_meta', -12), both('f_upper', -34), both('f_lower', 52), { neck: 30, head: 14 });

  // Bones that touch the floor when lying down, with roughly how thick the body is around each (metres)
  const CONTACT = [['muzzle', .035], ['head', .09], ['ear_L', .03], ['ear_R', .03], ['neck', .11], ['chest', .16], ['spine', .15], ['hips', .15], ['tail3', .03], ['f_upper_L', .06], ['f_upper_R', .06], ['f_paw_L', .025], ['f_paw_R', .025], ['h_paw_L', .025], ['h_paw_R', .025]];

  window.createPet3D = function(canvas, buffer, opts){
    const { THREE, GLTFLoader } = window.SIP3D;
    const W = opts.width, H = opts.height, ground = opts.ground; // canvas px, ground = px from bottom
    const renderer = new THREE.WebGLRenderer({ canvas, alpha:true, antialias:true, premultipliedAlpha:true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(W, H, false); renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    // Orthographic camera in pixel units, origin at the dog's feet centre
    const cam = new THREE.OrthographicCamera(-W/2, W/2, H - ground, -ground, -2000, 2000);
    cam.position.set(0, 0, 1000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x5a5048, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(200, 400, 600); scene.add(key);

    const view = new THREE.Group(); view.rotation.y = THREE.MathUtils.degToRad(-22); // a little three-quarter
    const body = new THREE.Group(), offset = new THREE.Group(), align = new THREE.Group();
    scene.add(view); view.add(body); body.add(offset); offset.add(align);

    return new Promise((resolve, reject) => {
      new GLTFLoader().parse(buffer, '', gltf => {
        const model = gltf.scene;
        model.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
        align.add(model);
        const viewYaw = view.rotation.y; view.rotation.y = 0; scene.updateMatrixWorld(true); // measure unrotated
        let box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
        if (!(size.x > 0 && size.y > 0)) { reject(new Error('That model has no visible size')); return; }
        // Body length along X on screen; glTF models face +Z, so turn +Z toward +X
        const longZ = size.z > size.x;
        align.rotation.y = (longZ ? Math.PI/2 : 0) + (opts.flip ? Math.PI : 0);
        scene.updateMatrixWorld(true);
        box = new THREE.Box3().setFromObject(align); size = box.getSize(new THREE.Vector3());
        // Fit about 90 px long / 64 px tall, feet on the ground, centred
        const s = Math.min(opts.length / size.x, opts.tall / size.y);
        align.scale.setScalar(s);
        scene.updateMatrixWorld(true);
        box = new THREE.Box3().setFromObject(align);
        const c = box.getCenter(new THREE.Vector3());
        align.position.set(-c.x, -box.min.y, -c.z);
        const L = (box.max.x - box.min.x), Hh = (box.max.y - box.min.y);
        view.rotation.y = viewYaw;

        // Static model (no skeleton, no clips): auto-rig the legs, head and tail
        let rig = null;
        const statics = []; model.traverse(o => { if (o.isMesh && !o.isSkinnedMesh) statics.push(o); });
        let skinned = false; model.traverse(o => { if (o.isSkinnedMesh) skinned = true; });
        if (!skinned && !(gltf.animations || []).length && statics.length){
          scene.updateMatrixWorld(true);
          const offInv = offset.matrixWorld.clone().invert();
          for (const m of statics){ m.geometry = m.geometry.clone(); } // own copy we can bend
          try { rig = autoRig(THREE, statics, mesh => offInv.clone().multiply(mesh.matrixWorld), L, Hh); } catch(e){ rig = null; }
        }
        // Animation clips, matched by name
        const mixer = new THREE.AnimationMixer(model), actions = {};
        const clips = gltf.animations || [];
        for (const [k, re] of Object.entries(CLIPS)){ const cl = clips.find(a => re.test(a.name)); if (cl) actions[k] = mixer.clipAction(cl); }
        if (!actions.idle && clips.length) actions.idle = mixer.clipAction(clips[0]);
        if (!actions.walk && actions.run) actions.walk = actions.run;
        let current = null;
        function play(k){
          const a = actions[k] || actions.idle; if (!a || a === current) return;
          a.reset().fadeIn(0.2).play(); if (current) current.fadeOut(0.2); current = a;
        }
        const has = k => !!actions[k];
        const d2r = THREE.MathUtils.degToRad;
        // Skeletal dog (has its own bones + clips): choose walk/run by real speed, add bone poses on top
        const skeletal = skinned && clips.length > 0;
        const bones = {}; if (skeletal) model.traverse(o => { if (o.isBone) bones[o.name] = o; });
        const pxm = align.scale.x;                                  // px per model unit (metre)
        const WALK_V = 0.44*pxm, RUN_V = 2.06*pxm;                    // ground speed each clip was animated for
        const sm = { lastQ: undefined, spd: 0, gait: 'idle', off: {} };
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
        const ease = (a, b, dt, r) => a + (b - a)*Math.min(1, dt*r);
        // Bone offsets (degrees, rotation about each bone's own lateral axis) layered on the animation
        function boneTargets(o){
          const T = {}, sit = o.root === 'sit', beg = o.root === 'dance', down = o.root === 'rot';
          if (sit){ Object.assign(T, SIT); }
          if (beg){ Object.assign(T, BEG);
            T.f_upper_L += ((o.fl || 0) + 100)*0.35; T.f_upper_R += ((o.fr || 0) + 100)*0.35; }       // paddling
          if (down){
            // fold the legs up gradually as he rolls onto his back (0 when upright, 1 when fully over), and release on the way back
            const a = (((o.ang || 0) % 360) + 360) % 360, w = Math.min(1, 1.7*Math.sin(a*Math.PI/360));
            for (const n of Object.keys(DOWN)) T[n] = DOWN[n]*w;
            T.f_upper_L -= (o.fl || 0)*0.4*w; T.f_upper_R -= (o.fr || 0)*0.4*w; T.h_thigh_L -= (o.bl || 0)*0.3*w; T.h_thigh_R -= (o.br || 0)*0.3*w; }  // twitching
          // head: positive = nose down; sniffing/fetching lowers it, happy tilts it
          if (o.head) { T.head = (T.head || 0) + o.head*0.5; T.neck = (T.neck || 0) + o.head*0.4; }
          return T;
        }

        resolve({
          clipNames: clips.map(c => c.name),
          rigged: !!rig,
          apply(o, dt){
            // Whole-body pose; pivot about the rear feet for sits, the body centre for rolls
            let pitch = 0, roll = 0, px = 0, py = 0, lift = skeletal ? 0 : -(o.bob || 0);
            if (o.root === 'sit' && !has('sit')){ pitch = 24; px = -L*0.38; }
            if (o.root === 'dance'){ pitch = 52; px = -L*0.38; lift += 4; }
            if (o.root === 'rot'){ roll = o.ang || 0; py = Hh*0.5; if (!(skinned && clips.length)) lift -= (o.ty || 0); }
            if (o.moving && !has('walk') && !rig) pitch += 3*Math.sin((o.q || 0)*2);
            let rigLift = 0;
            body.position.set(px, py + lift, 0);
            offset.position.set(-px, -py, 0);
            body.rotation.set(d2r(roll), 0, d2r(pitch));
            if (rig){
              // 2D pose angles (− = forward) → 3D (+ = forward); knees flex while a leg swings forward
              const q = o.q || 0, k = {};
              if (o.moving){ k.kfr = k.kbl = 32*Math.max(0, -Math.cos(q)); k.kfl = k.kbr = 32*Math.max(0, Math.cos(q)); }
              const g = o.moving ? 0.75 : 1, cap = v => Math.max(-85, Math.min(85, v*g));
              rigLift = rig.pose(Object.assign(k, { fr: cap(-(o.fr || 0)), fl: cap(-(o.fl || 0)), br: cap(-(o.br || 0)*(o.root === 'sit' ? 0.75 : 1)), bl: cap(-(o.bl || 0)*(o.root === 'sit' ? 0.75 : 1)),
                head: (o.head || 0)*0.6, tail: (o.tail || 0)*0.7 }));
              if (o.root !== 'rot' && o.root !== 'dance') body.position.y += rigLift;
            }
            if (skeletal){
              // speed from how fast the cartoon-space gait phase advances (7 px per unit of q)
              const q = o.q || 0; let spd = 0;
              if (o.moving && sm.lastQ !== undefined) spd = Math.max(0, q - sm.lastQ)*7/Math.max(dt, 0.001);
              sm.lastQ = q; sm.spd = ease(sm.spd, spd, dt, 10);
              const still = !o.moving || sm.spd < 8;
              let key = 'idle', ts = 1;
              if (!still){
                const wantRun = sm.gait === 'run' ? sm.spd > RUN_V*0.45 : sm.spd > RUN_V*0.62;
                if (wantRun && has('run')){ key = 'run'; ts = clamp(sm.spd/RUN_V, 0.55, 2.4); }
                else if (has('walk')){ key = 'walk'; ts = clamp(sm.spd/WALK_V, 0.6, 2.2); }
                else key = has('run') ? 'run' : 'idle';
              }
              sm.gait = key; play(key);
              for (const a of Object.values(actions)) a.timeScale = (a === current) ? ts : 1;
              mixer.update(dt);
              // bone offsets on top of the animated pose
              const T = Object.assign(boneTargets(o), o.bones || {});
              const touched = new Map();                      // bone -> its pure animated rotation, restored after drawing
              const keep = b => { if (!touched.has(b)) touched.set(b, b.quaternion.clone()); };
              for (const n of new Set([...Object.keys(sm.off), ...Object.keys(T)])){
                sm.off[n] = ease(sm.off[n] || 0, T[n] || 0, dt, 11);
                if (Math.abs(sm.off[n]) > 0.05 && bones[n]){ keep(bones[n]); bones[n].rotateX(d2r(sm.off[n])); }
              }
              if (o.root === 'rot'){
                scene.updateMatrixWorld(true);
                const v = new THREE.Vector3(); let low = Infinity;
                for (const [n, r] of CONTACT){ const b = bones[n]; if (!b) continue; b.getWorldPosition(v); low = Math.min(low, v.y - r*pxm); }
                if (isFinite(low)) sm.contact = ease(sm.contact === undefined ? -low : sm.contact, -low, dt, 14);
                body.position.y += sm.contact || 0;
              } else sm.contact = undefined;
              sm.wag = ease(sm.wag || 0, o.tail || 0, dt, 18);
              if (Math.abs(sm.wag) > 0.1){
                if (bones.tail1){ keep(bones.tail1); bones.tail1.rotateZ(d2r(sm.wag*0.55)); }
                if (bones.tail2){ keep(bones.tail2); bones.tail2.rotateZ(d2r(sm.wag*0.35)); }
              }
              renderer.render(scene, cam);
              // undo this frame's offsets so they can never add up (some bones, e.g. the spine, have no animation to reset them)
              for (const [b, q] of touched) b.quaternion.copy(q);
              return;
            }
            // Clips
            if (clips.length){
              let k = 'idle';
              if (o.moving) k = (o.fast && has('run')) ? 'run' : 'walk';
              else if (o.root === 'sit' && has('sit')) k = 'sit';
              else if (o.root === 'rot' && Math.abs(((o.ang || 0) % 360) - 180) < 30 && has('lie')) k = 'lie';
              else if ((o.jump || 0) < -6 && has('jump')) k = 'jump';
              play(k); mixer.update(dt * (o.moving ? (o.fast ? 1.6 : 1.1) : 1));
            }
            renderer.render(scene, cam);
          },
          dispose(){ try { renderer.dispose(); renderer.forceContextLoss(); } catch(e){} },
        });
      }, err => reject(err));
    });
  };
})();
