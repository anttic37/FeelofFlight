# flighfeel

Third-person flight *feel* game in Three.js. No build step — plain ES modules,
Three.js from CDN. The whole point: see the plane move in the air and feel it fly.
Now with retractable gear, three landing strips, full landing/takeoff physics,
shader water with shore foam, puffy cumulus, and a minimap.

## Run

Double-click `fly.bat`, or start the launch config (`.claude/launch.json` →
`flighfeel`, port 5601) and open `http://localhost:5601/`.

## Controls

| Input | Action |
|---|---|
| `W`/`S` or `↑`/`↓` | pitch — `S`/`↓` pulls up, flight-sim style (press `I` to invert) |
| `A`/`D` or `←`/`→` | roll |
| `Q`/`E` | rudder (steers the tailwheel on the ground) |
| `X` / `Z` (or `Shift`) | throttle up / down |
| `G` | landing gear up/down |
| `Space` | wheel brakes |
| `T` | spawn parked on runway 1, ready for takeoff |
| `R` | reset to air spawn |
| `M` | mute |
| Gamepad | left stick = pitch/roll (stick back = pull up), triggers = throttle, bumpers = rudder, A = brake, Y = gear |

## Flying it

- **Takeoff** (`T` first): full throttle, hold `S` — it rotates and lifts off around 100 km/h.
- **Landing**: gear down (`G`) below ~200 km/h, aim for a strip (check the minimap),
  touch down gently (< 6 m/s sink), wings level, then `Space` to brake. Grass works
  too if you're gentle — expect drag. Belly landings, hard slams, high-speed or
  banked touchdowns and water all end the flight, with the reason on screen.
- Runways: 1 — main coastal strip dead ahead of the air spawn; 2 — short mountain
  plateau strip (elev 70 m); 3 — small angled coastal shelf.

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
