/** Deterministic, visual-only flight life. No physics forces or random-per-frame noise.
 * Inputs are normalized except airspeed (m/s); every effect is opt-in through
 * flightMotion. An explicit flightTime (seconds) permits pause/replay/scrubbing.
 * The supplied amplitudes are an artistic game envelope, not airworthiness data.
 */
export const FLIGHT_MOTION_VERSION='p51d-flight-life/1';
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(x)?x:0));
const wave=(t,hz,phase=0)=>Math.sin(t*Math.PI*2*hz+phase);
const mix=(t,a,b,phase=0)=>(wave(t,a,phase)+.37*wave(t,b,phase+1.73))/1.37;
export function evaluateFlightMotion(state,time){
 const t=clamp(time,0,1e9); // Also bounds malformed enormous replay timestamps.
 const master=clamp(state.flightMotion),air=clamp(state.airspeed/90);
 const engine=master*clamp(state.engineVibration)*clamp(state.throttle);
 const gust=master*clamp(state.turbulence)*air;
 const detail=master*clamp(state.controlVibration)*air;
 const hz=8+10*clamp(state.throttle);
 const enginePulse=mix(t,hz,hz*1.47),buffet=mix(t,.73,1.31,.4);
 // Bound position to a few millimetres of engine buzz and 12 mm of buffeting.
 const position=[.0012*engine*enginePulse+.006*gust*mix(t,.57,1.1),
  .0015*engine*mix(t,hz*.91,hz*1.37,.8)+.012*gust*buffet,
  .0006*engine*mix(t,hz*1.13,hz*1.59,1.7)];
 const rotation=[.0012*engine*enginePulse+.0035*gust*mix(t,.61,1.24),
  .0007*engine*mix(t,hz*.97,hz*1.2,.5)+.002*gust*mix(t,.43,.91,2),
  .0010*engine*mix(t,hz*1.07,hz*1.51)+.006*gust*mix(t,.52,1.08,.7)];
 // Low-frequency bending, distinct from the much faster engine vibration.
 // Left/right share the main load but retain small phase differences.
 const shared=.18*gust*mix(t,1.12,2.31,.6);
 const wings={port:shared+.045*gust*mix(t,2.45,3.71,.2),
  starboard:shared+.045*gust*mix(t,2.19,3.47,1.7)};
 const aileron=.28*detail*mix(t,6.7,9.1,.6);
 const controls={aileronPort:aileron,aileronStarboard:-.83*aileron,
  elevator:.14*detail*mix(t,5.8,8.3,1.8),rudder:.18*detail*mix(t,4.7,7.3,.8),
  radiator:.22*engine*clamp(state.radiator)*mix(t,hz*.67,hz,.2)};
 // Existing brake-hose free loops move only with gear fully deployed. Fade
 // out from 2% to 10% of retraction; both ends and clamps are fixed morph
 // stations. This is not a disconnected spring or a suspension simulation.
 const gate=1-clamp((state.gear-.02)/.08),deployed=gate*gate*(3-2*gate);
 const hose=clamp(deployed*(.3*engine*mix(t,hz*.7,hz,1.1)+
  master*air*(.22*mix(t,3.4,5.2,.7)+clamp(state.turbulence)*.65*mix(t,2.1,4.8,1.3))),-1,1);
 return {version:FLIGHT_MOTION_VERSION,position,rotation,wings,controls,hose,engine,gust,air};
}
