import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { asset, canvas, imageFrom } from '../storage';
let tasks;

async function initialize() {
  const fs = await FilesetResolver.forVisionTasks(new URL(asset('vision/wasm'), document.baseURI).href);
  const options = file => ({ runningMode:'IMAGE', baseOptions:{ modelAssetPath:asset(`vision/${file}.task`), delegate:'CPU' } });
  const pose = await PoseLandmarker.createFromOptions(fs, { ...options('pose_landmarker_lite'), numPoses:1, minPoseDetectionConfidence:.42, minPosePresenceConfidence:.42 });
  try {
    const hands = await HandLandmarker.createFromOptions(fs, { ...options('hand_landmarker'), numHands:2, minHandDetectionConfidence:.38, minHandPresenceConfidence:.42 });
    return {pose,hands};
  } catch (e) { pose.close(); throw e; }
}
export async function detectPhoto(blob, onStatus) {
  const bitmap=await imageFrom(blob),s=Math.min(1,960/Math.max(bitmap.width,bitmap.height));
  const image=canvas(Math.max(1,Math.round(bitmap.width*s)),Math.max(1,Math.round(bitmap.height*s)));
  image.getContext('2d').drawImage(bitmap,0,0,image.width,image.height);bitmap.close?.();
  onStatus?.('Loading on-device models…');
  tasks??=initialize().catch(e=>{tasks=null;throw e;});
  const {pose,hands}=await tasks;
  onStatus?.('Finding body and hand landmarks…');
  // Let the modal paint its progress before the one-shot CPU inference.
  await new Promise(resolve=>setTimeout(resolve,30));
  const P=pose.detect(image);
  if(!P.landmarks[0]?.length||!P.worldLandmarks[0]?.length)throw new Error('No full-body pose found. Try a brighter image with the head and legs visible.');
  const H=hands.detect(image), body=P.landmarks[0];
  const entries=H.landmarks.map((points,i)=>{
    const w=points[0],dl=Math.hypot(body[15].x-w.x,body[15].y-w.y),dr=Math.hypot(body[16].x-w.x,body[16].y-w.y);
    const info=(H.handedness||H.handednesses)?.[i]?.[0]?.categoryName?.toLowerCase();
    return {side: Math.abs(dl-dr)<.035 ? (info==='left'?'left':'right') : dl<dr?'left':'right', points, world:H.worldLandmarks[i]||points, dist:Math.min(dl,dr)};
  }).sort((a,b)=>a.dist-b.dist);
  const resolved=entries.filter((h,i)=>!entries.slice(0,i).some(other=>other.side===h.side));
  return {image,pose:body,world:P.worldLandmarks[0],hands:resolved};
}
export const POSE_LINKS=[[0,2],[0,5],[2,7],[5,8],[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[24,26],[26,28],[28,30],[30,32]];
export const HAND_LINKS=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
export function renderPreview(surface, data, showHands, mirror) {
  surface.width=data.image.width;surface.height=data.image.height;
  const c=surface.getContext('2d'),w=surface.width,h=surface.height;
  if(mirror){c.translate(w,0);c.scale(-1,1);}
  c.drawImage(data.image,0,0);c.fillStyle='#100d1d34';c.fillRect(0,0,w,h);
  c.lineJoin='round';c.lineCap='round';
  function skeleton(points, links, color, radius, checkVisibility=true){
    const pt=p=>[p.x*w,p.y*h],visible=p=>p&&(!checkVisibility||(p.visibility??1)>.35);
    c.beginPath();for(const [a,b] of links){const x=points[a],y=points[b];if(visible(x)&&visible(y)){c.moveTo(...pt(x));c.lineTo(...pt(y));}}
    c.lineWidth=radius*2.4;c.strokeStyle='#161121a0';c.stroke();c.lineWidth=radius*1.4;c.strokeStyle=color;c.stroke();
    for(const i of new Set(links.flat())) if(visible(points[i])){c.beginPath();c.arc(...pt(points[i]),radius,0,Math.PI*2);c.fillStyle=color;c.fill();c.lineWidth=radius*.37;c.strokeStyle='#29213a';c.stroke();}
  }
  const s=Math.max(w,h)/310;
  skeleton(data.pose,POSE_LINKS,'#cfafff',s*2);
  if(showHands)for(const h of data.hands)skeleton(h.points,HAND_LINKS,'#96f0d0',s*1.45,false);
}
