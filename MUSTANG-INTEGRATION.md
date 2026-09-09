# Blender Mustang in flighfeel

The game now loads the **0.9.0 Blender Mustang**. The editable source remains in
`C:/Users/antti/Claude projects/plane 3d/blender-mustang`; this game contains only
the exported runtime asset, its animation adapter and game-specific bindings.

## Runtime files

- `assets/mustang/P51D_Mustang.glb`: geometry, PBR textures, 11 clips, wing and hose morphs, embedded version/rig metadata.
- `assets/mustang/mustang.js`: canonical visual animation adapter.
- `assets/mustang/flight-motion.js`: deterministic secondary movement.
- `assets/mustang/asset-manifest.json`: readable copy of the model contract.
- `src/mustang-game.js`: flighfeel bindings for trails, coherent breakaway assemblies and model-measured ground contact.

`src/main.js` awaits `loadPlane()` before constructing the simulation. A loading
failure remains visible on the preparation screen; it does not silently substitute
an older aircraft. The game uses Three.js 0.164.1, matching the asset viewer.

## Ownership and inputs

The original flight model still owns position, orientation, mass, lift, drag and
control forces. `plane.group` is the physics/camera root. Only its `visualRoot`
child shakes. Model animation is not a second flight-physics simulation.

The existing `rollSm`, `pitchSm`, `yawSm`, `wingFlexSm`, `physics.flapTransit`,
throttle and airspeed are connected to the adapter. Existing `gearTransit` means
**0 up / 1 down**; the adapter converts it to its own **0 down / 1 up** convention.
Wing lift-load bending remains driven by the game's existing G-load calculation;
the new profile's endpoints are +0.44 m and -0.24 m at the tips.

Secondary motion is on by default. Add `?motion=off` (or `&motion=off` if a query
already exists) to disable it without changing physics. Existing pause/free-camera
controls stop model animation. Wingtip trail anchors follow the actual morphed
wing geometry, not unbent marker positions.
Camera controls now use three exterior views: Chase, Close and Wing side (V to
cycle, or the on-screen buttons). Close keeps its drag-orbit angle; Wing side sits
aft of the starboard wing and looks toward the aircraft. Wheel or +/− changes
distance in all three views, and Reframe restores the selected view. The cockpit
view is removed. B still provides free camera movement with simulation paused.

Camera follow now transports the eye and aim with the aircraft's translation,
then damps only their relative offset. Orbit transitions follow a bounded spherical
arc rather than cutting through the model. Close zoom reduces chase shake and
acceleration/G-load tugs, and raises the follow response even in Loose/Floaty mode.
The horizon uses a transported up vector with rate-limited roll recovery, avoiding
inverted/vertical up-vector flips. Ground avoidance preserves the aircraft clearance
radius, and pointer capture/lost-button handling prevents stuck orbit drags.

Camera regression coverage includes moving bank turns, rolls, loops and stall
recovery, all three views and four chase-feel settings, close/variable zoom plus
mouse orbit, V/C/B transitions, and 30/60/144 Hz updates. Browser checks also combine
real held flight keys, mouse drag and scroll with the unchanged flight simulation.

## Landing, damage and reset

`FlightModel.configureAirframe(plane.groundContact)` sets the runway stance from
compact support points measured from the tires. Only geometric ground clearance is changed; aerodynamic
tuning is preserved. This remains the game's simplified ground model, not a new
multi-wheel suspension solver.

The bridge also compensates a small inherited aft-datum stretch on the spinning
tail tire/hub: the exported wheel's fore/aft diameter was about 4.2% larger than
its vertical diameter. It normalizes those rolling surfaces about their existing
spindle before measuring contact, avoiding a periodic tire dip as the wheel turns.
The canonical GLB and Blender source are unchanged by this game-import correction.

The bridge supplies `collisionParts` and `breakawayParts` as object references.
Collision bounds use the current morph pose and ignore detached assemblies.
Crashes freeze animation, so the mixer cannot pull debris back onto the aircraft.
R and T restore assemblies before applying the new flight/runway pose.
The fuselage capsule is measured from the monocoque alone; canopy and radiator
use separate short colliders. Open gear doors and small fittings cannot inflate
the body's full-length collision hull.

Do not pass this GLB through the old `mergeStaticPlaneMeshes()` function. Its
procedural-rig assumptions can remove clip targets or detach morphing details.
The previous procedural source is preserved in Git/the project but is no longer
the default imported aircraft.

## Updating the asset

Rebuild the canonical Blender project, then copy the GLB, manifest and both
canonical JavaScript modules together. Keep the game bridge and rerun integration
tests: new component names or a changed hierarchy may need binding updates.
The `.blend` file is not needed by the game and is not copied here.

This is the detailed hero asset (~33 MB). Production LODs, multiplayer instancing,
texture compression and more elaborate damage/collision models remain separate
optimization work. Profile the full game before applying any geometry merger.

Launch the game with its existing `fly.bat`. G toggles gear, F cycles flaps,
T places the aircraft on a runway, R resets in flight, and V cycles camera views.

## Verification notes

Regression coverage includes authored rig transform/morph parity after grouping,
asymmetric wing-tip tracking, control travel, both crash solvers, R/T restoration,
rounded tire contact, and a runway takeoff. Legacy and configured airborne
trajectories match the original flight physics in the deterministic comparison.
The existing cloud renderer emits Chromium framebuffer/derivative warnings in
both the original and updated game; this integration does not modify that system.
