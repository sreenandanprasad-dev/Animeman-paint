import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { asset, canvas, getModel, png } from '../storage';
import { BONES, CHAINS, GROUPS, HAND_PRESETS, MODELS, POSE_PRESETS, SHAPES, initialPose, validatePose } from './data';
import { FigureRig, applyPhotoPose, worldPos } from './rig';

const V=(...args)=>new T.Vector3(...args);
const MAX_BYTES=48*1024*1024;
export function validateModel(data) {
  if(data.byteLength<28||data.byteLength>MAX_BYTES)throw new Error('Choose a self-contained VRM or GLB under 48 MB.');
  const dv=new DataView(data), len=dv.getUint32(12,true);
  if(dv.getUint32(0,true)!==0x46546c67||dv.getUint32(4,true)!==2||dv.getUint32(8,true)!==data.byteLength||len>data.byteLength-20||dv.getUint32(16,true)!==0x4e4f534a)throw new Error('This is not a binary glTF 2.0 figure.');
  const doc=JSON.parse(new TextDecoder().decode(new Uint8Array(data,20,len)));
  if([...(doc.images||[]),...(doc.buffers||[])].some(x=>x.uri&&!/^data:(?:image\/(?:png|jpeg|webp)|application\/(?:octet-stream|gltf-buffer));base64,/i.test(x.uri)))throw new Error('External model textures or buffers are not supported offline. Embed them in the GLB.');
  if(doc.extensionsRequired?.some(ext=>['KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu'].includes(ext)))throw new Error('Export this model with uncompressed geometry and PNG or JPEG textures.');
  return doc;
}

export class PoseStage {
  constructor(el, events) {
    this.el=el;this.events=events;this.active=false;this.busy=false;this.loaded=false;this.modelId='female';
    this.group='Body';this.joint='hips';this.gizmo='rot';this.symmetry=false;this.dots=true;this.showIK=false;this.cameraLabel='¾ View';
    this.shape=initialPose().shape;this.light=initialPose().light;this.undoList=[];this.redoList=[];
    this.renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
    this.renderer.setClearColor(0x000000,0);this.renderer.outputColorSpace=T.SRGBColorSpace;
    this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.35;
    this.renderer.domElement.className='pose-canvas';this.renderer.domElement.setAttribute('aria-label','3D pose viewport');el.append(this.renderer.domElement);
    this.scene=new T.Scene();this.camera=new T.PerspectiveCamera(31,1,.01,105);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.13;this.controls.maxPolarAngle=Math.PI*.94;this.controls.maxDistance=18;this.controls.minDistance=.20;
    this.controls.addEventListener('change',()=>this.request());
    this.controls.addEventListener('end',()=>{if(this.loaded&&this.active){this.events.camera?.(this.export());}});
    this.transform=new TransformControls(this.camera,this.renderer.domElement);
    this.transform.setSize(.65);this.transform.setSpace('local');this.transform.enabled=false;
    this.scene.add(this.transform.getHelper());
    this.transform.addEventListener('change',()=>this.request());
    this.transform.addEventListener('dragging-changed',e=>{this.controls.enabled=this.active&&!e.value;if(e.value)this.begin();else{if(this.ikSelected)this.syncHandles();this.commit();}});
    this.transform.addEventListener('objectChange',()=>{
      if(!this.rig)return;
      if(this.ikSelected) {
        const t=this.handles[this.ikSelected].position;
        this.rig.limb(this.ikSelected,t,this.ikPole);
        if(this.symmetry){const mate=this.ikSelected.startsWith('left')?`right${this.ikSelected.slice(4)}`:`left${this.ikSelected.slice(5)}`;
          this.rig.limb(mate,t.clone().multiply(V(-1,1,1)),this.ikPole?.clone().multiply(V(-1,1,1)));}
      } else if(this.symmetry)this.rig.mirror(this.joint);
      this.update();this.emit();
    });
    this.ambient=new T.HemisphereLight(0xdde0ff,0x433a66,1.75);
    this.key=new T.DirectionalLight(0xffeaf1,2.45);this.rim=new T.DirectionalLight(0x9195ff,2.05);this.rim.position.set(-1.8,1.5,-1.3);
    this.scene.add(this.ambient,this.key,this.rim);
    this.floor=new T.Group();this.scene.add(this.floor);
    const grid=new T.GridHelper(16,42,0x615079,0x554963);grid.material.transparent=true;grid.material.opacity=.41;grid.material.depthWrite=false;this.floor.add(grid);
    const shadow=canvas(96,96), sc=shadow.getContext('2d'),g=sc.createRadialGradient(48,48,5,48,48,45);
    g.addColorStop(0,'#0b0816ae');g.addColorStop(.54,'#0b081660');g.addColorStop(1,'#0b081600');sc.fillStyle=g;sc.fillRect(0,0,96,96);
    this.shadow=new T.Mesh(new T.PlaneGeometry(1.05,1.05),new T.MeshBasicMaterial({map:new T.CanvasTexture(shadow),transparent:true,depthWrite:false}));
    this.shadow.rotation.x=-Math.PI/2;this.shadow.position.y=.001;this.floor.add(this.shadow);
    this.clay=new T.MeshStandardMaterial({color:0xb9a7da,roughness:.76,metalness:0,side:T.DoubleSide});
    this.joints=new T.Group();this.scene.add(this.joints);
    this.dotGeom=new T.SphereGeometry(1,11,8);
    this.dotMat=new T.MeshBasicMaterial({color:0xba9eff,depthTest:false,transparent:true,opacity:.86});
    this.activeDotMat=new T.MeshBasicMaterial({color:0xe8d1ff,depthTest:false});
    this.handleMat=new T.MeshBasicMaterial({color:0x80dfcc,depthTest:false,transparent:true,opacity:.92});
    this.handles={};this.markers={};this.picker=new T.Raycaster();
    const ikGeom=new T.OctahedronGeometry(1,0);this.ikGeom=ikGeom;
    for(const k of Object.keys(CHAINS)) {
      const obj=new T.Group(),marker=new T.Mesh(ikGeom,this.handleMat);marker.userData.ik=k;marker.renderOrder=18;obj.add(marker);obj.userData.marker=marker;this.handles[k]=obj;this.scene.add(obj);
    }
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(el);
    this.down=e=>{this.tap={x:e.clientX,y:e.clientY,id:e.pointerId}; this.ikPole=this.ikSelected?worldPos(this.rig?.bone(CHAINS[this.ikSelected][1])):null;};
    this.up=e=>this.selectPoint(e);
    this.renderer.domElement.addEventListener('pointerdown',this.down);
    this.renderer.domElement.addEventListener('pointerup',this.up);
    this.positionCamera('¾ View');this.updateLight();
  }
  emit(){if(!this.dead)this.events.change?.();}
  setActive(active) {
    this.active=active;this.controls.enabled=active;this.transform.enabled=active&&!!this.transform.object;
    if(!active){cancelAnimationFrame(this.frame);this.frame=0;}
    else {this.resize();this.request();}
  }
  resize() {
    if(!this.active||this.dead)return;
    const w=this.el.clientWidth,h=this.el.clientHeight;if(w<2||h<2)return;
    const dpr=Math.min(1.25,devicePixelRatio||1);
    if(this.w===w&&this.h===h&&this.dpr===dpr)return;
    this.w=w;this.h=h;this.dpr=dpr;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(dpr);this.renderer.setSize(w,h,false);this.request();
  }
  request() {if(!this.active||this.dead||this.frame)return;this.frame=requestAnimationFrame(()=>{this.frame=0;this.controls.update();this.renderer.render(this.scene,this.camera);});}
  async load(id, data) {
    const token=Symbol(id);this.loadToken=token;this.busy=true;this.error='';this.emit();
    try {
      let bytes,name;
      const builtin=MODELS.find(m=>m.id===id);
      if(builtin) {
        const res=await fetch(asset(builtin.path));if(!res.ok)throw new Error('Built-in figure file is missing.');bytes=await res.arrayBuffer();name=builtin.label;
      } else {
        const stored=await getModel(id);if(!stored)throw new Error('This imported figure is no longer on this device.');
        bytes=await stored.blob.arrayBuffer();name=stored.name;
      }
      const doc=validateModel(bytes);
      const manager=new T.LoadingManager();
      manager.setURLModifier(url=>/^(blob:|data:)/.test(url)?url:'data:application/octet-stream;base64,');
      const loader=new GLTFLoader(manager);
      if(doc.extensions?.VRM||doc.extensions?.VRMC_vrm)loader.register(parser=>new VRMLoaderPlugin(parser,{ autoUpdateHumanBones:true }));
      const gltf=await loader.parseAsync(bytes,'');
      if(this.dead||this.loadToken!==token){VRMUtils.deepDispose(gltf.scene);return false;}
      const vrm=gltf.userData.vrm;if(vrm)VRMUtils.rotateVRM0(vrm);
      if(this.figure){this.restoreMaterials();this.scene.remove(this.figure);VRMUtils.deepDispose(this.figure);}
      this.figure=gltf.scene;this.scene.add(this.figure);this.figure.updateMatrixWorld(true);
      this.figure.traverse(object=>{if(object.isMesh){object.frustumCulled=false;object.userData.komaMaterial=object.material;}});
      const bounds=new T.Box3().setFromObject(this.figure),size=bounds.getSize(V());
      this.height=Math.max(.1,size.y||1.7);this.modelRadius=Math.max(size.x,size.z,this.height*.48);
      if(!bounds.isEmpty()){const center=bounds.getCenter(V());this.floor.position.set(center.x,bounds.min.y,center.z);this.center=V(center.x,bounds.min.y+size.y*.53,center.z);}else this.center=V(0,.85,0);
      this.rig=new FigureRig(gltf,this.figure);
      this.modelId=id;this.modelName=name;this.customModel=!builtin;this.loaded=true;
      this.undoList=[];this.redoList=[];this.before=null;this.ikSelected=null;this.joint='hips';
      this.applyState(data||{...initialPose(),model:id});this.syncMarkers();this.attach();
      this.positionCamera('¾ View');
      if(data?.camera){this.camera.position.fromArray(data.camera.position);this.controls.target.fromArray(data.camera.target);this.controls.update();this.cameraLabel='Custom';}
      this.busy=false;this.request();this.emit();return true;
    } catch(err){
      if(this.dead||this.loadToken!==token)return false;
      this.busy=false;this.error=err?.message||'This figure could not be opened.';this.emit();return false;
    }
  }
  export() {
    return {version:1, model:this.modelId,...(this.rig?.serialize()||{rotations:{},offsets:{}}),shape:{...this.shape},light:{...this.light},camera:{position:this.camera.position.toArray(),target:this.controls.target.toArray()}};
  }
  applyState(data) {
    const state=validatePose(data,this.modelId);this.rig?.apply(state);this.shape={...state.shape};this.light={...state.light};
    this.applyShape();this.updateLight();this.update();this.emit();
  }
  begin(){if(!this.before&&this.loaded)this.before=this.export();}
  commit(){
    if(!this.before)return;
    const after=this.export(),before=this.before;this.before=null;
    // Camera moves are navigation, not pose edits.
    if(JSON.stringify({...after,camera:null})===JSON.stringify({...before,camera:null}))return;
    this.undoList.push(before);if(this.undoList.length>36)this.undoList.shift();this.redoList=[];
    this.events.dirty?.(after);this.emit();
  }
  edit(fn){if(!this.loaded)return;this.begin();fn();this.commit();}
  undo(){const before=this.undoList.pop();if(!before)return;this.redoList.push(this.export());this.applyState(before);this.events.dirty?.(this.export());this.emit();}
  redo(){const after=this.redoList.pop();if(!after)return;this.undoList.push(this.export());this.applyState(after);this.events.dirty?.(this.export());this.emit();}
  changedModel(){this.events.dirty?.(this.export());}
  update(){this.rig?.update();this.syncMarkers();if(!this.transform.dragging)this.syncHandles();this.request();}
  angles(){return this.rig?.angles(this.joint)||[0,0,0];}
  setAngle(axis,n){const a=this.angles();a[axis]=n;this.rig.setAngles(this.joint,a,this.symmetry);this.update();this.emit();}
  heightOffset(){return this.rig?.offset('hips').y??0;}
  setHeight(h){const p=this.rig.offset('hips');p.y=h;this.rig.setOffset('hips',p);this.update();this.emit();}
  setPreset(name){
    const p=POSE_PRESETS[name];if(!p)return;
    this.edit(()=>{this.rig.reset();for(const [name,angles] of Object.entries(p.rotations))this.rig.setAngles(name,angles,false);
      if(p.height)this.rig.setOffset('hips',V(0,p.height*(this.height/1.68),0));
      if(p.hands)for(const side of ['left','right'])this.rig.curl(side,HAND_PRESETS[p.hands]);this.update();});
  }
  setHands(side, amounts, live=false) {
    if(!this.rig)return;
    const run=()=>{for(const s of side==='both'?['left','right']:[side])this.rig.curl(s,amounts);this.update();this.emit();};
    if(live)run();else this.edit(run);
  }
  get morphCount(){const hits=new Set();this.figure?.traverse(o=>{for(const s of SHAPES)if(o.morphTargetDictionary?.[s]!==undefined)hits.add(s);});return hits.size;}
  applyShape() {
    this.figure?.traverse(o=>{if(o.morphTargetInfluences)for(const name of SHAPES){const i=o.morphTargetDictionary?.[name];if(i!==undefined)o.morphTargetInfluences[i]=this.shape[name];}});
    this.request();
  }
  setShape(name,value){this.shape[name]=value;this.applyShape();this.emit();}
  setShapes(values){this.edit(()=>{this.shape=Object.fromEntries(SHAPES.map((k,i)=>[k,values[i]]));this.applyShape();this.emit();});}
  restoreMaterials(){this.figure?.traverse(o=>{if(o.isMesh&&o.userData.komaMaterial)o.material=o.userData.komaMaterial;});}
  updateLight() {
    const a=this.light.azimuth*Math.PI/180,b=this.light.elevation*Math.PI/180;
    this.key.position.set(Math.sin(a)*Math.cos(b)*3,Math.sin(b)*3,Math.cos(a)*Math.cos(b)*3);
    this.camera.fov=this.light.fov;this.camera.updateProjectionMatrix();
    if(this.light.material==='skin')this.restoreMaterials();
    else this.figure?.traverse(o=>{if(o.isMesh&&o.userData.komaMaterial){const mat=o.userData.komaMaterial;
      // Keep eye/lid colors on the clay mannequin for orientation.
      if(Array.isArray(mat))o.material=mat.map(m=>/iris|pearl|lid|lip/i.test(m.name)?m:this.clay);
      else o.material=/iris|pearl|lid|lip/i.test(mat.name)?mat:this.clay;}});
    this.request();
  }
  lightOption(key,value){this.light[key]=value;this.updateLight();this.emit();}
  positionCamera(mode) {
    this.cameraLabel=mode;
    const c=this.center||V(0,.86,0),h=this.height||1.7;
    const distance=Math.max(h,this.modelRadius||0)*.63/Math.tan(T.MathUtils.degToRad(this.light.fov/2));
    const directions={'Front':V(0,0,1),'¾ View':V(.46,.13,.88),'Side':V(1,.035,0),'Back':V(0,.05,-1),'Top':V(0,1,.08)};
    this.controls.target.copy(c);this.camera.position.copy(c).addScaledVector((directions[mode]||directions['¾ View']).normalize(),distance);
    this.controls.update();this.request();this.emit();
  }
  syncMarkers() {
    if(!this.rig)return;
    const group=GROUPS[this.group]||BONES;
    for(const k of BONES) {
      const b=this.rig.bone(k);if(!b)continue;
      let mesh=this.markers[k];
      if(!mesh){mesh=new T.Mesh(this.dotGeom,this.dotMat);mesh.userData.joint=k;mesh.renderOrder=16;this.joints.add(mesh);this.markers[k]=mesh;}
      const select=k===this.joint&&!this.ikSelected;
      mesh.visible=this.dots&&(group.includes(k)||select);mesh.material=select?this.activeDotMat:this.dotMat;
      mesh.position.copy(worldPos(b));
      mesh.scale.setScalar(this.height*(this.group==='Fingers'?.0125:select?.014:.010));
    }
    for(const [k,mesh] of Object.entries(this.markers))if(!this.rig.bone(k))mesh.visible=false;
  }
  syncHandles() {
    for(const [k,obj] of Object.entries(this.handles)) {
      const bone=this.rig?.bone(k);obj.visible=!!bone&&this.showIK;
      if(!bone)continue;
      obj.position.copy(worldPos(bone));obj.userData.marker.scale.setScalar(this.height*.018);
    }
  }
  selectPoint(e) {
    const tap=this.tap;this.tap=null;
    if(!tap||e.pointerId!==tap.id||Math.hypot(e.clientX-tap.x,e.clientY-tap.y)>8||this.transform.axis||!this.active||e.button!==0)return;
    const b=this.renderer.domElement.getBoundingClientRect();
    this.picker.setFromCamera(new T.Vector2((e.clientX-b.left)/b.width*2-1,1-(e.clientY-b.top)/b.height*2),this.camera);
    const meshes=[...Object.values(this.markers).filter(o=>o.visible), ...Object.values(this.handles).filter(o=>o.visible).map(o=>o.userData.marker)];
    let hit=this.picker.intersectObjects(meshes,false)[0]?.object?.userData;
    // Visible markers stay small, but have a wider touch target near their projected centers.
    if(!hit&&e.pointerType==='touch'){
      let nearest=13;
      for(const mesh of meshes){
        const n=mesh.getWorldPosition(V()).project(this.camera);
        if(n.z < -1 || n.z > 1)continue;
        const gap=Math.hypot((n.x+1)*b.width/2-(e.clientX-b.left),(1-n.y)*b.height/2-(e.clientY-b.top));
        if(gap<nearest){nearest=gap;hit=mesh.userData;}
      }
    }
    if(hit?.ik){this.ikSelected=hit.ik;this.joint=hit.ik;this.group=hit.ik.endsWith('Hand')?'Arms':'Legs';this.gizmo='move';this.attach();this.emit();}
    else if(hit?.joint)this.choose(hit.joint);
  }
  choose(name){this.joint=name;this.ikSelected=null;this.attach();this.syncMarkers();this.emit();}
  setGroup(group){this.group=group;if(!GROUPS[group].includes(this.joint))this.choose(GROUPS[group].find(name=>this.rig?.bone(name))||GROUPS[group][0]);this.syncMarkers();this.request();this.emit();}
  setIK(value){this.showIK=value;if(!value&&this.ikSelected){this.ikSelected=null;this.attach();}this.syncHandles();this.request();this.emit();}
  attach() {
    this.transform.detach();this.transform.enabled=false;
    if(this.gizmo==='off'||!this.rig)return;
    const node=this.rig.bone(this.joint);if(!node)return;
    if(this.gizmo==='move'&&CHAINS[this.joint]) {
      this.showIK=true;this.ikSelected=this.joint;this.syncHandles();this.transform.attach(this.handles[this.joint]);this.transform.setMode('translate');this.transform.setSpace('world');
    } else if(this.gizmo==='move'&&this.joint!=='hips'&&this.rig.vrm) {
      // VRM normalized translations other than hips are not transferred by the rig.
      this.ikSelected=null;
    } else {
      this.ikSelected=null;this.transform.attach(node);this.transform.setMode(this.gizmo==='move'?'translate':'rotate');this.transform.setSpace(this.gizmo==='move'?'world':'local');
    }
    this.transform.enabled=this.active&&!!this.transform.object;this.request();
  }
  solve(data, options){ this.edit(()=>{if(!this.rig.bone('hips'))throw new Error('A humanoid rig is required to copy a pose.');applyPhotoPose(this.rig,data,options);this.update();}); }
  async bake(aspect=.74) {
    if(!this.loaded||!this.active)throw new Error('A figure must be visible to bake a reference');
    const ratio=Math.max(.24,Math.min(4,aspect));
    const h=Math.round(Math.min(1024,1024/ratio)),w=Math.round(h*ratio),bake=canvas(w,h);
    const visibility=[this.floor,this.joints,this.transform.getHelper(),...Object.values(this.handles)].map(o=>[o,o.visible]);
    visibility.forEach(([o])=>o.visible=false);
    const prevAspect=this.camera.aspect;
    try {
      this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setPixelRatio(1);this.renderer.setSize(w,h,false);
      this.renderer.render(this.scene,this.camera);bake.getContext('2d').drawImage(this.renderer.domElement,0,0);
    } finally {
      visibility.forEach(([o,visible])=>o.visible=visible);
      this.camera.aspect=prevAspect;this.camera.updateProjectionMatrix();this.renderer.setPixelRatio(this.dpr||1);this.renderer.setSize(this.w||w,this.h||h,false);this.request();
    }
    return png(bake);
  }
  destroy() {
    this.dead=true;this.setActive(false);this.resizeObserver.disconnect();
    const dom=this.renderer.domElement;dom.removeEventListener('pointerdown',this.down);dom.removeEventListener('pointerup',this.up);
    this.transform.detach();this.transform.dispose();this.controls.dispose();
    if(this.figure){this.restoreMaterials();VRMUtils.deepDispose(this.figure);}
    VRMUtils.deepDispose(this.floor);
    for(const resource of [this.clay,this.dotGeom,this.dotMat,this.activeDotMat,this.ikGeom,this.handleMat])resource.dispose();
    this.renderer.dispose();dom.remove();
  }
}
