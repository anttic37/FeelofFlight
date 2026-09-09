/**
 * P-51D game adapter — p51d-game-rig/1.
 * Metres; +Y up, nose -Z. Await loadPlane(), then add plane.group to the scene.
 * updatePlaneVisual changes visuals ONLY; your game remains owner of physics.
 * Canonical gear input: 0 DOWN, 1 UP. Legacy physics.gearTransit: 1 DOWN, 0 UP.
 * Legacy inputs rollSm/pitchSm/yawSm/wingFlexSm (-1..1), flapSm (0..1) accepted.
 * Unlike old procedural buildPlane(), this loader is ASYNCHRONOUS.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {evaluateFlightMotion,FLIGHT_MOTION_VERSION} from './flight-motion.js';

export const aircraftInfo = {name:'P-51D Mustang',revision:'blender-mustang-0.9.0',
  animationAPI:'p51d-game-rig/1',units:'metres'};
export const aircraftCapabilities = {
  features:{wingFlex:{method:'morph',contract:'blender-gltf-morph/1',revision:2,input:'wingFlex',maxTipRiseMetres:.44,maxTipDropMetres:.24},
    flightLife:{version:FLIGHT_MOTION_VERSION,visualOnly:true,defaultEnabled:false,
      inputs:['flightMotion','engineVibration','turbulence','controlVibration','airspeed','flightTime']},
    flaps:true,ailerons:true,elevators:true,rudder:true,landingGear:true,
    wheelWells:true,gearDoors:true,propeller:true,canopy:true,radiator:true},
  animation:{inputs:{rollSm:{upDeg:15,downDeg:15},pitchSm:{upDeg:30,downDeg:20},
    yawSm:{degrees:30},flapSm:{downDeg:50}}}
};
const clamp=(x,a=-1,b=1)=>Math.max(a,Math.min(b,Number.isFinite(x)?x:0));
const v=a=>new THREE.Vector3().fromArray(a);
const xAxis=new THREE.Vector3(1,0,0);
const rad=THREE.MathUtils.degToRad;
function remapAft(p){p=p.clone();if(p.z>1.86)p.z+=(p.z-1.86)/(4.78-1.86)*.123;return p;}

// Exact morph-endpoint field shared with scripts/surfaces.py.
function bend(p,rise){
  const ax=Math.abs(p.x),span=5.639-.47,start=.47+.18*span,L=5.639-start;
  const s=clamp((ax-start)/L,0,1);if(!s)return p.clone();
  const m=2*rise/L,angle=m*(3*s*s-2*s*s*s);
  const displacement=rise*(2*s**3-s**4);
  const shortening=.5*m*m*L*(1.8*s**5-2*s**6+4/7*s**7);
  const t=clamp((ax-.47)/span,0,1),cy=-.255+(ax-.47)*Math.tan(rad(5))+.010*t*t;
  const dy=p.y-cy,side=p.x<0?-1:1;
  return new THREE.Vector3(side*(ax-shortening-dy*Math.sin(angle)),cy+displacement+dy*Math.cos(angle),p.z);
}
function flexPoint(p,amount,limits){return p.clone().lerp(bend(p,amount>=0?limits.up:limits.down),Math.abs(amount));}

export async function loadPlane(url=new URL('../exports/P51D_Mustang.glb',import.meta.url),onProgress){
  const gltf=await new GLTFLoader().loadAsync(String(url),onProgress);
  // Host game owns group TRS. Flight shake lives on a child so it cannot drift
  // the physics root, camera attachment or navigation transform.
  const visualRoot=gltf.scene,group=new THREE.Group();group.add(visualRoot);
  group.name='P51D_Mustang_Game_Asset';
  const controls=new Map(),flexMeshes=[],lifeMeshes=[],nodes=new Map(),links=[];let manifest;
  group.traverse(node=>{
    nodes.set(node.name,node);
    if(node.userData.name)nodes.set(node.userData.name,node);
    if(node.userData.link_root_node)links.push(node);
    if(node.userData.aircraft_manifest)manifest=JSON.parse(node.userData.aircraft_manifest);
    if(node.userData.control_pivot)controls.set(node.userData.control_id,node);
    if(node.isMesh){
      node.castShadow=true;node.receiveShadow=true;
      let ancestor=node,side;
      while(ancestor&&!side){side=ancestor.userData.wing_flex_side;ancestor=ancestor.parent;}
      if(side&&node.morphTargetDictionary)flexMeshes.push({node,side});
      if(node.userData.flight_life_role&&node.morphTargetDictionary){
        const raw=node.userData.flight_life_keys;
        const keys=typeof raw==='string'?JSON.parse(raw):raw;
        if(!Array.isArray(keys)||keys.length!==2||keys.some(key=>!Number.isInteger(node.morphTargetDictionary[key])))
          throw new Error('Invalid flight-life morph contract on '+node.name);
        lifeMeshes.push({node,keys,role:node.userData.flight_life_role});
      }
    }
  });
  if(manifest?.animation?.version!=='p51d-game-rig/1')throw new Error('This GLB does not contain the required updated game rig. Rebuild the current model.');
  const mixer=new THREE.AnimationMixer(visualRoot),actions=new Map();
  for(const clip of gltf.animations){
    const action=mixer.clipAction(clip);action.paused=true;action.setLoop(THREE.LoopOnce,1);
    // Blender's frame-1 clips retain a first key at 1/30 s. Normalize over
    // the keyed interval, not [0, clip.duration], or lift/slide and mechanical
    // sequencing lag their documented state by as much as 8 mm mid-travel.
    const keyed=clip.tracks.filter(track=>track.times.length);
    const start=keyed.length?Math.min(...keyed.map(track=>track.times[0])):0;
    const end=keyed.length?Math.max(...keyed.map(track=>track.times[track.times.length-1])):clip.duration;
    action.clampWhenFinished=true;action.play();actions.set(clip.name,{action,duration:clip.duration,start,end});
  }
  for(const item of manifest.animation.clips){if(!actions.has(item.name))throw new Error('Missing GLB clip: '+item.name);}
  const byControl=id=>[...nodes.values()].find(n=>n.userData.control_id===id);
  const declaredFlex=manifest.wingFlex?.tipDisplacementMetres;
  if(!Number.isFinite(declaredFlex?.up)||declaredFlex.up<=0||!Number.isFinite(declaredFlex?.down)||declaredFlex.down>=0)
    throw new Error('GLB wing-flex endpoint distances are missing or invalid.');
  const plane={group,visualRoot,gltf,manifest,controls,flexMeshes,lifeMeshes,nodes,mixer,actions,links,
    flexLimits:{up:declaredFlex.up,down:declaredFlex.down},
    visualRest:{position:visualRoot.position.clone(),quaternion:visualRoot.quaternion.clone(),scale:visualRoot.scale.clone()},
    propeller:byControl('propeller_spin'),canopy:byControl('canopy_slide'),
    wheelL:byControl('wheel_port'),wheelR:byControl('wheel_starboard'),tailWheelSpin:byControl('wheel_tail'),
    radiatorDoor:controls.get('radiator'),time:0,wheelAngle:0,tailWheelAngle:0,propAngle:0,
    state:{gear:0,flaps:0,roll:0,pitch:0,yaw:0,wingFlex:0,canopy:0,radiator:.18,throttle:0,speed:0,
      flightMotion:0,engineVibration:.55,turbulence:.35,controlVibration:.4,airspeed:0}};
  updatePlaneVisual(plane,{}, {},0);
  return plane;
}

function sample(plane,name,amount){const c=plane.actions.get(name);if(c){c.action.time=c.start+clamp(amount,0,1)*(c.end-c.start);c.action.enabled=true;}}
function control(plane,id,degrees,flex){
  const node=plane.controls.get(id);if(!node)return;
  const o=v(node.userData.hinge_origin_source),e=v(node.userData.hinge_end_source);
  const flexible=!!node.userData.control_flex_side;
  const bo=remapAft(flexible?flexPoint(o,flex,plane.flexLimits):o),be=remapAft(flexible?flexPoint(e,flex,plane.flexLimits):e),O=remapAft(o);
  const q=new THREE.Quaternion().setFromAxisAngle(be.sub(bo).normalize(),rad(degrees));
  node.quaternion.copy(q);node.position.copy(O.sub(bo).applyQuaternion(q).add(bo));
}

export function updatePlaneVisual(plane,input={},physics={},dt=0){
  dt=clamp(dt,0,.1);plane.time+=dt;
  const s=plane.state;
  for(const key of Object.keys(s)){if(Number.isFinite(input[key]))s[key]=input[key];}
  s.roll=clamp(input.rollSm??s.roll);s.pitch=clamp(input.pitchSm??s.pitch);s.yaw=clamp(input.yawSm??s.yaw);
  s.flaps=clamp(input.flapSm??physics.flapTransit??s.flaps,0,1);
  s.wingFlex=clamp(input.wingFlexSm??s.wingFlex);
  s.gear=clamp(input.gear??(Number.isFinite(physics.gearTransit)?1-physics.gearTransit:s.gear),0,1);
  s.throttle=clamp(physics.throttle??s.throttle,0,1);s.speed=clamp(physics.speed??s.speed,-300,300);
  s.canopy=clamp(s.canopy,0,1);s.radiator=clamp(physics.radiatorDoorSm??s.radiator,0,1);
  for(const key of ['flightMotion','engineVibration','turbulence','controlVibration'])s[key]=clamp(s[key],0,1);
  s.airspeed=clamp(physics.airspeed??physics.speed??s.airspeed,0,250);
  const life=evaluateFlightMotion(s,Number.isFinite(input.flightTime)?input.flightTime:plane.time);
  plane.flightLife=life;
  // Reset from the saved rest transform every frame, never accumulate shake.
  plane.visualRoot.position.copy(plane.visualRest.position).add(v(life.position));
  plane.visualRoot.quaternion.copy(plane.visualRest.quaternion).multiply(
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...life.rotation,'XYZ')));
  plane.visualRoot.scale.copy(plane.visualRest.scale);
  sample(plane,'Gear_Retract',s.gear);sample(plane,'Canopy',s.canopy);
  sample(plane,'Flaps',s.flaps);sample(plane,'Aileron_Port',.5);sample(plane,'Aileron_Starboard',.5);
  sample(plane,'Elevators',.6);sample(plane,'Rudder',.5);sample(plane,'Radiator',s.radiator);
  plane.propAngle=(plane.propAngle+dt*s.throttle*26)%(Math.PI*2);
  plane.wheelAngle=(plane.wheelAngle+dt*s.speed/.343)%(Math.PI*2);
  plane.tailWheelAngle=(plane.tailWheelAngle+dt*s.speed/.159)%(Math.PI*2);
  sample(plane,'Propeller_Spin',plane.propAngle/(Math.PI*2));
  sample(plane,'Wheel_Spin',((plane.wheelAngle/(Math.PI*2))%1+1)%1);
  const centre=1-clamp(s.gear/.18,0,1)**2*(3-2*clamp(s.gear/.18,0,1));
  sample(plane,'Tailwheel_Steer',.5+.5*s.yaw*centre);
  plane.mixer.update(0);
  // The smaller tail tyre must turn faster for the same ground distance.
  if(plane.tailWheelSpin)plane.tailWheelSpin.quaternion.setFromAxisAngle(xAxis,plane.tailWheelAngle);
  const left=clamp(clamp(input.wingFlexPort??s.wingFlex)+life.wings.port),right=clamp(clamp(input.wingFlexStarboard??s.wingFlex)+life.wings.starboard);
  for(const {node,side} of plane.flexMeshes){
    const amount=side==='port'?left:right,d=node.morphTargetDictionary,w=node.morphTargetInfluences;
    w[d.WingFlex_Up]=Math.max(0,amount);w[d.WingFlex_Down]=Math.max(0,-amount);
  }
  control(plane,'flap_port',s.flaps*50,left);control(plane,'flap_starboard',s.flaps*50,right);
  control(plane,'aileron_port',clamp(s.roll*15+life.controls.aileronPort,-15,15),left);
  control(plane,'aileron_starboard',clamp(-s.roll*15+life.controls.aileronStarboard,-15,15),right);
  const elevator=s.pitch>=0?-s.pitch*30:-s.pitch*20;
  control(plane,'elevator_port',clamp(elevator+life.controls.elevator,-30,20),0);
  control(plane,'elevator_starboard',clamp(elevator+life.controls.elevator,-30,20),0);
  control(plane,'rudder',clamp(s.yaw*30+life.controls.rudder,-30,30),0);
  control(plane,'radiator',clamp(s.radiator*24+life.controls.radiator,0,24),0);
  for(const {node,keys,role} of plane.lifeMeshes){
    const d=node.morphTargetDictionary,w=node.morphTargetInfluences;
    const amount=role==='brake-hose-loop'?life.hose:0;
    w[d[keys[0]]]=Math.max(0,amount);w[d[keys[1]]]=Math.max(0,-amount);
  }
  plane.group.updateMatrixWorld(true);
  // These rods span a fixed airframe bearing and a moving steering assembly.
  // Resolve their endpoints AFTER clip sampling to compose steer+retraction.
  for(const link of plane.links){
    const resolve=name=>plane.nodes.get(name)||plane.nodes.get(THREE.PropertyBinding.sanitizeNodeName(name));
    const root=resolve(link.userData.link_root_node),end=resolve(link.userData.link_end_node);
    if(!root||!end)throw new Error('Missing mechanical linkage anchor for '+link.name);
    const a=link.parent.worldToLocal(root.getWorldPosition(new THREE.Vector3()));
    const b=link.parent.worldToLocal(end.getWorldPosition(new THREE.Vector3()));
    const delta=b.sub(a);link.position.copy(a);
    link.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.clone().normalize());
    link.scale.set(1,delta.length()/link.userData.link_rest_length_m,1);
    link.updateMatrixWorld(true);
  }
  return plane;
}

export function disposePlane(plane){
  plane.mixer.stopAllAction();plane.mixer.uncacheRoot(plane.visualRoot);
  const geometries=new Set(),materials=new Set(),textures=new Set();
  plane.group.traverse(n=>{if(n.isMesh){geometries.add(n.geometry);for(const m of Array.isArray(n.material)?n.material:[n.material])materials.add(m);}});
  for(const m of materials){for(const value of Object.values(m))if(value?.isTexture)textures.add(value);m.dispose();}
  for(const g of geometries)g.dispose();for(const t of textures)t.dispose();
  plane.group.removeFromParent();
}
