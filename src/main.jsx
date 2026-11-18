import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bell, LoaderCircle, Pencil, Trash2, X } from 'lucide-react';
import '@fontsource-variable/inter';
import '@fontsource-variable/outfit';
import Home, { CustomCanvas } from './Home';
import Draw from './draw/Draw';
import { initialPose } from './pose/data';
import { IconButton, Modal } from './ui';
import { asset, getProject, listProjects, makeProject, putProject, removeProject, SAMPLES, seedProjects, uid } from './storage';
import './studio.css';
import './workspace.css';

const Pose=lazy(()=>import('./pose/Pose'));
const PhotoPose=lazy(()=>import('./pose/Photo'));

function App(){
  const [route,setRoute]=useState('home'),[projects,setProjects]=useState(SAMPLES),[project,setProject]=useState(null),[poseStarted,setPoseStarted]=useState(false),[fromDraw,setFromDraw]=useState(false),[poseReady,setPoseReady]=useState(false),[poseKey,setPoseKey]=useState('standalone'),[poseDoc,setPoseDoc]=useState(null),[modal,setModal]=useState(null),[photo,setPhoto]=useState(null),[referenceFile,setReferenceFile]=useState(null),[busy,setBusy]=useState(false),[toast,setToast]=useState('');
  const draw=useRef(null),pose=useRef(null),timer=useRef(null),creating=useRef(false),recentPose=useRef(null),recordRef=useRef(null),nativeBack=useRef(null);
  const home=route==='home'||route==='gallery';
  const notify=text=>{setToast(text);clearTimeout(timer.current);timer.current=setTimeout(()=>setToast(''),3600);};
  const updateList=record=>{setProjects(current=>[record,...current.filter(p=>p.id!==record.id)]);};
  const onSaved=record=>{if(recordRef.current?.id===record.id)recordRef.current=record;updateList(record);};
  useEffect(()=>{
    let done=false;
    async function refresh(){try{await seedProjects();const items=await listProjects();if(!done)setProjects(items);}catch{if(!done)notify('Local gallery could not be loaded.');}}
    refresh();
    const status=e=>{if(e.detail?.message)notify(e.detail.message);};
    window.addEventListener('komaexport',status);
    window.komaBack=()=>nativeBack.current?.()||false;
    return()=>{done=true;clearTimeout(timer.current);window.removeEventListener('komaexport',status);delete window.komaBack;};
  },[]);
  async function open(record){
    await draw.current?.flush();
    let item=record;
    try{if(!item.layers){await seedProjects();item=await getProject(item.id);}}catch{notify('This project is not available');return;}
    if(!item)return notify('Project not found');
    if(recordRef.current?.id!==item.id){recordRef.current=item;setProject(item);setReferenceFile(null);}
    try{localStorage.setItem('koma-last-project',item.id);}catch{}
    setRoute('draw');setModal(null);
  }
  async function create(options={}, quick=false){
    if(creating.current)return;
    creating.current=true;setBusy(true);
    try{
      if(quick){
        const res=await fetch(asset('figures/starter-ref.png'));
        if(res.ok){options.pose=initialPose();options.reference={blob:await res.blob(),opacity:.33,visible:true,blue:true,above:false};}
      }
      const item=makeProject(options);await putProject(item);updateList(item);await open(item);
    }catch{notify('Could not create a local project. Check device storage.');}
    finally{creating.current=false;setBusy(false);}
  }
  function startPose(associated, file){
    const nextKey=associated?`project:${recordRef.current?.id}`:'standalone';
    if(nextKey!==poseKey||!poseStarted){setPoseReady(false);setPoseDoc(associated?recordRef.current?.pose:recentPose.current);setPoseKey(nextKey);}
    setFromDraw(associated);setPoseStarted(true);setRoute('pose');
    if(file!==undefined)setPhoto({file});
  }
  function poseChange(state){
    if(fromDraw)draw.current?.updatePose(state);else recentPose.current=state;
  }
  async function usePose(reference,state){
    if(fromDraw&&draw.current&&project){await draw.current.bakeReference(reference,state);setRoute('draw');}
    else await create({reference,pose:state});
    notify('Pose added to the reference layer');
  }
  async function galleryAction(name,p){
    switch(name){
      case 'home': case 'gallery': setRoute(name);break;
      case 'custom': setModal({type:'custom'});break;
      case 'quick': await create({},true);break;
      case 'resume': {
        let last;try{last=localStorage.getItem('koma-last-project');}catch{}
        const item=projects.find(p=>p.id===last)||[...projects].sort((a,b)=>b.date-a.date)[0];
        if(item)await open(item);else await create({},true);break;
      }
      case 'pose': startPose(false);break;
      case 'photo': startPose(false,null);break;
      case 'open': await open(p);break;
      case 'duplicate':{
        try{await seedProjects();const item=await getProject(p.id);if(!item)throw Error();const copy={...item,id:uid(),title:`${item.title} copy`,date:Date.now()};await putProject(copy);updateList(copy);notify('Project duplicated');}catch{notify('Could not duplicate project');}break;
      }
      case 'rename':case 'delete': setModal({type:name,item:p});break;
    }
  }
  function homeBack(){draw.current?.flush();setRoute('home');}
  nativeBack.current=()=>{
    if(photo){setPhoto(null);return true;}
    if(modal){setModal(null);return true;}
    if(document.querySelector('[aria-modal=true]')){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true;}
    if(route==='pose'&&fromDraw){setRoute('draw');return true;}
    if(route!=='home'){homeBack();return true;}
    return false;
  };
  async function projectAction(title){
    const {type,item}=modal;
    try{
      await draw.current?.flush();await seedProjects();const record=await getProject(item.id);if(!record)throw Error();
      if(type==='delete'){await removeProject(item.id);setProjects(current=>current.filter(p=>p.id!==item.id));if(project?.id===item.id){recordRef.current=null;setProject(null);setPoseKey(`standalone:${uid()}`);}notify('Project deleted');}
      else{const next={...record,title,date:Date.now()};await putProject(next);updateList(next);if(project?.id===item.id){recordRef.current=null;setProject(null);}notify('Project renamed');}
      setModal(null);
    }catch{notify('Could not update this project');}
  }
  return <>
    {home&&<Home action={galleryAction} page={route} projects={projects} busy={busy}/>}
    {project&&<Draw key={project.id} ref={draw} project={project} active={route==='draw'} goHome={homeBack} goPose={()=>startPose(true)} onPhoto={file=>startPose(true,file)} referenceFile={referenceFile} setReferenceFile={setReferenceFile} notify={notify} onSaved={onSaved}/>}
    {poseStarted&&<Suspense fallback={route==='pose'?<div className="workspace-loading"><span className="loading-content"><LoaderCircle className="spin" size={20}/> Opening Pose Studio…</span></div>:null}>
      <Pose ref={pose} active={route==='pose'} projectKey={poseKey} projectPose={poseDoc} readyChange={setPoseReady} onHome={homeBack} onDraw={()=>setRoute('draw')} canInk={fromDraw&&project?{aspect:project.w/project.h}:null} getInk={()=>draw.current?.getInk()} onUse={usePose} openPhoto={()=>setPhoto({file:null})} onChange={poseChange} notify={notify}/>
    </Suspense>}
    {modal?.type==='custom'&&<CustomCanvas onClose={()=>setModal(null)} onCreate={options=>create(options)}/>}
    {modal?.type==='rename'&&<Rename key={modal.item.id} item={modal.item} close={()=>setModal(null)} save={projectAction}/>}
    {modal?.type==='delete'&&<Modal title="Delete project?" subtitle={`“${modal.item.title}” will be removed from this device. This cannot be undone.`} icon={Trash2} onClose={()=>setModal(null)} footer={<><button className="button secondary" onClick={()=>setModal(null)}>Cancel</button><button className="button danger" onClick={()=>projectAction()}>Delete project</button></>}/>}
    {photo&&<Suspense fallback={<div className="modal-shade"><div className="loading-content"><LoaderCircle className="spin" size={19}/> Opening photo tool…</div></div>}> <PhotoPose initialFile={photo.file} close={()=>setPhoto(null)} canApply={poseReady} apply={(...args)=>pose.current?.applyPhoto(...args)}/> </Suspense>}
    {toast&&<div className="toast" role="status"><Bell size={15}/><span>{toast}</span><IconButton icon={X} label="Dismiss message" onClick={()=>setToast('')}/></div>}
  </>;
}
function Rename({item,close,save}){
  const [value,setValue]=useState(item.title);
  return <Modal title="Rename project" icon={Pencil} onClose={close} footer={<><button className="button secondary" onClick={close}>Cancel</button><button form="new-name" className="button primary" disabled={!value.trim()}>Save name</button></>}><form id="new-name" onSubmit={e=>{e.preventDefault();if(value.trim())save(value.trim());}}><input aria-label="New project name" value={value} maxLength={100} onChange={e=>setValue(e.target.value)}/></form></Modal>;
}

createRoot(document.getElementById('root')).render(<App/>);
if(import.meta.env.PROD&&!window.KomaAndroid&&'serviceWorker' in navigator){
  addEventListener('load',()=>navigator.serviceWorker.register(asset('studio-sw.js')).catch(()=>{}),{once:true});
}
