import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Blend, Box, Brush, Check, ChevronDown, Circle, CircleDashed, ClipboardCopy, Copy, Download, Droplet, Eraser, Eye, EyeOff, FlipHorizontal2, FlipVertical2, Focus, Grid3X3, Layers3, LoaderCircle, Lock, Move, PaintBucket, Pencil, PenTool, Pin, Pipette, Plus, Redo2, RotateCcw, Scissors, Settings2, Share2, Spline, SquareDashed, Trash2, Undo2, UnfoldVertical, X } from 'lucide-react';
import { IconButton, Modal, PaperDots, Range, Toggle } from '../ui';
import { exportFile, putProject } from '../storage';
import ColorPicker from './Color';
import ReferenceViewer from './Reference';
import { BLENDS, BRUSHES, DrawingEngine } from './engine';
import { clamp } from './raster';

const TOOLS = [[PenTool,'Brush','brush'],[Eraser,'Eraser','eraser'],[PaintBucket,'Fill','fill'],[Pipette,'Eyedropper','pick'],[Spline,'Lasso','lasso'],[SquareDashed,'Rect selection','rect'],[Move,'Move / Transform','transform']];
const BRUSH_ICONS=[PenTool,Circle,Pencil,Eraser,SquareDashed,UnfoldVertical,Droplet,Blend];
const GUIDES=['Off','Thirds','Grid','Manga'];
const pct = v => `${Math.round(v*100)}%`;

function Vertical({ label, value, min, max, onChange, display }) {
  const update = e => {
    if(e.type==='pointerdown')e.currentTarget.setPointerCapture(e.pointerId);
    else if(!e.currentTarget.hasPointerCapture(e.pointerId))return;
    const b=e.currentTarget.getBoundingClientRect(); const factor=clamp(1-(e.clientY-b.top)/b.height,0,1);
    onChange(Math.round(min+factor*(max-min)));
  };
  const step=e=>{
    let next;if(['ArrowUp','ArrowRight'].includes(e.key))next=value+1;if(['ArrowDown','ArrowLeft'].includes(e.key))next=value-1;
    if(e.key==='Home')next=min;if(e.key==='End')next=max;
    if(next!==undefined){e.preventDefault();onChange(clamp(next,min,max));}
  };
  return <div className="vertical-control"><span>{label}</span><div className="vertical-slider" role="slider" tabIndex={0} aria-orientation="vertical" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={display} style={{'--level':`${(value-min)/(max-min)*100}%`}} onPointerDown={update} onPointerMove={update} onKeyDown={step}><i/></div><output>{display}</output></div>;
}

function Layers({ e, close, open }) {
  const layer=e.layer, index=e.layers.indexOf(layer);
  const [label,setLabel]=useState('');
  useEffect(()=>setLabel(layer?.name || ''),[layer?.id,layer?.name]);
  return <aside className={`layer-drawer ${open?'drawer-open':''}`} aria-label="Layers drawer" hidden={!open}>
    <header><Layers3 size={16}/><h3>Layers <span>{e.layers.length}/10</span></h3><IconButton icon={Plus} label="Add layer" onClick={()=>e.addLayer()} disabled={e.layers.length>=10}/><IconButton icon={X} label="Close layers" onClick={close}/></header>
    <div className="layer-scroll">
      <div className="layer-list">{[...e.layers].reverse().map(l=><div key={l.id} className={`layer-row ${l.id===e.activeId?'selected':''}`}>
        <IconButton icon={l.visible?Eye:EyeOff} label={`${l.visible?'Hide':'Show'} ${l.name}`} onClick={()=>e.layerMeta(l.id,'visible',!l.visible)}/>
        <button className="layer-select" type="button" aria-pressed={l.id===e.activeId} onClick={()=>e.chooseLayer(l.id)}><span className="layer-thumb checker"><LayerThumbnail layer={l}/></span><span className="layer-name"><b>{l.name}</b><small>{BLENDS.find(([v])=>v===l.blend)?.[1]} · {pct(l.opacity)}</small></span>{l.alphaLock&&<Lock size={11}/>}</button>
      </div>)}</div>
      {layer&&<div className="layer-properties">
        <label className="layer-field"><span>Name</span><input aria-label="Layer name" value={label} maxLength={45} onChange={ev=>setLabel(ev.target.value)} onBlur={()=>{const n=label.trim();if(n)e.layerMeta(layer.id,'name',n);else setLabel(layer.name);}} onKeyDown={ev=>{if(ev.key==='Enter')ev.target.blur();}}/></label>
        <label className="layer-field"><span>Blend</span><select aria-label="Blend mode" value={layer.blend} onChange={ev=>e.layerMeta(layer.id,'blend',ev.target.value)}>{BLENDS.map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
        <Range label="Layer opacity" value={Math.round(layer.opacity*100)} format={n=>`${n}%`} onStart={()=>e.beginLayerMeta(layer.id,'opacity')} onEnd={()=>e.endLayerMeta()} onChange={n=>e.layerMeta(layer.id,'opacity',n/100,!!e.metaEdit)}/>
        <Toggle checked={layer.alphaLock} onChange={v=>e.layerMeta(layer.id,'alphaLock',v)}>Alpha Lock</Toggle>
        <Toggle checked={layer.clip} onChange={v=>e.layerMeta(layer.id,'clip',v)} disabled={index===0}>Clipping Mask</Toggle>
        <div className="layer-actions"><IconButton icon={Copy} label="Duplicate layer" disabled={e.layers.length>=10} onClick={()=>e.duplicateLayer()}/><IconButton icon={Layers3} label="Merge down" onClick={()=>e.mergeDown()} disabled={index<1}/><IconButton icon={ArrowUp} label="Move layer up" onClick={()=>e.moveLayer(1)} disabled={index>=e.layers.length-1}/><IconButton icon={ArrowDown} label="Move layer down" onClick={()=>e.moveLayer(-1)} disabled={index<=0}/><IconButton icon={Eraser} label="Clear layer" onClick={()=>e.clearLayer()}/><IconButton icon={Trash2} label="Delete layer" onClick={()=>e.deleteLayer()} disabled={e.layers.length===1}/></div>
      </div>}
      <div className="layer-section"><h4>Paper color</h4><PaperDots value={e.paper} onChange={v=>e.changePaper(v)}/></div>
      <div className="layer-section reference-layer"><h4><Box size={15}/> 3D pose reference</h4>{e.ref.blob?<>
        <Toggle checked={e.ref.visible} onChange={v=>e.setReferenceMeta('visible',v)}>Visible</Toggle>
        <Range label="Reference opacity" value={Math.round(e.ref.opacity*100)} format={n=>`${n}%`} onChange={n=>e.setReferenceMeta('opacity',n/100)}/>
        <Toggle checked={e.ref.blue} onChange={v=>e.setReferenceMeta('blue',v)}>Non-Photo Blue</Toggle>
        <Toggle checked={e.ref.above} onChange={v=>e.setReferenceMeta('above',v)}>Keep above ink</Toggle>
      </>:<p>Open Pose Studio and tap Use to add a figure.</p>}</div>
    </div>
  </aside>;
}
function LayerThumbnail({ layer }){
  const ref=useRef(null);
  useEffect(()=>{
    const c=ref.current,p=c.getContext('2d'),s=Math.min(c.width/layer.c.width,c.height/layer.c.height),w=layer.c.width*s,h=layer.c.height*s;
    p.clearRect(0,0,c.width,c.height);p.drawImage(layer.c,(c.width-w)*.5,(c.height-h)*.5,w,h);
  },[layer.c,layer.rev]);
  return <canvas ref={ref} width="36" height="34"/>;
}

const Draw = forwardRef(function Draw({ project, active, goHome, goPose, onPhoto, referenceFile, setReferenceFile, notify, onSaved }, ref) {
  const stage=useRef(null),view=useRef(null),overlay=useRef(null),instance=useRef(null);
  const callbacks=useRef({notify,onSaved});callbacks.current={notify,onSaved};
  const savedRev=useRef(0),timer=useRef(0),queue=useRef(Promise.resolve());
  const [tick,redraw]=useState(0),[status,setStatus]=useState('Saved on device'),[error,setError]=useState('');
  const [drawer,setDrawer]=useState(()=>matchMedia('(min-width: 980px)').matches),[menu,setMenu]=useState(''),[color,setColor]=useState(false),[reference,setReference]=useState(false),[exporting,setExporting]=useState(false),[exportRef,setExportRef]=useState(false),[editing,setEditing]=useState(false),[name,setName]=useState(project.title);
  const e=instance.current;
  function flush(){
    clearTimeout(timer.current);
    const engine=instance.current;
    if(!engine?.ready||engine.revision===savedRev.current)return queue.current;
    queue.current=queue.current.catch(()=>{}).then(async()=>{
      if(engine.dead||engine.revision===savedRev.current)return;
      try{
        const {record,revision}=await engine.snapshot();
        await putProject(record);savedRev.current=revision;
        if(!engine.dead){setStatus(engine.revision===revision?'Saved on device':'Saving…');callbacks.current.onSaved(record);}
      }catch(err){if(!engine.dead){setStatus('Not saved');callbacks.current.notify('Could not save locally. Check device storage.');}}
    });return queue.current;
  }
  useImperativeHandle(ref,()=>({
    flush,
    bakeReference:async (data,pose)=>{await instance.current?.setReference(data,pose);await flush();},
    updatePose:pose=>{if(instance.current?.ready)instance.current.setPose(pose);},
    getInk:()=>instance.current?.artwork({inkOnly:true}),
  }));
  useEffect(()=>{
    const engine=new DrawingEngine(stage.current,view.current,overlay.current,project,{
      change:()=>redraw(k=>k+1), notify:text=>callbacks.current.notify(text),
      dirty:()=>{setStatus('Saving…');clearTimeout(timer.current);timer.current=setTimeout(flush,720);},
    });
    instance.current=engine;savedRev.current=0;
    engine.setPaused(!active);
    engine.init().then(()=>{if(!engine.dead&&!project.thumb&&!project.thumbUrl)engine.changed();}).catch(()=>{if(!engine.dead)setError('This project could not be loaded.');});
    const visibility=()=>{if(document.visibilityState==='hidden')flush();};
    document.addEventListener('visibilitychange',visibility);
    return()=>{clearTimeout(timer.current);engine.destroy();document.removeEventListener('visibilitychange',visibility);instance.current=null;};
  },[]);
  useEffect(()=>{e?.setPaused(!active);if(!active)flush();},[active]);
  useEffect(()=>{
    if(!active)return;
    function key(ev){
      const d=instance.current;if(!d?.ready||ev.target.closest?.('input,select,textarea,[role=dialog]')||document.querySelector('[aria-modal=true]'))return;
      const k=ev.key.toLowerCase();
      if((ev.ctrlKey||ev.metaKey)&&(k==='z'||k==='y')) {ev.preventDefault();if(ev.shiftKey||k==='y')d.redo();else d.undo();}
      else if((ev.ctrlKey||ev.metaKey)&&k==='v'&&d.cutBuffer){ev.preventDefault();d.pasteCut();}
      else if(ev.ctrlKey||ev.metaKey||ev.altKey)return;
      else if(k===' '&&ev.target.tagName!=='BUTTON'){ev.preventDefault();d.space=true;}
      else if(k==='escape'){if(d.transform)d.finishTransform(false);else if(d.selection)d.deselect();else setMenu('');}
      else if(k==='b'){if(d.brush==='Eraser')d.set('brush','G-Pen');else d.setTool('brush');}
      else if(k==='e')d.set('brush','Eraser');else if(k==='f')d.setTool('fill');else if(k==='i')d.setTool('pick');else if(k==='v')d.setTool('transform');else if(k==='0')d.fit();
    }
    const lift=ev=>{if(ev.key===' '&&instance.current)instance.current.space=false;};
    window.addEventListener('keydown',key);window.addEventListener('keyup',lift);
    return()=>{window.removeEventListener('keydown',key);window.removeEventListener('keyup',lift);};
  },[active]);
  const tool= e?.tool==='brush'&&e.brush==='Eraser'?'eraser':e?.tool;
  const selectedBrush = label=>{e.set('brush',label);setMenu('');};
  const chooseTool = id=>{
    if(id==='eraser')e.set('brush','Eraser');
    else if(id==='brush'&&e.brush==='Eraser')e.set('brush','G-Pen');
    else e.setTool(id);
    if(id==='fill')setMenu(menu==='fill'?'':'fill');else setMenu('');
  };
  const finishName=()=>{e?.setTitle(name);setEditing(false);};
  async function doExport(share){
    try{const blob=await e.artwork({reference:exportRef});const title=e.title.replace(/[\\/:*?"<>|]/g,'-');const mode=await exportFile(blob,`${title}.png`,share);setExporting(false);if(mode!=='android')notify(mode==='shared'?'Illustration shared':'PNG exported');}
    catch(err){if(err.name!=='AbortError')notify('Could not export this canvas');}
  }
  const isReady=e?.ready;
  return <section hidden={!active} className="workspace draw-workspace" aria-label="Draw workspace">
    <header className="editor-head">
      <IconButton icon={ArrowLeft} label="Back to home" onClick={()=>{flush();goHome();}}/>
      <div className="editor-title"><small>DRAW WORKSPACE</small>{editing?<input autoFocus value={name} aria-label="Project name" onChange={ev=>setName(ev.target.value)} onBlur={finishName} onKeyDown={ev=>{if(ev.key==='Enter')ev.target.blur();}}/>:<button className="editor-name" onClick={()=>{setName(e?.title||project.title);setEditing(true);}}>{e?.title||project.title}<Pencil size={11}/></button>}</div>
      <span className="save-indicator" title={status}><i className={status.startsWith('Not')?'not-saved':status.startsWith('Saving')?'saving':''}/><span>{status}</span></span>
      <div className="editor-spacer"/>
      <div className="head-group"><IconButton icon={Undo2} label="Undo" onClick={()=>e.undo()} disabled={!e?.undoStack.length}/><IconButton icon={Redo2} label="Redo" onClick={()=>e.redo()} disabled={!e?.redoStack.length}/></div>
      <div className="head-group end"><button className={`button secondary head-text ${reference?'mode-on':''}`} onClick={()=>setReference(v=>!v)} aria-label="Ref" title="Floating reference viewer"><Pin size={15}/><span>Ref</span></button><button className="button secondary head-text" aria-label="Open 3D Pose Studio" title="Open 3D Pose Studio" onClick={()=>{flush();goPose();}}><Box size={16}/><span>Pose</span></button><button className="button primary head-text" aria-label="Export PNG" title="Export PNG" onClick={()=>setExporting(true)} disabled={!isReady}><Download size={16}/><span>Export</span></button></div>
    </header>
    <div className="draw-tools" aria-label="Drawing tools">
      <div className="tool-group">{TOOLS.map(([Icon,label,id])=><IconButton key={id} icon={Icon} label={label} active={tool===id} aria-pressed={tool===id} disabled={!isReady} onClick={()=>chooseTool(id)}/>)}</div>
      <span className="tool-divider"/>
      <button type="button" className="brush-choice" aria-label={`Choose brush, current ${e?.brush||'G-Pen'}`} disabled={!isReady} onClick={()=>setMenu(menu==='brush'?'':'brush')}><Brush size={14}/><b>{e?.brush||'G-Pen'}</b><ChevronDown size={13}/></button>
      <button className="brush-color" title="Brush color" aria-label="Brush color" style={{'--color':e?.color||'#2d2539'}} onClick={()=>setColor(true)} disabled={!isReady}/>
      <IconButton icon={Settings2} label="Brush and fill settings" active={menu==='settings'||menu==='fill'} onClick={()=>setMenu(menu==='settings'?'':'settings')} disabled={!isReady}/>
      <div className="editor-spacer"/>
      <button className={`button secondary layers-toggle ${drawer?'mode-on':''}`} aria-label="Layers" aria-pressed={drawer} onClick={()=>setDrawer(!drawer)} disabled={!isReady}><Layers3 size={16}/><span>Layers</span></button>
    </div>
    <div className="draw-body">
      <aside className="left-strip" aria-label="Canvas controls">
        <Vertical label="Size" value={e?.size||11} min={1} max={250} display={`${e?.size||11}`} onChange={v=>e?.set('size',v)}/>
        <Vertical label="Opacity" value={Math.round((e?.opacity??1)*100)} min={0} max={100} display={`${Math.round((e?.opacity??1)*100)}%`} onChange={v=>e?.set('opacity',v/100)}/>
        <div className="left-break"/>
        <IconButton icon={FlipHorizontal2} label="Mirror symmetry ruler" active={e?.mirror} aria-pressed={!!e?.mirror} onClick={()=>e?.set('mirror',!e.mirror)}/>
        <IconButton icon={Grid3X3} label={`Guide: ${e?.guide||'Off'}`} active={e?.guide!=='Off'&&!!e?.guide} onClick={()=>e?.set('guide',GUIDES[(GUIDES.indexOf(e.guide)+1)%GUIDES.length])}/>
        <IconButton icon={Focus} label="Fit canvas" onClick={()=>e?.fit()}/>
        <IconButton icon={RotateCcw} label="Reset canvas rotation" onClick={()=>e?.resetRotation()}/>
        <IconButton icon={FlipVertical2} label="Flip view" active={e?.flipped} aria-pressed={!!e?.flipped} onClick={()=>e?.toggleFlip()}/>
      </aside>
      <div className="draw-stage" ref={stage} onClick={()=>{if(menu)setMenu('');}}>
        <canvas ref={view} className={`draw-viewport tool-${tool}`} aria-label="Illustration canvas" data-testid="draw-viewport"/>
        <canvas ref={overlay} className="draw-overlay" aria-hidden="true"/>
        {!isReady&&<div className="workspace-loading"><span className="loading-content">{!error&&<LoaderCircle className="spin" size={19}/>} {error||'Opening canvas…'}</span></div>}
        {isReady&&<div className="stage-label"><span>CANVAS</span><i/>{e.w} × {e.h} px</div>}
        {e?.guide&&e.guide!=='Off'&&<div className="stage-guide">{e.guide} guide</div>}
        {e?.selection&&!e.transform&&<div className="canvas-action" aria-label="Selection actions"><button onClick={()=>e.invertSelection()}><CircleDashed size={14}/> Invert</button><button onClick={()=>e.selectedAction(false)}><ClipboardCopy size={14}/> Copy→Layer</button><button onClick={()=>e.selectedAction(true)}><Scissors size={14}/> Cut</button><button onClick={()=>e.deselect()}><X size={14}/> Deselect</button></div>}
        {e?.cutBuffer&&!e.selection&&!e.transform&&<div className="canvas-action"><button onClick={()=>e.pasteCut()}><ClipboardCopy size={14}/> Paste as layer</button><button onClick={()=>{e.cutBuffer.width=1;e.cutBuffer=null;e.emit();}} aria-label="Clear studio clipboard"><X size={14}/></button></div>}
        {e?.transform&&<div className="canvas-action" aria-label="Transform actions"><button onClick={()=>e.transformOption('flipX')} title="Flip horizontally"><FlipHorizontal2 size={14}/> H</button><button onClick={()=>e.transformOption('flipY')} title="Flip vertically"><FlipVertical2 size={14}/> V</button><button onClick={()=>e.transformOption('reset')}><RotateCcw size={14}/> Reset</button><button onClick={()=>e.finishTransform(false)} aria-label="Cancel transform"><X size={14}/></button><button className="apply" onClick={()=>e.finishTransform(true)}><Check size={14}/> Apply</button></div>}
        {active&&reference&&<ReferenceViewer stage={stage} file={referenceFile} setFile={setReferenceFile} onPickColor={v=>e?.set('color',v)} onPhoto={onPhoto} close={()=>setReference(false)} notify={notify}/>}
      </div>
      {isReady&&<Layers e={e} open={drawer} close={()=>setDrawer(false)}/>}
      {drawer&&<button className="drawer-scrim" aria-label="Close layers drawer" onClick={()=>setDrawer(false)}/>}
    </div>
    <footer className="draw-foot"><span><i style={{background:e?.color||'#2d2539'}}/> {e?.color?.toUpperCase()||'#2D2539'}<b>·</b> {e?.brush||'G-Pen'}</span><span className="editor-hint">{e?.transform?'Drag layer · Pinch to scale & rotate':e?.selection?'Selection active · Tools stay inside the mask':'Two-finger tap to undo · Pinch to zoom'}</span><button onClick={()=>e?.fit()} title="Fit canvas">{isReady?pct(e.v.scale):'100%'} <Focus size={12}/></button></footer>
    {isReady&&menu==='brush'&&<div className="editor-popup brush-popup" aria-label="Brushes"><header><Brush size={15}/> Brushes<button onClick={()=>setMenu('')} aria-label="Close brushes"><X size={15}/></button></header>{['Lineart','Cel shading'].map(f=><div key={f}><div className="popup-category">{f}</div>{BRUSHES.map(({label,family,detail},i)=>{const Icon=BRUSH_ICONS[i];return family===f?<button className={`brush-option ${e.brush===label?'selected':''}`} key={label} onClick={()=>selectedBrush(label)}><span><Icon size={17}/></span><div><b>{label}</b><small>{detail}</small></div>{e.brush===label&&<Check size={13}/>}</button>:null;})}</div>)}</div>}
    {isReady&&(menu==='settings'||menu==='fill')&&<div className="editor-popup settings-popup"><header><Settings2 size={15}/> {menu==='fill'?'Fill options':'Tool settings'}<button onClick={()=>setMenu('')} aria-label="Close tool settings"><X size={15}/></button></header><div className="tool-settings">
      {menu!=='fill'&&<Range label="Stabilizer" value={e.stabilizer} onChange={n=>e.set('stabilizer',n)}/>}
      <Range label="Fill tolerance" value={e.tolerance} onChange={n=>e.set('tolerance',n)}/>
      <Toggle checked={e.sampleAll} onChange={v=>e.set('sampleAll',v)}>Sample all layers</Toggle>
      <Toggle checked={e.gap} onChange={v=>e.set('gap',v)}>Expand fill by 1 px</Toggle>
    </div></div>}
    {active&&color&&isReady&&<ColorPicker color={e.color} change={c=>e.set('color',c)} close={()=>setColor(false)}/>}
    {active&&exporting&&isReady&&<Modal title="Export illustration" subtitle={`${e.w} × ${e.h} px · PNG`} icon={Download} onClose={()=>setExporting(false)} footer={<><button className="button secondary" onClick={()=>doExport(true)}><Share2 size={15}/> Share PNG</button><button className="button primary" onClick={()=>doExport(false)}><Download size={15}/> Save PNG</button></>}><Toggle checked={exportRef} onChange={setExportRef} disabled={!e.ref.blob}>Include 3D pose reference</Toggle></Modal>}
  </section>;
});
export default Draw;
