import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ImagePlus, LoaderCircle, ScanLine, ShieldCheck } from 'lucide-react';
import { FileInput, Modal, Toggle } from '../ui';
import { asset } from '../storage';

export default function PhotoPose({ initialFile, close, apply, canApply }) {
  const input=useRef(null),preview=useRef(null),version=useRef(0),vision=useRef(null);
  const [data,setData]=useState(null),[name,setName]=useState(''),[status,setStatus]=useState(''),[error,setError]=useState(''),[mirror,setMirror]=useState(false),[hands,setHands]=useState(true);
  async function analyze(file, label=file.name||'Reference image'){
    const token=++version.current;
    setName(label);setError('');setData(null);setStatus('Preparing photo…');
    const progress=text=>{if(version.current===token)setStatus(text);};
    try {
      if(file.size>36*1024*1024)throw new Error('Choose an image under 36 MB.');
      vision.current??=await import('./vision');
      const result=await vision.current.detectPhoto(file,progress);
      if(version.current===token){setData(result);setStatus('');}
    }catch(e){if(version.current===token){setStatus('');setError(e.message?.includes('No full-body')||e.message?.includes('36 MB')?e.message:'Could not analyze this image. Try a JPEG, PNG, or WebP photo with a clear full-body view.');}}
  }
  useEffect(()=>{if(initialFile)analyze(initialFile);return()=>{version.current++;};},[]);
  useEffect(()=>{if(data&&preview.current)vision.current.renderPreview(preview.current,data,hands,mirror);},[data,hands,mirror]);
  async function sample(){try{const res=await fetch(asset('art/pose-example.webp'));if(!res.ok)throw Error();await analyze(await res.blob(),'Studio sample');}catch{setError('The bundled sample could not be loaded.');}}
  function usePose(){try{apply(data,{mirror,hands});close();}catch(e){setError(e.message||'Could not apply the pose to this figure.');}}
  return <Modal className="large photo-modal" title="Copy Pose from Image" subtitle="Turn a full-body photo into an editable figure pose." icon={ScanLine} onClose={close}
    footer={<><button className="button secondary" onClick={close}>Cancel</button><button className="button primary" onClick={usePose} disabled={!data||!canApply}><Check size={16}/> Apply pose <ArrowRight size={15}/></button></>}>
    <FileInput inputRef={input} accept="image/*" label="Pose photo file" onPick={analyze}/>
    {data?<>
      <div className="photo-preview"><canvas ref={preview} data-testid="skeleton-preview" aria-label="Detected body and hand landmark preview"/></div>
      <div className="photo-result"><span><i/> Body detected <b>·</b> {data.hands.length} {data.hands.length===1?'hand':'hands'} found</span><button className="chip" onClick={()=>input.current?.click()}><ImagePlus size={13}/> Replace</button></div>
      {!canApply&&<p className="photo-privacy">A loaded humanoid figure is needed to apply this pose.</p>}
    </>:<button className="photo-drop" disabled={!!status} onClick={()=>input.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!status&&e.dataTransfer.files[0])analyze(e.dataTransfer.files[0]);}}>
      {status?<LoaderCircle size={27} className="spin"/>:<ImagePlus size={28}/>}<strong>{status||'Choose a photo'}</strong><span>{status?name:'Select an image from this device'}</span>
    </button>}
    {error&&<p role="alert" className="inline-error">{error}</p>}
    <div className="photo-options"><Toggle checked={mirror} onChange={setMirror}>Mirror L⇄R</Toggle><Toggle checked={hands} onChange={setHands}>Hands</Toggle></div>
    <div className="photo-privacy"><ShieldCheck size={14}/><span>Runs offline. Your image stays on this device.</span>{!data&&<button onClick={sample} disabled={!!status}>Try sample</button>}</div>
  </Modal>;
}
