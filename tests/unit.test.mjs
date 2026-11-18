import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { brushRadius, hsvToRgb, rgbToHsv, scanlineMask, toHex } from '../src/draw/raster.js';
import { FINGERS, MODELS, SHAPES, initialPose, mirrorPhoto, validatePose } from '../src/pose/data.js';

const tile=(w,h,fn)=>Uint8ClampedArray.from(Array.from({length:w*h},(_,i)=>fn(i%w,Math.floor(i/w))).flatMap(n=>[n,n,n,255]));
test('scanline respects connectedness, document borders, and color tolerance',()=>{
  const rgba=tile(8,4,(x,y)=>x===3?245:y===3?31:39);
  const mask=scanlineMask(rgba,8,4,1,0,{tolerance:8,expand:false});
  assert.deepEqual([...mask],[255,255,255,0,0,0,0,0,255,255,255,0,0,0,0,0,255,255,255,0,0,0,0,0,255,255,255,0,0,0,0,0]);
  assert.equal(scanlineMask(rgba,8,4,1,0,{tolerance:7,expand:false})[3*8+1],0);
  assert.equal(scanlineMask(rgba,8,4,-1,0).some(Boolean),false);
});
test('a one-pixel fill expansion obeys a mask, including alpha-lock masks',()=>{
  const rgba=tile(9,3,x=>x===3?190:80);
  const expanded=scanlineMask(rgba,9,3,0,1,{tolerance:0,allow:i=>i<2*9});
  assert.equal(expanded[3],255);
  assert.equal(expanded[4],0);
  assert.equal(expanded[2*9+2],0);
  assert.equal(scanlineMask(rgba,9,3,0,2,{allow:i=>i<2*9}).some(Boolean),false);
});
test('HSV round trips and wedge tapers with speed',()=>{
  assert.equal(toHex(hsvToRgb(...rgbToHsv([220,60,138]))),'#dc3c8a');
  assert.equal(brushRadius('Cel Block',.25,9,80),40);
  assert.ok(brushRadius('Cel Wedge',.8,3,40,30)<brushRadius('Cel Wedge',.8,.2,40,30));
});
test('pose documents are bounded, versioned, and ignore unknown bones',()=>{
  assert.throws(()=>validatePose({version:2}),/version 1/);
  const d=validatePose({...initialPose(), rotations:{head:[8,0,0,1],extra:[0,0,0,1]}, offsets:{hips:[109,NaN,1]},shape:{bust:22,waist:-9}});
  assert.deepEqual(d.rotations,{head:[1,0,0,1]});
  assert.deepEqual(d.offsets.hips,[2,0,1]);
  assert.deepEqual(d.shape,{bust:1,waist:-1,hips:0,thighs:0,arms:0});
});
test('mirroring exchanges limbs and hand handedness without mutating the detected image',()=>{
  const pose=Array.from({length:33},(_,i)=>({x:i*.02,y:.3,z:.18}));
  const store={pose,world:pose,hands:[{side:'left',points:pose.slice(0,21),world:pose.slice(0,21)}]};
  const mirrored=mirrorPhoto(store);
  assert.equal(mirrored.world[13].x,-pose[14].x);
  assert.equal(mirrored.pose[27].x,1-pose[28].x);
  assert.equal(mirrored.hands[0].side,'right');
  assert.equal(store.hands[0].side,'left');
});
for(const model of MODELS)test(`${model.label} is a small, self-contained VRM0 with a skinned Body`,async()=>{
  const b=await readFile(new URL(`../public/${model.path}`,import.meta.url));
  assert.ok(b.length<1_800_000 && b.length>300_000);
  assert.equal(b.toString('utf8',0,4),'glTF');assert.equal(b.readUInt32LE(8),b.length);
  const gltf=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));
  const vrm=gltf.extensions.VRM, mesh=gltf.meshes.find(m=>m.name==='Body');
  assert.equal(vrm.specVersion,'0.0');assert.deepEqual(mesh.extras.targetNames,SHAPES);
  assert.equal(mesh.primitives[0].targets.length,5);
  assert.ok(mesh.primitives[0].targets.every(t=>t.POSITION!==undefined));
  assert.equal(vrm.humanoid.humanBones.filter(b=>FINGERS.some(f=>b.bone.includes(f))).length,30);
  assert.equal(gltf.images.filter(t=>t.uri).length,0);
});
