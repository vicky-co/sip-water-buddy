# Adding your own hero, pet or sounds

Use **Settings → Characters** (*Add a 3D avatar…*, *Add a 3D pet…*) or **Settings → Sounds → Add a sound…**. Files are validated, copied into Sip's own
folder, and selected right away. Remove them again with the **Remove** button next to each one.

## 3D avatar (hero)
- Format: **`.glb`** (glTF 2.0 binary), up to 150 MB (a few MB is plenty).
- A rigged **humanoid** whose skeleton uses the common names: `Hips, Spine, (Neck), Head, LeftArm, LeftForeArm, RightArm, RightForeArm, RightHand, LeftUpLeg, LeftLeg, RightUpLeg, RightLeg`.
  A `mixamorig:` prefix is accepted, so Mixamo, Avaturn and Ready Player Me exports work. T-pose and A-pose rigs are both handled.
- Size is normalised automatically. A mesh whose name contains `glasses` is hidden during the shades-off move.
- If the file has an animation clip, the first one is offered as a bonus move.

## 3D pet
- Format: **`.glb`**. Any animal or creature, facing roughly along +Z (use *Face the other way* if it walks backwards).
- With a **skeleton and clips** named like `Idle`, `Walk`, `Run` (also `Sit`, `Jump`, `Lie`), Sip uses them and matches playback speed to how fast the pet moves.
  Bones named like the built-in Golden Retriever (`f_upper_L`, `h_thigh_R`, `spine`, `neck`, `head`, `tail1`, …) additionally get bone-level poses for tricks.
- **Without a skeleton**, Sip automatically finds the four legs, head and tail and animates them.
- Tip: shrink models for a desktop pet; a few MB and 512-1024 px textures look the same at this size ([gltfpack](https://meshoptimizer.org/gltf/) helps).

## Sounds
`.mp3`, `.wav` or `.ogg`, up to 10 MB. The pet plays the whole clip for a "double bark" and the first ~0.6 s for a single one, so short clips work best.

## Where files go
Linux `~/.config/sip-water-buddy/{avatars,pets,barks}/`, Windows `%APPDATA%\sip-water-buddy\{avatars,pets,barks}\`.

## Contributing a built-in look
Open a pull request that adds the file under `assets/`, registers it in `src/main/main.js` (`BUILTIN`) and `src/shared/core.js` if it needs a new id,
and adds a row to `assets/README.md` with the **source, author and licence**. Only submit models or sounds you have the right to share under
terms compatible with redistribution, and never anything depicting a real person's likeness.
