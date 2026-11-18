import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { BONES, CHAINS, FINGERS, SEGMENTS, SIDES, mirrorPhoto } from './data';
const v=(...args)=>new Vector3(...args), q=()=>new Quaternion();
const rad=Math.PI/180, degrees=180/Math.PI;
const between=(a,b)=>new Vector3().subVectors(b,a);
const centered=(a,b)=>new Vector3().addVectors(a,b).multiplyScalar(.5);
const H=(side,name)=>side+name;
export const worldPos = bone => bone?.getWorldPosition(v());
export const counterpart = name => name?.startsWith('left') ? `right${name.slice(4)}` : name?.startsWith('right') ? `left${name.slice(5)}` : null;
const reflectQ = quat => new Quaternion(quat.x,-quat.y,-quat.z,quat.w);

const mixamo={leftUpperArm:'leftarm',rightUpperArm:'rightarm',leftLowerArm:'leftforearm',rightLowerArm:'rightforearm',leftUpperLeg:'leftupleg',rightUpperLeg:'rightupleg',leftLowerLeg:'leftleg',rightLowerLeg:'rightleg',leftToes:'lefttoebase',rightToes:'righttoebase',chest:'spine1',upperChest:'spine2'};
for(const side of SIDES)for(const finger of FINGERS)for(const [i,part] of SEGMENTS.entries())mixamo[side+finger+part]=`${side}hand${finger.toLowerCase()==='little'?'pinky':finger.toLowerCase()}${i+1}`;

export class FigureRig {
  constructor(gltf, scene) {
    this.vrm=gltf.userData.vrm;this.scene=scene;this.bones={};this.rest={};
    if(this.vrm) {
      const h=this.vrm.humanoid;
      for(const name of BONES) {
        let k=name;
        if(h.getNormalizedBoneNode(name.replace(/Thumb\w+/,'ThumbMetacarpal'))) {
          if(name.endsWith('ThumbProximal'))k=name.replace('Proximal','Metacarpal');
          if(name.endsWith('ThumbIntermediate'))k=name.replace('Intermediate','Proximal');
        }
        this.bones[name]=h.getNormalizedBoneNode(k);
      }
    } else {
      const names=new Map();scene.traverse(n=>{if(n.isBone)names.set(n.name.toLowerCase().replace(/^mixamorig\d*:?/,'').replace(/[^a-z0-9]/g,''),n);});
      for(const name of BONES)this.bones[name]=names.get(name.toLowerCase())||names.get(mixamo[name]);
    }
    scene.updateMatrixWorld(true);
    for(const [name,bone] of Object.entries(this.bones))if(bone)this.rest[name]={local:bone.quaternion.clone(),pos:bone.position.clone(),parent:bone.parent.getWorldQuaternion(q()),parentScale:bone.parent.getWorldScale(v())};
  }
  bone(name){return this.bones[name];}
  reset() {
    this.vrm?.humanoid.resetRawPose();this.vrm?.humanoid.resetNormalizedPose();
    for(const [name,r] of Object.entries(this.rest)){const n=this.bone(name);n.quaternion.copy(r.local);n.position.copy(r.pos);}
    this.update();
  }
  update() {this.scene.updateMatrixWorld(true);this.vrm?.humanoid.update();this.scene.updateMatrixWorld(true);}
  readQuat(name) {
    const r=this.rest[name], b=this.bone(name);
    return r ? r.parent.clone().multiply(b.quaternion).multiply(r.local.clone().invert()).multiply(r.parent.clone().invert()).normalize() : q();
  }
  writeQuat(name, quat, mirror=false) {
    const r=this.rest[name];if(!r)return;
    this.bone(name).quaternion.copy(r.parent).invert().multiply(quat).multiply(r.parent).multiply(r.local).normalize();
    if(mirror){const buddy=counterpart(name);if(buddy)this.writeQuat(buddy,reflectQ(quat),false);}
  }
  angles(name){return new Euler().setFromQuaternion(this.readQuat(name),'XYZ').toArray().slice(0,3).map(v=>Math.round(v*degrees));}
  setAngles(name,angles,mirror){this.writeQuat(name,q().setFromEuler(new Euler(...angles.map(a=>a*rad),'XYZ')),mirror);}
  offset(name) {
    const r=this.rest[name];return r ? this.bone(name).position.clone().sub(r.pos).multiply(r.parentScale).applyQuaternion(r.parent) : v();
  }
  setOffset(name, world) {
    const r=this.rest[name];if(r)this.bone(name).position.copy(r.pos).add(world.clone().applyQuaternion(r.parent.clone().invert()).divide(r.parentScale));
  }
  mirror(name) {const key=counterpart(name);if(key)this.writeQuat(key,reflectQ(this.readQuat(name)));}
  serialize() {
    const rotations={},offsets={};
    for(const name of Object.keys(this.rest)) {
      const p=this.offset(name),qq=this.readQuat(name);
      if(Math.abs(qq.w)<.999999)rotations[name]=qq.toArray();
      if(p.lengthSq()>1e-10)offsets[name]=p.toArray();
    }
    return {rotations,offsets};
  }
  apply(data) {
    this.reset();
    for(const [n,val] of Object.entries(data.rotations||{}))this.writeQuat(n,q().fromArray(val).normalize());
    for(const [n,val] of Object.entries(data.offsets||{}))if(n==='hips'||!this.vrm)this.setOffset(n,v(...val));
    this.update();
  }
  worldTurn(name,delta) {
    const bone=this.bone(name);if(!bone)return;
    const parent=bone.parent.getWorldQuaternion(q());
    bone.quaternion.premultiply(parent.clone().invert().multiply(delta).multiply(parent)).normalize();
    this.scene.updateMatrixWorld(true);
  }
  aim(name,child,desired) {
    const a=worldPos(this.bone(name)), b=worldPos(this.bone(child));
    if(!a||!b||desired.lengthSq()<1e-8)return;
    const from=between(a,b).normalize();if(from.lengthSq()>.99)this.worldTurn(name,q().setFromUnitVectors(from,desired.clone().normalize()));
  }
  frame(name,targetX,targetY,amount=1) {
    const b=this.bone(name);if(!b||targetX.lengthSq()<1e-8||targetY.lengthSq()<1e-8)return;
    // Compute the change relative to the rig's current canonical axes, irrespective of VRM import version.
    const r=this.rest[name],world=b.getWorldQuaternion(q()), base=r.parent.clone().multiply(r.local);
    const current=world.multiply(base.invert());
    const Y=targetY.clone().normalize(),Z=targetX.clone().cross(Y).normalize();if(Z.lengthSq()<.5)return;
    const X=Y.clone().cross(Z).normalize();
    const target=q().setFromRotationMatrix(new Matrix4().makeBasis(X,Y,Z));
    this.worldTurn(name,q().slerp(target.multiply(current.invert()),amount));
  }
  limb(key,target,pole) {
    const chain=CHAINS[key];if(!chain)return false;
    const [a,b,c]=chain.map(n=>worldPos(this.bone(n)));if(!c||!b||!a)return false;
    const ab=a.distanceTo(b),bc=b.distanceTo(c),at=between(a,target);
    const d=Math.min(ab+bc-.0001,Math.max(Math.abs(ab-bc)+.0001,at.length()));
    if(d<=0||at.lengthSq()<1e-9)return false;
    const axis=at.normalize();let dir=between(a,pole||b);dir.addScaledVector(axis,-dir.dot(axis));
    if(dir.lengthSq()<1e-5){dir=v(0,0,1).addScaledVector(axis,-axis.z);if(dir.lengthSq()<1e-5)dir=v(0,1,0).addScaledVector(axis,-axis.y);}
    const along=(ab*ab-bc*bc+d*d)/(2*d),rise=Math.sqrt(Math.max(0,ab*ab-along*along));
    const elbow=a.clone().addScaledVector(axis,along).addScaledVector(dir.normalize(),rise);
    this.aim(chain[0],chain[1],between(a,elbow));
    this.aim(chain[1],chain[2],between(worldPos(this.bone(chain[1])),a.clone().addScaledVector(axis,d)));
    return true;
  }
  curl(side, amounts) {
    const hand=this.bone(H(side,'Hand'));if(!hand)return;
    for(const [fi,f] of FINGERS.entries())for(const [si,s] of SEGMENTS.entries()) {
      const name=side+f+s,r=this.rest[name],b=this.bone(name);if(!r||!b)continue;
      const next=this.rest[side+f+SEGMENTS[Math.min(si+1,2)]];
      const direction=si===2 ? r.pos.clone() : next.pos.clone();
      direction.applyQuaternion(r.parent.clone().multiply(r.local)).normalize();
      if(direction.lengthSq()<.1) direction.set(side==='left'?.4:-.4,-1,0).normalize();
      // Curl toward the palm's front, in the rest frame. Rest orientations handle both VRM 0.x and 1.0.
      const axis=direction.cross(v(0,0,1)).normalize();
      if(axis.lengthSq()<.01)axis.set(-1,0,0);
      const angle=typeof amounts[fi]==='number'?amounts[fi]*[68,89,63][si]*rad:(amounts[fi]?.[si]||0);
      this.writeQuat(name,q().setFromAxisAngle(axis,Math.max(-.2,Math.min(1.66,angle))));
    }
  }
}

const xyz=p=>v(p.x,-p.y,-p.z);
const angle=(a,b,c)=>between(a,b).angleTo(between(b,c));
export function applyPhotoPose(rig, raw, {mirror=false,hands=true}={}) {
  const data=mirror?mirrorPhoto(raw):raw;
  rig.reset();
  const p=data.world.map(xyz), midBody=centered(p[23],p[24]), shoulderMid=centered(p[11],p[12]), faceMid=centered(p[7],p[8]);
  const vis=(...ids)=>ids.every(i=>(data.pose[i]?.visibility??1)>.35);
  const shoulders=between(p[12],p[11]),hipAxis=between(p[24],p[23]),spine=between(midBody,shoulderMid);
  const defaultHip=worldPos(rig.bone('hips'));
  const defaultShoulder=centered(worldPos(rig.bone('leftUpperArm'))||defaultHip,worldPos(rig.bone('rightUpperArm'))||defaultHip);
  const plantHeight=()=>Math.min(...['leftToes','rightToes','leftFoot','rightFoot'].map(k=>worldPos(rig.bone(k))?.y??Infinity));
  const restFootY=plantHeight();
  const torsoLen=Math.max(.15,defaultHip.distanceTo(defaultShoulder));
  const scale=Math.min(3,Math.max(.45,torsoLen/Math.max(.12,spine.length())));
  if(vis(23,24,11,12)) {
    rig.frame('hips',hipAxis,v(spine.x*.33,Math.max(.18,spine.y),spine.z*.46));
    rig.frame('spine',hipAxis.clone().lerp(shoulders,.48),spine,.65);
    rig.frame('chest',shoulders,spine,.82);
  }
  if(vis(0,7,8,11,12)) {
    const x=between(p[8],p[7]);const forward=between(faceMid,p[0]);
    const y=forward.lengthSq()>.001?forward.cross(x).normalize():spine.clone().normalize();
    rig.frame('neck',x,y,.45);rig.frame('head',x,y,.74);
  }
  // Infer how high the pelvis should sit relative to the planted ankle(s); crouches move it down.
  const ground=Math.min(...[27,28,29,30].filter(i=>vis(i)).map(i=>p[i].y));
  if(Number.isFinite(ground)) {
    const restAnkles=['leftFoot','rightFoot'].map(k=>worldPos(rig.bone(k))?.y??.07);
    const baseline=defaultHip.y-Math.min(...restAnkles);
    const hipSpan=Math.min(baseline*1.08,Math.max(baseline*.35,(midBody.y-ground)*scale));
    rig.setOffset('hips',v(0,hipSpan-baseline,0));rig.update();
  }
  const matchLimb=(side,end,a,b,c,toe)=>{
    if(!vis(a,b,c))return;
    const chain=CHAINS[side+end],root=worldPos(rig.bone(chain[0])),joint=worldPos(rig.bone(chain[1])),tip=worldPos(rig.bone(chain[2]));
    if(!root||!joint||!tip)return;
    const model=root.distanceTo(joint)+joint.distanceTo(tip), photo=p[a].distanceTo(p[b])+p[b].distanceTo(p[c]);
    const size=photo>.07?model/photo:scale;
    rig.limb(side+end,root.clone().addScaledVector(between(p[a],p[c]),size),root.clone().addScaledVector(between(p[a],p[b]),size));
    if(toe&&vis(c,toe))rig.aim(side+'Foot',side+'Toes',between(p[c],p[toe]));
  };
  matchLimb('left','Hand',11,13,15);matchLimb('right','Hand',12,14,16);
  matchLimb('left','Foot',23,25,27,31);matchLimb('right','Foot',24,26,28,32);
  if(Number.isFinite(restFootY)&&vis(27,28)) {
    const hips=rig.offset('hips'),adjust=restFootY-plantHeight();
    hips.y+=Math.max(-.22,Math.min(.22,adjust));rig.setOffset('hips',hips);rig.scene.updateMatrixWorld(true);
  }
  if(hands)for(const hand of data.hands) {
    const points=hand.world.map(xyz),side=hand.side;
    const knuckles=centered(points[5],points[17]);
    // Aim the palm and preserve relative finger angles measured at the 21 tracked joints.
    rig.aim(side+'Hand',side+'MiddleProximal',between(points[0],knuckles));
    const curls=FINGERS.map((_,index)=>{
      const s=1+index*4, start=index===0?points[0]:centered(points[0],points[s]);
      return [angle(start,points[s],points[s+1])*.74,angle(points[s],points[s+1],points[s+2]),angle(points[s+1],points[s+2],points[s+3])];
    });
    rig.curl(side,curls);
  }
  rig.update();
}
