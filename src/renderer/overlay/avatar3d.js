// Drives a rigged glTF avatar (Avaturn / Mixamo-style bone names) from the same
// pose objects the cartoon hero uses. Angles are degrees; negative swings a limb forward.
(function(){
  const PX_PER_M = 101;          // 1.85 m avatar ≈ 187 px, same height as the cartoon
  const UNIT = 1.85 / 150;       // one cartoon pose unit in metres
  const ARM_DOWN = 76;           // degrees to bring T-pose arms down to the sides
  const BASE_YAW = 62;           // three-quarter view, facing right

  window.createAvatar3D = function(canvas, buffer, opts){
    const { THREE, GLTFLoader } = window.SIP3D;
    const W = opts.width, H = opts.height, ground = opts.ground;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha:true, antialias:true, premultipliedAlpha:true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-W/2/PX_PER_M, W/2/PX_PER_M, (H - ground)/PX_PER_M, -ground/PX_PER_M, 0.1, 50);
    cam.position.set(0, 0, 10);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x50607a, 2.3));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 4, 6); scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfdcff, 1.0); rim.position.set(-4, 3, -3); scene.add(rim);

    const pivot = new THREE.Group(); scene.add(pivot);
    const X = new THREE.Vector3(1,0,0), Z = new THREE.Vector3(0,0,1);
    const d2r = d => d * Math.PI / 180;
    const qa = (axis, deg) => new THREE.Quaternion().setFromAxisAngle(axis, d2r(deg));

    return new Promise((resolve, reject) => {
      new GLTFLoader().parse(buffer, '', gltf => {
        const root = gltf.scene;
        root.traverse(o => { if (o.isMesh){ o.frustumCulled = false; } });
        pivot.add(root);
        root.updateMatrixWorld(true);
        // Normalise any avatar to 1.85 m tall, feet on the ground
        const box = new THREE.Box3().setFromObject(root), hgt = box.max.y - box.min.y;
        if (!(hgt > 0)) { reject(new Error('Avatar has no visible size')); return; }
        const sc = 1.85 / hgt; root.scale.multiplyScalar(sc); root.position.y -= box.min.y * sc;
        root.updateMatrixWorld(true);

        // Rest data for every bone
        const bones = {}, rest = [];
        // Accept Avaturn / Ready Player Me names and Mixamo's "mixamorig" prefix
        root.traverse(o => { if (o.isBone){ const n = o.name.replace(/^mixamorig\d*[:_]?/i, ''); if (!bones[n]) bones[n] = o; rest.push({ b:o, q:o.quaternion.clone(), p:o.position.clone() }); } });
        const need = ['Hips','Spine','Head','RightUpLeg','RightLeg','LeftUpLeg','LeftLeg','RightArm','RightForeArm','LeftArm','LeftForeArm','RightHand'];
        const missing = need.filter(n => !bones[n]);
        if (missing.length) { reject(new Error('This avatar has no humanoid skeleton (missing: ' + missing.join(', ') + ').')); return; }
        if (bones.Neck) need.push('Neck');
        // How far each arm already hangs below horizontal in the rest pose (T-pose ≈ 0, A-pose ≈ 45)
        const armDrop = side => { const a = new THREE.Vector3(), b = new THREE.Vector3();
          bones[side + 'Arm'].getWorldPosition(a); bones[side + 'ForeArm'].getWorldPosition(b);
          const v = b.sub(a); return Math.atan2(-v.y, Math.hypot(v.x, v.z)) * 180 / Math.PI; };
        const DOWN_R = ARM_DOWN - armDrop('Right'), DOWN_L = ARM_DOWN - armDrop('Left');
        const info = {};
        for (const n of need){
          const b = bones[n], P = new THREE.Quaternion(); b.parent.getWorldQuaternion(P);
          info[n] = { P, Pinv: P.clone().invert(), rest: b.quaternion.clone() };
        }
        const hips = bones.Hips, hipsRestWorld = new THREE.Vector3(); hips.getWorldPosition(hipsRestWorld);
        const hipsParentInv = hips.parent.matrixWorld.clone().invert();

        // Rotation q (expressed in the model's frame, as if the parent were at rest)
        const tmp = new THREE.Quaternion();
        function setRot(n, q){ const i = info[n]; tmp.copy(i.Pinv).multiply(q).multiply(i.P).multiply(i.rest); bones[n].quaternion.copy(tmp); }

        // Props: glasses (from the model), shades in hand, cup
        const glasses = []; root.traverse(o => { if (o.isMesh && /glasses/i.test(o.name)) glasses.push(o); });
        const hand = bones.RightHand, handPos = new THREE.Vector3(); hand.getWorldPosition(handPos);
        const cup = new THREE.Group();
        const glassMat = new THREE.MeshStandardMaterial({ color:0xdff3ff, transparent:true, opacity:.55, roughness:.1 });
        const waterMat = new THREE.MeshStandardMaterial({ color:0x3fa7d6, roughness:.2 });
        const c1 = new THREE.Mesh(new THREE.CylinderGeometry(.04, .033, .11, 20, 1, true), glassMat);
        const c2 = new THREE.Mesh(new THREE.CylinderGeometry(.036, .031, .06, 20), waterMat); c2.position.y = -.02;
        cup.add(c1, c2);
        const shades = new THREE.Group();
        const sMat = new THREE.MeshStandardMaterial({ color:0x111111, roughness:.3, metalness:.4 });
        for (const sx of [-.035, .035]){ const l = new THREE.Mesh(new THREE.CylinderGeometry(.028, .028, .008, 20), sMat); l.rotation.x = Math.PI/2; l.position.x = sx; shades.add(l); }
        const br = new THREE.Mesh(new THREE.BoxGeometry(.02, .006, .006), sMat); shades.add(br);
        const shadesSpin = new THREE.Group(); shadesSpin.add(shades);
        for (const [obj, off] of [[cup, new THREE.Vector3(-.06, -.02, .06)], [shadesSpin, new THREE.Vector3(-.07, 0, .04)]]){
          obj.position.copy(handPos).add(off); root.add(obj); hand.attach(obj); obj.visible = false;
        }

        // Optional built-in clip (e.g. an aerial flip) as a bonus move
        const mixer = new THREE.AnimationMixer(root);
        const clip = gltf.animations && gltf.animations[0];
        let action = null, clipLeft = 0;
        if (clip){
          for (const tr of clip.tracks) if (/Hips\.position$/.test(tr.name)){
            const v = tr.values, p = bones.Hips.position;
            for (let i = 0; i < v.length; i += 3){ v[i] = p.x; v[i+2] = p.z; } // keep the flip in place
          }
          action = mixer.clipAction(clip); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = false;
        }
        function resetRest(){ for (const r of rest){ r.b.quaternion.copy(r.q); r.b.position.copy(r.p); } }

        const api = {
          clipName: clip ? clip.name : null,
          clipDuration: clip ? clip.duration : 0,
          playClip(){ if (!action) return 0; resetRest(); action.reset().play(); clipLeft = clip.duration; return clip.duration; },
          get playingClip(){ return clipLeft > 0; },
          apply(o, dt){
            pivot.rotation.y = d2r(BASE_YAW + (o.yaw || 0));
            if (clipLeft > 0){
              mixer.update(dt); clipLeft -= dt;
              if (clipLeft <= 0){ action.stop(); resetRest(); }
              pivot.position.y = 0;
              glasses.forEach(g => g.visible = true); cup.visible = false; shadesSpin.visible = false;
              renderer.render(scene, cam); return;
            }
            setRot('RightUpLeg', qa(X, o.legF)); setRot('RightLeg', qa(X, o.shinF));
            setRot('LeftUpLeg',  qa(X, o.legB)); setRot('LeftLeg',  qa(X, o.shinB));
            setRot('RightArm', qa(X, o.armF).multiply(qa(Z,  DOWN_R)));
            setRot('LeftArm',  qa(X, o.armB).multiply(qa(Z, -DOWN_L)));
            setRot('RightForeArm', qa(X.clone().applyQuaternion(qa(Z, -DOWN_R)), o.foreF));
            setRot('LeftForeArm',  qa(X.clone().applyQuaternion(qa(Z,  DOWN_L)), o.foreB));
            setRot('Spine', qa(X, o.sway * 0.8));
            if (info.Neck){ setRot('Neck', qa(X, o.head * 0.4)); setRot('Head', qa(X, o.head * 0.6)); } else setRot('Head', qa(X, o.head));
            const hp = hipsParentInv.clone(); // hips lowered by `bob` (feet stay planted via bent knees)
            hips.position.copy(hipsRestWorld.clone().add(new THREE.Vector3(0, -o.bob * UNIT, 0)).applyMatrix4(hp));
            pivot.position.y = -o.jump * UNIT;
            glasses.forEach(g => g.visible = o.face !== false);
            cup.visible = !!o.cup;
            shadesSpin.visible = !!o.hand; shadesSpin.rotation.z = d2r(o.spin || 0);
            renderer.render(scene, cam);
          },
          dispose(){ try { renderer.dispose(); renderer.forceContextLoss(); } catch(e){} },
        };
        resolve(api);
      }, err => reject(err));
    });
  };
})();
