import React, { useEffect, useRef, useState } from 'react';
import { GripHorizontal, ImagePlus, Maximize, Pin, Pipette, ScanLine, X } from 'lucide-react';
import { BlobImage, FileInput, IconButton } from '../ui';
import { canvas } from '../storage';
import { toHex } from './raster';
const sizes=['sm','md','lg'];

export default function ReferenceViewer({ stage, file, setFile, onPickColor, onPhoto, close, notify }) {
  const [size, setSize]=useState(1),[position,setPosition]=useState(null),[failed,setFailed]=useState(false);
  const input=useRef(null), win=useRef(null), drag=useRef(null), pixel=useRef(null);
  const choose=f=>{setFailed(false);setFile(f);};
  const bound=p=>{
    const a=stage.current?.getBoundingClientRect(),b=win.current?.getBoundingClientRect();
    if(!a||!b)return p;
    return {x:Math.min(Math.max(4,p.x),Math.max(4,a.width-b.width-4)),y:Math.min(Math.max(4,p.y),Math.max(4,a.height-b.height-4))};
  };
  useEffect(()=>{
    if(!stage.current)return;
    const ro=new ResizeObserver(()=>setPosition(old=>old?bound(old):null));ro.observe(stage.current);
    if(win.current)ro.observe(win.current);return()=>ro.disconnect();
  },[]);
  function start(e) {
    if(e.target.closest('button'))return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const a=stage.current.getBoundingClientRect(),b=win.current.getBoundingClientRect();
    drag.current={x:b.left-a.left,y:b.top-a.top,pX:e.clientX,pY:e.clientY};
  }
  function move(e) {if(drag.current&&e.currentTarget.hasPointerCapture(e.pointerId))setPosition(bound({x:drag.current.x+e.clientX-drag.current.pX,y:drag.current.y+e.clientY-drag.current.pY}));}
  function sample(e) {
    const im=e.currentTarget,b=im.getBoundingClientRect();
    if(!im.naturalWidth)return;
    const s=Math.min(b.width/im.naturalWidth,b.height/im.naturalHeight),w=im.naturalWidth*s,h=im.naturalHeight*s;
    const x=(e.clientX-b.left-(b.width-w)/2)/s,y=(e.clientY-b.top-(b.height-h)/2)/s;
    if(x<0||y<0||x>=im.naturalWidth||y>=im.naturalHeight)return;
    pixel.current??=canvas(1,1).getContext('2d',{willReadFrequently:true});
    const p=pixel.current;p.clearRect(0,0,1,1);p.drawImage(im,Math.floor(x),Math.floor(y),1,1,0,0,1,1);
    const rgba=p.getImageData(0,0,1,1).data;
    if(rgba[3]){const color=toHex(rgba);onPickColor(color);notify(`Picked ${color.toUpperCase()} from reference`);}
  }
  return <section ref={win} className={`floating-ref ref-${sizes[size]}`} aria-label="Reference viewer" style={position?{left:position.x,top:position.y,right:'auto'}:undefined}>
    <header onPointerDown={start} onPointerMove={move} onPointerUp={()=>drag.current=null} onPointerCancel={()=>drag.current=null}>
      <Pin size={13}/><strong>Reference</strong><GripHorizontal className="ref-grip" size={15}/>
      <IconButton icon={Maximize} label={`Viewer size ${sizes[size]}; change size`} onClick={()=>setSize((size+1)%3)}/><IconButton icon={X} label="Close reference viewer" onClick={close}/>
    </header>
    <FileInput inputRef={input} accept="image/*" label="Reference image file" onPick={choose}/>
    {file&&!failed?<><BlobImage blob={file} className="ref-image" alt="Reference image · tap to sample a color" onClick={sample} onError={()=>{setFailed(true);notify('This image could not be opened');}}/><footer><span><Pipette size={12}/> Tap to pick</span><IconButton icon={ImagePlus} label="Replace reference image" onClick={()=>input.current?.click()}/><IconButton icon={ScanLine} label="Copy 3D pose from reference" onClick={()=>onPhoto(file)}/></footer></>:
      <button className="ref-empty" onClick={()=>input.current?.click()}><ImagePlus size={23}/><strong>{failed?'Choose another image':'Open an image'}</strong><span>Pick colors from your reference</span></button>}
  </section>;
}
