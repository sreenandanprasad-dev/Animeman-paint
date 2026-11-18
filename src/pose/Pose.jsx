import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, Box, Check, ChevronDown, Crosshair, FileUp, Focus, Hand, Image, LoaderCircle, Move, PenTool, Redo2, Rotate3D, RotateCcw, ScanLine, Settings2, SlidersHorizontal, Sun, Undo2 } from 'lucide-react';
import { BlobImage, FileInput, IconButton, Range, Toggle } from '../ui';
import { exportFile, putModel, uid } from '../storage';
import { BONE_LABEL, GROUPS, HAND_PRESETS, MODELS, POSE_PRESETS, SHAPES, SHAPE_PRESETS, initialPose, validatePose } from './data';
import { PoseStage, validateModel } from './stage';

const TABS=[[Rotate3D,'Pose'],[Hand,'Hands'],[SlidersHorizontal,'Shape'],[Sun,'Scene']];
const CAMERAS=['Front','¾ View','Side','Back','Top'];
const axes=['X','Y','Z'];
function HistoryRange({ stage, action, ...props }) {
  return <Range {...props} onStart={()=>stage.begin()} onEnd={()=>stage.commit()} onChange={n=>{if(stage.before)action(n);else stage.edit(()=>action(n));}}/>;
}
function PosePanel({ d, category, setCategory }) {
  const rotations=d.angles(),options=GROUPS[d.group].filter(n=>d.rig?.bone(n));
  return <div className="pose-stack">
    <div className="pose-section"><div className="panel-label"><Crosshair size={15}/> Joint controls</div>
      <div className="chip-row spread">{Object.keys(GROUPS).map(g=><button key={g} className={`chip ${g===d.group?'selected':''}`} onClick={()=>d.setGroup(g)}>{g}</button>)}</div>
      <label className="pose-select"><span>Joint</span><select value={options.includes(d.joint)?d.joint:''} aria-label="Joint" onChange={e=>d.choose(e.target.value)} disabled={!options.length}>{!options.length&&<option value="">No compatible bones</option>}{options.map(n=><option value={n} key={n}>{BONE_LABEL(n)}</option>)}</select></label>
      {axes.map((a,i)=><HistoryRange key={a} stage={d} label={`${a} rotation`} min={-180} max={180} value={rotations[i]} format={n=>`${n}°`} action={n=>d.setAngle(i,n)} disabled={!d.rig.bone(d.joint)}/>)}
      <HistoryRange stage={d} label="Hips Y height" min={-65} max={65} value={Math.round(d.heightOffset()*100)} format={n=>`${n} cm`} action={n=>d.setHeight(n/100)} disabled={!d.rig.bone('hips')}/>
      <Toggle checked={d.symmetry} onChange={v=>{d.symmetry=v;d.emit();}}>Symmetry L⇄R</Toggle><Toggle checked={d.showIK} onChange={v=>d.setIK(v)}>Hand &amp; foot IK handles</Toggle>
      <Toggle checked={d.dots} onChange={v=>{d.dots=v;d.syncMarkers();d.request();d.emit();}}>Show joint dots</Toggle>
    </div>
    <div className="pose-section"><div className="panel-label"><Rotate3D size={15}/> Pose presets</div><div className="chip-row">{['Action / Cute','Pinup / Glamour'].map(g=><button key={g} className={`chip ${category===g?'selected':''}`} onClick={()=>setCategory(g)}>{g}</button>)}</div>
      <div className="pose-preset-grid">{Object.entries(POSE_PRESETS).filter(([,p])=>p.category===category).map(([n,p])=><button className="pose-preset" key={n} onClick={()=>d.setPreset(n)} disabled={!d.rig.bone('hips')}><b>{n}</b><small>{p.desc}</small></button>)}</div>
    </div>
  </div>;
}
function HandsPanel({ d }) {
  const [side,setSide]=useState('both'),[picked,setPicked]=useState(''),[curl,setCurl]=useState(0);
  const hasFingers=!!(d.rig.bone('leftIndexProximal')||d.rig.bone('rightIndexProximal'));
  return <div className="pose-stack"><div className="pose-section"><div className="panel-label"><Hand size={15}/> Hand gestures</div><p className="panel-note">Set an expressive gesture, or curl the finger joints together.</p><div className="chip-row">{['left','right','both'].map(s=><button key={s} className={`chip capitalize ${side===s?'selected':''}`} onClick={()=>{setSide(s);setPicked('');}}>{s}</button>)}</div>
    <div className="pose-preset-grid">{Object.entries(HAND_PRESETS).map(([key,vals])=><button key={key} className={`pose-preset ${picked===key?'selected':''}`} disabled={!hasFingers} onClick={()=>{d.setHands(side,vals);setPicked(key);setCurl(Math.round(vals.slice(1).reduce((a,b)=>a+b,0)*25));}}>{key}</button>)}</div>
    <HistoryRange stage={d} label="Finger curl" value={curl} format={n=>`${n}%`} disabled={!hasFingers} action={n=>{setCurl(n);setPicked('');d.setHands(side,[n*.7/100,n/100,n/100,n/100,n/100],true);}}/>
    {!hasFingers&&<p className="panel-note">This file has no compatible finger rig.</p>}</div></div>;
}
function ShapePanel({ d }) {
  const available=d.morphCount;
  return <div className="pose-stack"><div className="pose-section"><div className="panel-label"><SlidersHorizontal size={15}/> Body shape</div><p className="panel-note">Adjust proportions on the rig without resetting your pose.</p>
    <div className="chip-row">{Object.entries(SHAPE_PRESETS).map(([key,values])=><button key={key} className={`chip ${SHAPES.every((s,i)=>d.shape[s]===values[i])?'selected':''}`} onClick={()=>d.setShapes(values)} disabled={!available}>{key}</button>)}</div>
    {SHAPES.map(s=><HistoryRange key={s} stage={d} label={s[0].toUpperCase()+s.slice(1)} min={-100} max={100} value={Math.round(d.shape[s]*100)} format={n=>`${n>0?'+':''}${n}%`} action={n=>d.setShape(s,n/100)} disabled={!available}/>)}
    {!available&&<p className="panel-note">This model has no named body-shape targets.</p>}
  </div></div>;
}
function ScenePanel({ d, onCamera }) {
  return <div className="pose-stack"><div className="pose-section"><div className="panel-label"><Sun size={15}/> Material &amp; light</div>
    <div className="chip-row"><button className={`chip ${d.light.material==='skin'?'selected':''}`} onClick={()=>d.edit(()=>d.lightOption('material','skin'))}>Anime Skin</button><button className={`chip ${d.light.material==='clay'?'selected':''}`} onClick={()=>d.edit(()=>d.lightOption('material','clay'))}>Studio Clay</button></div>
    <HistoryRange stage={d} label="Light angle" min={-180} max={180} value={d.light.azimuth} format={n=>`${n}°`} action={n=>d.lightOption('azimuth',n)}/><HistoryRange stage={d} label="Light elevation" min={0} max={90} value={d.light.elevation} format={n=>`${n}°`} action={n=>d.lightOption('elevation',n)}/>
    <HistoryRange stage={d} label="Lens FOV" min={16} max={75} value={d.light.fov} format={n=>`${n}°`} action={n=>d.lightOption('fov',n)}/>
  </div><div className="pose-section"><div className="panel-label"><Focus size={15}/> Camera presets</div><div className="chip-row">{CAMERAS.map(c=><button key={c} className={`chip ${d.cameraLabel===c?'selected':''}`} onClick={()=>{d.positionCamera(c);onCamera(d.export());}}>{c}</button>)}</div></div></div>;
}

export default forwardRef(function Pose({ active, projectKey, projectPose, readyChange, onHome, onDraw, canInk, getInk, onUse, openPhoto, onChange, notify }, ref) {
  const viewport=useRef(null),stage=useRef(null),modelInput=useRef(null),poseInput=useRef(null),key=useRef(null);
  const calls=useRef({readyChange,onChange,notify});calls.current={readyChange,onChange,notify};
  const [, tick]=useState(0),[tab,setTab]=useState('Pose'),[category,setCategory]=useState('Action / Cute'),[ink,setInk]=useState(null),[showInk,setShowInk]=useState(false),[inkOpacity,setInkOpacity]=useState(.55),[io,setIO]=useState(false),[baking,setBaking]=useState(false),[error,setError]=useState('');
  const d=stage.current;
  useImperativeHandle(ref,()=>({ applyPhoto:(data,options)=>{stage.current?.solve(data,options);setTab('Pose');}, getPose:()=>stage.current?.export() }));
  useEffect(()=>{
    try {
      const p=new PoseStage(viewport.current,{change:()=>{tick(n=>n+1);calls.current.readyChange(!!(stage.current?.loaded&&!stage.current?.busy&&stage.current?.rig?.bone('hips')));},dirty:(s)=>calls.current.onChange(s),camera:s=>calls.current.onChange(s)});
      stage.current=p;p.setActive(active);
      return()=>{p.destroy();stage.current=null;calls.current.readyChange(false);};
    }catch{setError('This browser or WebView does not have WebGL 2 available. Draw mode still works offline.');}
  },[]);
  useEffect(()=>{
    const p=stage.current;if(!p)return;
    p.setActive(active);
    if(active&&key.current!==projectKey){
      key.current=projectKey;setShowInk(false);setInk(null);
      const state=projectPose||initialPose();
      p.load(state.model,state).then(ok=>{
        if(!ok&&state.model!=='female'&&!p.dead&&key.current===projectKey){calls.current.notify('Could not restore that model. Opening the female base.');p.load('female',initialPose());}
      });
    }
  },[active,projectKey]);
  useEffect(()=>{if(!active)return;
    const key=e=>{if(e.target.closest?.('input,select,textarea')||document.querySelector('[aria-modal=true]'))return;if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();if(e.shiftKey||e.key.toLowerCase()==='y')stage.current?.redo();else stage.current?.undo();}};
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[active]);
  async function importModel(file){
    if(!d)return;
    try{
      if(file.size>48*1024*1024)throw new Error('Choose a figure under 48 MB.');
      validateModel(await file.arrayBuffer());const id=`custom-${uid()}`;await putModel({id,name:file.name,blob:file});
      if(await d.load(id,{...initialPose(),model:id})){d.changedModel();notify('Figure imported on this device');}
    }catch(err){notify(err.message||'Could not import this figure');}
  }
  async function importPose(file){
    try {if(file.size>512*1024)throw new Error('Pose files must be smaller than 512 KB.');
      const state=validatePose(JSON.parse(await file.text()),d.modelId);
      d.edit(()=>d.applyState(state));notify('Pose imported onto current model');
    }catch(err){notify(err.message||'Could not import this pose');}
  }
  async function exportPose(){
    try{await exportFile(new Blob([JSON.stringify(d.export(),null,2)],{type:'application/json'}),'KomaStudio-pose.json');setIO(false);}
    catch{notify('Could not export this pose');}
  }
  async function toggleInk(){
    if(showInk){setShowInk(false);return;}
    try{const blob=await getInk();if(blob){setInk(blob);setShowInk(true);}else notify('Open a drawing first to overlay its ink');}catch{notify('Could not overlay this drawing');}
  }
  async function use(){
    setBaking(true);
    try{const blob=await d.bake(canInk?.aspect||.74);await onUse({blob,visible:true,opacity:.34,blue:true,above:false},d.export());}
    catch(e){notify(e.message||'Could not bake 3D reference');}finally{setBaking(false);}
  }
  const available=d?.loaded&&!d.busy;
  return <section hidden={!active} className="workspace pose-workspace" aria-label="Pose Studio">
    <header className="editor-head"><IconButton icon={ArrowLeft} label={canInk?'Back to drawing':'Back to home'} onClick={canInk?onDraw:onHome}/><div className="editor-title"><small>FIGURE WORKSPACE</small><h1>3D Pose Studio</h1></div><div className="editor-spacer"/>
      <div className="head-group"><IconButton icon={Undo2} label="Undo pose" onClick={()=>d.undo()} disabled={!d?.undoList.length}/><IconButton icon={Redo2} label="Redo pose" onClick={()=>d.redo()} disabled={!d?.redoList.length}/></div><div className="head-group end">
        <button className="button secondary head-text" aria-label="Copy pose from image" onClick={()=>openPhoto()}><ScanLine size={16}/><span>Photo</span></button>
        <button className={`button secondary head-text ${showInk?'mode-on':''}`} aria-label="Overlay ink" onClick={toggleInk} disabled={!canInk}><PenTool size={16}/><span>Ink</span></button>
        <button className="button primary head-text" aria-label="Use pose reference" onClick={use} disabled={!available||baking}>{baking?<LoaderCircle size={16} className="spin"/>:<Check size={16}/>}<span>Use</span></button>
      </div></header>
    <div className="pose-body">
      <div className="pose-stage" ref={viewport}>
        <div className="pose-stage-top"><span className="stage-label"><span>FIGURE</span><i/>{d?.modelName||'Koma base'}</span><div className="pose-stage-right"><IconButton icon={Focus} label="Fit figure" onClick={()=>d?.positionCamera(d.cameraLabel)} disabled={!available}/><button className="chip" onClick={()=>{d.positionCamera(CAMERAS[(CAMERAS.indexOf(d.cameraLabel)+1)%CAMERAS.length]);onChange(d.export());}} disabled={!available}>{d?.cameraLabel||'¾ View'}<ChevronDown size={12}/></button></div></div>
        {showInk&&ink&&<><BlobImage className="ink-overlay" blob={ink} alt="Ink overlay" style={{opacity:inkOpacity}}/><div className="ink-settings"><Range label="Ink opacity" value={Math.round(inkOpacity*100)} onChange={n=>setInkOpacity(n/100)}/></div></>}
        <div className="pose-stage-foot"><div className="gizmo-tools" aria-label="Gizmo mode">{[[Rotate3D,'Rot','rot'],[Move,'Move','move'],[Settings2,'Off','off']].map(([Icon,n,v])=><button key={v} aria-pressed={d?.gizmo===v} className={`chip ${d?.gizmo===v?'selected':''}`} onClick={()=>{d.gizmo=v;d.attach();d.emit();}} disabled={!available}><Icon size={13}/>{n}</button>)}</div><span className="orbit-hint">{d?.gizmo==='move'&&available&&!d.transform.object?'Move hips, hands, or feet':'Drag to orbit · Pinch to zoom'}</span></div>
        {(d?.busy||error||d?.error)&&<div className={`workspace-loading ${available?'is-error':''}`}><div className="loading-content" role={error||d?.error?'alert':'status'}>{d?.busy&&<LoaderCircle className="spin" size={19}/>}<span>{error||d?.error||'Loading local figure…'}</span>{d?.error&&available&&<button className="chip" onClick={()=>{d.error='';d.emit();}}>Dismiss</button>}</div></div>}
      </div>
      <aside className="pose-inspector" aria-label="Pose controls">
        <div className="pose-models"><div className="panel-label"><Box size={16}/> Figure model <div className="pose-file-menu"><IconButton icon={FileUp} label="Model and pose files" onClick={()=>setIO(!io)} active={io}/>{io&&<div className="small-menu"><button onClick={()=>{modelInput.current?.click();setIO(false);}}><FileUp size={14}/> Import VRM / GLB</button><button onClick={()=>{poseInput.current?.click();setIO(false);}} disabled={!available}><FileUp size={14}/> Import pose JSON</button><button onClick={exportPose} disabled={!available}><ArrowDownToLine size={14}/> Export pose JSON</button></div>}</div></div>
          <label className="model-select"><Box size={15}/><select aria-label="Figure model" value={d?.modelId||'female'} disabled={!d||d.busy} onChange={async e=>{const id=e.target.value;if(await d.load(id))d.changedModel();}}>{MODELS.map(m=><option key={m.id} value={m.id}>{m.label} · {m.detail}</option>)}{d?.customModel&&<option value={d.modelId}>{d.modelName}</option>}</select></label>
        </div>
        <div className="pose-tabs" role="tablist" aria-label="Pose inspector tabs">{TABS.map(([Icon,n])=><button key={n} role="tab" aria-selected={tab===n} className={tab===n?'selected':''} onClick={()=>setTab(n)}><Icon size={14}/>{n}</button>)}</div>
        <div className="pose-scroll" role="tabpanel" aria-label={`${tab} controls`}>{available&&(tab==='Pose'?<PosePanel d={d} category={category} setCategory={setCategory}/>:tab==='Hands'?<HandsPanel d={d}/>:tab==='Shape'?<ShapePanel d={d}/>:<ScenePanel d={d} onCamera={onChange}/>)}</div>
        <div className="pose-panel-foot"><button className="chip" disabled={!available} onClick={()=>{d.setPreset('Neutral');notify('Pose reset');}}><RotateCcw size={13}/> Reset pose</button><span>LOCAL FIGURE RIG</span></div>
      </aside>
    </div>
    <FileInput inputRef={modelInput} accept=".vrm,.glb,model/gltf-binary" label="VRM or GLB figure file" onPick={importModel}/><FileInput inputRef={poseInput} accept=".json,application/json" label="Pose JSON file" onPick={importPose}/>
  </section>;
});
