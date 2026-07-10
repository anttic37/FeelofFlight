# flighfeel

Third-person flight *feel* proof of concept in Three.js. No build step — plain ES modules,
Three.js from CDN. The whole point: see the plane move in the air and feel it fly.

## Run

Any static file server pointed at this folder, e.g. the preconfigured launch config
(`.claude/launch.json` → `flighfeel`, port 5601), then open `http://localhost:5601/`.

## Controls

| Input | Action |
|---|---|
| `W`/`S` or `↑`/`↓` | pitch — `S`/`↓` pulls up, flight-sim style (press `I` to invert) |
| `A`/`D` or `←`/`→` | roll |
| `Q`/`E` | rudder |
| `X` / `Z` (or `Shift`) | throttle up / down |
| `R` | reset | 
| `M` | mute |
| Gamepad | left stick = pitch/roll (stick back = pull up), triggers = throttle, bumpers = rudder |

## What makes the "feel" (and where to tune it)

- **Spring chase camera** — [src/camera.js](src/camera.js). The lag between plane and camera
  is deliberate; stiffness `k`, roll-follow mix, and speed→FOV live here.
- **Arcade-sim physics** — [src/physics.js](src/physics.js). Four forces (thrust, drag,
  lift-from-AoA, gravity) + surface torques with stability and damping. Stall emerges from
  the lift curve; the stall break drops the nose. All the knobs are named fields at the top.
- **Stick → surface → airframe chain** — inputs are smoothed ([src/input.js](src/input.js)),
  drive visible aileron/elevator/rudder deflection ([src/plane.js](src/plane.js)), and the
  airframe's angular inertia does the rest.
- **Living air** — fbm turbulence torques + vertical gusts (physics.js), stall buffet
  camera shake, wind/engine synth audio ([src/sound.js](src/sound.js)).
- **Wingtip trails** — [src/trails.js](src/trails.js), driven by G-load / near-stall AoA.
- **Speed cues** — procedural island, trees, clouds to punch through, plane ground shadow
  ([src/world.js](src/world.js)).

## Flight numbers

Stall ≈ 100 km/h, cruise ≈ 200–230 km/h, max ≈ 360 km/h in level flight. Hands-off the
plane roughly trims itself (gentle phugoid). Max pull ≈ 3.3 g at cruise. Crashing resets.
