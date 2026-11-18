export const MODELS = [
  { id:'female', label:'Female base', short:'F', detail:'6.8 heads', path:'figures/base_female.vrm' },
  { id:'male', label:'Male base', short:'M', detail:'7.2 heads', path:'figures/base_male.vrm' },
  { id:'chibi', label:'Chibi base', short:'C', detail:'2.8 heads', path:'figures/base_chibi.vrm' },
];
export const SHAPES=['bust','waist','hips','thighs','arms'];
export const SHAPE_PRESETS={
  'Default':[0,0,0,0,0], 'Glamour':[.74,-.46,.48,.18,-.1], 'Thicc Curve':[.66,-.08,.89,.87,.26],
  'Petite':[-.43,-.37,-.22,-.29,-.32], 'Athletic':[-.08,-.19,.1,.48,.65],
};
export const FINGERS=['Thumb','Index','Middle','Ring','Little'];
export const SEGMENTS=['Proximal','Intermediate','Distal'];
export const SIDES=['left','right'];
export const HAND_PRESETS={ Relaxed:[.18,.17,.19,.23,.27], Open:[0,0,0,0,0], Fist:[.72,1,1,1,1], Peace:[.62,0,0,.92,.94], Point:[.61,0,.91,.94,.92], Grip:[.48,.63,.67,.72,.79] };
export const GROUPS={
  Body:['hips','spine','chest','upperChest','neck','head'],
  Arms:SIDES.flatMap(side=>['Shoulder','UpperArm','LowerArm','Hand'].map(k=>side+k)),
  Legs:SIDES.flatMap(side=>['UpperLeg','LowerLeg','Foot','Toes'].map(k=>side+k)),
  Fingers:SIDES.flatMap(side=>FINGERS.flatMap(f=>SEGMENTS.map(s=>side+f+s))),
};
export const BONES=Object.values(GROUPS).flat();
export const CHAINS=Object.fromEntries(SIDES.flatMap(side=>[
  [side+'Hand',[side+'UpperArm',side+'LowerArm',side+'Hand']],
  [side+'Foot',[side+'UpperLeg',side+'LowerLeg',side+'Foot']],
]));
export const BONE_LABEL = k => k.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,s=>s.toUpperCase());
// Euler deltas in degrees on the normalized (+Z-forward) Koma rig.
export const POSE_PRESETS={
  'Neutral': { category:'Action / Cute', desc:'Base artist stance', rotations:{} },
  'Action stance': { category:'Action / Cute', desc:'Wide, guarded stance', rotations:{hips:[0,-16,-4],spine:[4,8,4],head:[-4,14,-2],leftUpperArm:[-18,-19,-12],leftLowerArm:[-60,0,-19],rightUpperArm:[-28,20,18],rightLowerArm:[-50,0,24],leftUpperLeg:[-13,0,11],leftLowerLeg:[24,0,0],rightUpperLeg:[13,0,-14],rightLowerLeg:[12,0,0]},height:-.07, hands:'Fist' },
  'Hello!': { category:'Action / Cute', desc:'Casual wave', rotations:{hips:[0,4,-4],spine:[-3,0,4],head:[2,-10,-9],leftUpperArm:[4,1,27],leftLowerArm:[-27,-10,85],leftHand:[-4,0,7],rightUpperArm:[-1,0,8],rightLowerArm:[-9,0,-6],rightUpperLeg:[-4,7,-5]},hands:'Relaxed' },
  'Running start': { category:'Action / Cute', desc:'Motion with a long stride', rotations:{hips:[18,-10,2],spine:[5,18,-3],head:[-16,-8,2],leftUpperArm:[35,0,13],leftLowerArm:[-75,0,-8],rightUpperArm:[-29,0,-12],rightLowerArm:[-58,0,13],leftUpperLeg:[-53,0,6],leftLowerLeg:[70,0,0],rightUpperLeg:[29,0,-7],rightLowerLeg:[58,0,0]},height:.05,hands:'Grip' },
  'Editorial contrapposto': { category:'Pinup / Glamour', desc:'Weight on one leg, hand on hip', rotations:{hips:[0,-9,-7],spine:[-4,7,11],chest:[0,-4,-3],head:[4,10,7],leftUpperArm:[-3,11,15],leftLowerArm:[-10,-15,-74],leftHand:[3,0,14],rightUpperArm:[-2,4,12],rightLowerArm:[-8,0,-7],leftUpperLeg:[4,0,8],leftLowerLeg:[10,0,0],rightUpperLeg:[-7,-5,4],rightLowerLeg:[14,0,0]},height:-.024,hands:'Relaxed' },
  'Over the shoulder': { category:'Pinup / Glamour', desc:'Turned torso, looking back', rotations:{hips:[0,31,-4],spine:[-3,12,8],chest:[4,-22,-3],head:[-1,-54,8],leftUpperArm:[-10,4,-15],leftLowerArm:[-23,0,-27],rightUpperArm:[-2,9,3],rightLowerArm:[-13,0,8],leftUpperLeg:[-7,0,-3],rightUpperLeg:[5,0,-7],rightLowerLeg:[15,0,0]},height:-.016,hands:'Relaxed' },
  'Runway': { category:'Pinup / Glamour', desc:'Long line and a slight turn', rotations:{hips:[-5,-6,5],spine:[5,9,-9],head:[-6,-11,7],leftUpperArm:[8,0,-1],leftLowerArm:[-10,0,-12],rightUpperArm:[-8,0,13],rightLowerArm:[-36,0,29],leftUpperLeg:[-13,7,-12],leftLowerLeg:[16,0,0],rightUpperLeg:[6,-8,2]},height:-.01,hands:'Relaxed' },
};
export const DEFAULT_LIGHT={ material:'clay', azimuth:-32, elevation:53, fov:31, backdrop:'studio' };
export const initialPose=() => ({ version:1, model:'female', rotations:{}, offsets:{}, shape:Object.fromEntries(SHAPES.map(k=>[k,0])), light:{...DEFAULT_LIGHT} });
const limit=(n,a,b)=>typeof n==='number'&&Number.isFinite(n)?Math.max(a,Math.min(b,n)):0;
export function validatePose(input, modelFromFile) {
  if(!input || input.version!==1 || !input.rotations || typeof input.rotations!=='object') throw new Error('Not a KomaStudio pose file (version 1)');
  const d=initialPose();
  d.model=modelFromFile || (typeof input.model==='string'&&(MODELS.some(m=>m.id===input.model)||/^custom-[a-z0-9-]+$/.test(input.model))?input.model:'female');
  for(const k of BONES) {
    if(Array.isArray(input.rotations[k])&&input.rotations[k].length===4) {
      const q=input.rotations[k].map(n=>limit(n,-1,1));if(Math.hypot(...q)>.001)d.rotations[k]=q;
    }
    if(Array.isArray(input.offsets?.[k])&&input.offsets[k].length===3)d.offsets[k]=input.offsets[k].map(n=>limit(n,-2,2));
  }
  for(const k of SHAPES)d.shape[k]=limit(input.shape?.[k],-1,1);
  const l=input.light||{};
  d.light={material:l.material==='skin'?'skin':'clay',azimuth:Number.isFinite(l.azimuth)?limit(l.azimuth,-180,180):-32,elevation:Number.isFinite(l.elevation)?limit(l.elevation,0,90):53,fov:Number.isFinite(l.fov)?limit(l.fov,16,75):31, backdrop:'studio'};
  if(input.camera?.position?.length===3&&input.camera?.target?.length===3){d.camera={position:input.camera.position.map(n=>limit(n,-100,100)),target:input.camera.target.map(n=>limit(n,-100,100))};}
  return d;
}
export function mirrorPhoto(data) {
  const swap=[0,4,5,6,1,2,3,8,7,10,9,12,11,14,13,16,15,18,17,20,19,22,21,24,23,26,25,28,27,30,29,32,31];
  const flip=(p,w)=>({...p,x:(w?0:1)-p.x});
  const flipList=(arr,w)=>arr.map(p=>flip(p,w));
  return { image:data.image, pose:swap.map(i=>flip(data.pose[i],false)), world:swap.map(i=>flip(data.world[i],true)), hands:data.hands.map(h=>({...h,side:h.side==='left'?'right':'left',points:flipList(h.points,false),world:flipList(h.world,true)})) };
}
