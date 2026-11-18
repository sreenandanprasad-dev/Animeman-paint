import { canvas, imageFrom, png, uid } from '../storage';
import { brushRadius, clamp, mid, scanlineMask, splitRGBA, toHex } from './raster';

export const BRUSHES = [
  { label: 'G-Pen', family: 'Lineart', detail: 'Pressure-tapered ink', size: 11 },
  { label: 'Maru', family: 'Lineart', detail: 'Fine, rounded linework', size: 6 },
  { label: 'Pencil', family: 'Lineart', detail: 'Grain for sketching', size: 10 },
  { label: 'Eraser', family: 'Lineart', detail: 'Lift pigment', size: 35 },
  { label: 'Cel Block', family: 'Cel shading', detail: 'Hard-edge, flat coverage', size: 60 },
  { label: 'Cel Wedge', family: 'Cel shading', detail: 'Speed-tapered blades', size: 54 },
  { label: 'Cel Soft', family: 'Cel shading', detail: 'Feathered ambient color', size: 110 },
  { label: 'Rim Glow', family: 'Cel shading', detail: 'White core and bloom', size: 34 },
];
export const BLENDS = [['source-over','Normal'],['multiply','Multiply'],['lighter','Add Glow'],['screen','Screen'],['overlay','Overlay']];
const MAX_LAYERS=10, MAX_HISTORY=28, HISTORY_BYTES=72*1024*1024;
const ctx = c => c.getContext('2d');
const reset = c => { c.setTransform(1,0,0,1,0,0); c.globalAlpha=1; c.globalCompositeOperation='source-over'; };
const clear = c => { reset(c); c.clearRect(0,0,c.canvas.width,c.canvas.height); };
const dispose = c => { if(c) { c.width=1; c.height=1; } };
const angleNorm = theta => Math.atan2(Math.sin(theta), Math.cos(theta));
const average = points => ({ x: points.reduce((a,b)=>a+b.x,0)/points.length, y: points.reduce((a,b)=>a+b.y,0)/points.length });
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const emptyRect = () => ({ x0:Infinity,y0:Infinity,x1:-Infinity,y1:-Infinity });
const hasRect = r => r.x1>r.x0 && r.y1>r.y0;
function union(a,b) { return { x0:Math.min(a.x0,b.x0), y0:Math.min(a.y0,b.y0), x1:Math.max(a.x1,b.x1), y1:Math.max(a.y1,b.y1) }; }
function portion(dst, src, r, x=r.x0, y=r.y0) {
  const w=r.x1-r.x0,h=r.y1-r.y0;
  if(w>0 && h>0) dst.drawImage(src,r.x0,r.y0,w,h,x,y,w,h);
}
const region = r => [r.x0,r.y0,r.x1-r.x0,r.y1-r.y0];
const baseLayer = (name='Layer') => ({ id:uid(),name,visible:true,opacity:1,blend:'source-over',alphaLock:false,clip:false,png:null });

export class DrawingEngine {
  constructor(stage, viewport, overlay, record, events) {
    this.stage=stage; this.viewport=viewport; this.overlay=overlay;
    this.viewCtx=ctx(viewport); this.overlayCtx=ctx(overlay);
    this.events=events; this.record=record; this.w=record.w; this.h=record.h;
    this.layers=[]; this.activeId=null; this.undoStack=[]; this.redoStack=[]; this.revision=0;
    this.paper=record.paper; this.pose=record.pose;
    this.ref={ visible:true,opacity:.32,blue:true,above:false,...record.reference,bitmap:null };
    this.tool='brush'; this.brush='G-Pen'; this.size=11; this.opacity=1; this.color='#2d2539'; this.stabilizer=26;
    this.tolerance=20; this.gap=true; this.sampleAll=true; this.mirror=false; this.guide='Off'; this.flipped=false;
    this.v={ x:0,y:0,scale:1,angle:0 }; this.bounds={ w:0,h:0,dpr:1 }; this.paused=true;
    this.pointers=new Map(); this.gesture=null; this.selection=null; this.selecting=null;
    this.snapshots=new Map(); this.handlers=[];
    this.resizeObserver=new ResizeObserver(() => this.resize()); this.resizeObserver.observe(stage);
    for (const [name, func] of [['pointerdown',this.down],['pointermove',this.move],['pointerup',this.up],['pointercancel',this.cancelPointer],['lostpointercapture',this.cancelPointer],['wheel',this.wheel],['contextmenu',e=>e.preventDefault()]]) {
      const fn=func.bind(this); viewport.addEventListener(name,fn,{ passive:false }); this.handlers.push([name,fn]);
    }
    this.pixel=canvas(1,1).getContext('2d',{ willReadFrequently:true });  // Only this dedicated readback surface is CPU-oriented.
    this.title=record.title;
  }
  async init() {
    const surfaces=await Promise.all(this.record.layers.map(async meta => {
      let bitmap=null;
      if(meta.png) bitmap=await imageFrom(meta.png);
      if(this.dead) { bitmap?.close?.(); return null; }
      const c=canvas(this.w,this.h);
      if(bitmap) {ctx(c).drawImage(bitmap,0,0);bitmap.close?.();}
      return { ...meta,c,rev:0 };
    }));
    if(this.dead) { surfaces.forEach(l=>dispose(l?.c));return; }
    this.layers=surfaces;
    if(!this.layers.length) this.layers.push({...baseLayer('Lineart'), c:canvas(this.w,this.h),rev:0});
    this.activeId=this.layers.some(l=>l.id===this.record.activeId)?this.record.activeId:this.layers.at(-1).id;
    for(const key of ['belowCache','aboveCache','merged','strokeCanvas','activeCache']) this[key]=canvas(this.w,this.h);
    this.strokeCtx=ctx(this.strokeCanvas);
    if(this.ref.blob) {
      const bitmap=await imageFrom(this.ref.blob);
      if(this.dead) { bitmap.close?.();return; }
      this.ref.bitmap=bitmap;
    }
    this.ready=true; this.resize(); this.rebuild(); this.emit();
  }
  destroy() {
    this.dead=true; this.paused=true; cancelAnimationFrame(this.frame); clearTimeout(this.hold); clearTimeout(this.ants);
    this.resizeObserver.disconnect();
    for(const [name,fn] of this.handlers) this.viewport.removeEventListener(name,fn);
    this.ref.bitmap?.close?.();
    for(const l of this.layers) dispose(l.c);
    for(const key of ['belowCache','aboveCache','merged','strokeCanvas','activeCache','group','clipTemp','clipPreview','refBlue','cutBuffer','checker','clipPreviewTemp']) dispose(this[key]);
    for(const h of [...this.undoStack,...this.redoStack]) h.release?.();
    this.snapshots.clear();
  }
  get layer() { return this.layers.find(l=>l.id===this.activeId); }
  get full() {return {x0:0,y0:0,x1:this.w,y1:this.h};}
  emit() { if(!this.dead) this.events.change?.(); }
  changed() { if(this.dead) return; this.revision++; this.events.dirty?.(); this.emit(); }
  setPaused(paused) {
    if(this.paused===paused) return;
    this.paused=paused;
    if(paused) {
      this.abortPointer(); cancelAnimationFrame(this.frame); this.frame=0; clearTimeout(this.ants); this.ants=0;
    } else { this.resize(); this.request(); }
  }
  resize() {
    if(this.paused || this.dead) return;
    const { width:w,height:h }=this.stage.getBoundingClientRect();
    if(w<1||h<1) return;
    const was=this.bounds, dpr=Math.min(devicePixelRatio||1,1.5);
    if(was.w===w&&was.h===h&&was.dpr===dpr)return;
    this.bounds={w,h,dpr};
    for(const c of [this.viewport,this.overlay]) { c.width=Math.round(w*dpr);c.height=Math.round(h*dpr); }
    if(!was.w) this.fit(false);
    else if(this.viewFitted) this.fit(false);
    this.request();
  }
  fit(notify=true) {
    const w=this.bounds.w,h=this.bounds.h,g=w<500?22:33;
    this.v={x:0,y:0,angle:0,scale:Math.max(.035,Math.min((w-g*2)/this.w,(h-g*2)/this.h,2))};
    this.viewFitted=true; if(notify){this.request();this.emit();}
  }
  set(option,value) {
    if(option==='brush'&&this.transform)this.finishTransform(false);
    this[option]=value;
    if(option==='brush') {this.tool='brush';this.size=BRUSHES.find(b=>b.label===value)?.size || 11;}
    this.request();this.emit();
  }
  toggleFlip() {this.flipped=!this.flipped;this.request();this.emit();}
  resetRotation() {this.v.angle=0;this.request();this.emit();}
  setTitle(title) { title=title.trim().slice(0,100); if(title&&title!==this.title){this.title=title;this.changed();} }
  setTool(tool) {
    if(tool!=='transform'&&this.transform) this.finishTransform(false);
    this.tool=tool;
    if(tool==='transform'&&!this.transform) this.startTransform();
    this.emit();this.request();
  }
  reserveHistory(change) {
    this.redoStack.forEach(item=>item.release?.());this.redoStack=[];
    this.undoStack.push(change);
    let bytes=this.undoStack.reduce((sum,h)=>sum+(h.bytes||0),0);
    while(this.undoStack.length>1&&(this.undoStack.length>MAX_HISTORY||bytes>HISTORY_BYTES)) {
      const removed=this.undoStack.shift(); bytes-=removed.bytes||0;removed.release?.();
    }
  }
  edit(change) { change.redo(); this.reserveHistory(change); this.rebuild(); this.changed(); }
  undo() {
    if(this.transform)this.finishTransform(false);
    const h=this.undoStack.pop(); if(!h)return;
    h.undo();this.redoStack.push(h);this.rebuild();this.changed();
  }
  redo() {
    if(this.transform)this.finishTransform(false);
    const h=this.redoStack.pop();if(!h)return;
    h.redo();this.undoStack.push(h);this.rebuild();this.changed();
  }
  historyPixels(layer,r) {
    if(!hasRect(r))return null;
    const patch=canvas(r.x1-r.x0,r.y1-r.y0);portion(ctx(patch),layer.c,r,0,0);
    let held=patch;
    const swap=()=>{
      const next=canvas(r.x1-r.x0,r.y1-r.y0), lc=ctx(layer.c);
      portion(ctx(next),layer.c,r,0,0); reset(lc);lc.clearRect(...region(r));lc.drawImage(held,r.x0,r.y0);
      dispose(held);held=next;layer.rev++;
    };
    return {undo:swap, redo:swap, bytes:patch.width*patch.height*4,release:()=>dispose(held)};
  }
  layerMeta(id, field,value, live=false) {
    const l=this.layers.find(l=>l.id===id);if(!l||l[field]===value)return;
    if(live) {l[field]=value;this.rebuild();this.emit();return;}
    const previous=l[field];
    this.edit({ undo:()=>{l[field]=previous;}, redo:()=>{l[field]=value;} });
  }
  beginLayerMeta(id,field) {
    if(!this.metaEdit) { const l=this.layers.find(l=>l.id===id); if(l) this.metaEdit={l,field,old:l[field]}; }
  }
  endLayerMeta() {
    if(!this.metaEdit)return;
    const {l,field,old}=this.metaEdit;this.metaEdit=null;const value=l[field];
    if(old===value)return;
    this.reserveHistory({undo:()=>{l[field]=old;},redo:()=>{l[field]=value;}});this.changed();
  }
  chooseLayer(id) { if(!this.layers.some(l=>l.id===id)||id===this.activeId)return; if(this.transform)this.finishTransform(false);this.activeId=id;this.rebuild();this.changed(); }
  replaceLayers(next,activeId=this.activeId,bytes=0) {
    if(this.transform)this.finishTransform(false);
    const prev=this.layers, oldId=this.activeId;
    this.edit({undo:()=>{this.layers=prev;this.activeId=oldId;},redo:()=>{this.layers=next;this.activeId=activeId;},bytes});
  }
  addLayer(name='Layer', image) {
    if(this.layers.length>=MAX_LAYERS)return this.events.notify?.('The layer limit is 10');
    const c=image || canvas(this.w,this.h);
    const l={...baseLayer(name==='Layer'?`Layer ${this.layers.length+1}`:name),c,rev:1};
    const next=this.layers.slice();next.splice(Math.max(0,this.layers.indexOf(this.layer)+1),0,l);this.replaceLayers(next,l.id,this.w*this.h*4);return l;
  }
  duplicateLayer() {
    const l=this.layer;if(!l)return;
    if(this.layers.length>=MAX_LAYERS)return this.events.notify?.('The layer limit is 10');
    const c=canvas(this.w,this.h);ctx(c).drawImage(l.c,0,0);const newL={...l,id:uid(),c,png:null,rev:1,name:`${l.name} copy`};
    const next=this.layers.slice();next.splice(next.indexOf(l)+1,0,newL);this.replaceLayers(next,newL.id,this.w*this.h*4);
  }
  moveLayer(dir) {
    const i=this.layers.indexOf(this.layer), next=this.layers.slice();if(i<0||i+dir<0||i+dir>=next.length)return;
    [next[i],next[i+dir]]=[next[i+dir],next[i]];this.replaceLayers(next);
  }
  deleteLayer() {
    if(this.layers.length===1)return this.events.notify?.('Keep at least one drawing layer');
    const i=this.layers.indexOf(this.layer),next=this.layers.slice();next.splice(i,1);this.replaceLayers(next,next[Math.max(0,i-1)].id,this.w*this.h*4);
  }
  clearLayer() {
    const l=this.layer;if(!l)return;
    const history=this.historyPixels(l,this.full);clear(ctx(l.c));l.rev++;this.reserveHistory(history);this.rebuild();this.changed();
  }
  mergeDown() {
    const i=this.layers.indexOf(this.layer);if(i<=0)return;
    const bottom=this.layers[i-1],top=this.layers[i],c=canvas(this.w,this.h);
    this.compositeStack(ctx(c),[bottom,top]);
    const combined={...bottom,name:bottom.name,visible:bottom.visible||top.visible,opacity:1,blend:bottom.blend,alphaLock:false,c,png:null,rev:bottom.rev+1};
    const next=this.layers.slice();next.splice(i-1,2,combined);this.replaceLayers(next,combined.id,this.w*this.h*8);
  }
  changePaper(color) { if(color===this.paper)return;const old=this.paper;this.edit({undo:()=>{this.paper=old;},redo:()=>{this.paper=color;}}); }
  setReferenceMeta(key,value) { this.ref[key]=value;this.rebuild();this.changed(); }
  async setReference(reference, pose) {
    const bitmap=reference?.blob ? await imageFrom(reference.blob) : null;
    if(this.dead){bitmap?.close?.();return;}
    this.ref.bitmap?.close?.();dispose(this.refBlue);this.refBlue=null;
    this.ref={visible:true,opacity:.32,blue:true,above:false,...reference,bitmap};
    if(pose!==undefined)this.pose=pose;
    this.rebuild();this.changed();
  }
  setPose(pose) { this.pose=pose;this.changed(); }
  drawPaper(dest) { if(this.paper!=='transparent'){dest.fillStyle=this.paper;dest.fillRect(0,0,this.w,this.h);} }
  drawReference(dest) {
    const r=this.ref;if(!r.visible||!r.bitmap)return;
    let source=r.bitmap;
    if(r.blue) {
      if(!this.refBlue) {
        this.refBlue=canvas(source.width,source.height);const p=ctx(this.refBlue);
        p.drawImage(source,0,0);
        // Preserve the silhouette and lighting, then shift the existing colors toward non-photo blue.
        p.globalCompositeOperation='source-atop';p.fillStyle='#2285dd9e';p.fillRect(0,0,p.canvas.width,p.canvas.height);
      }
      source=this.refBlue;
    }
    const s=Math.min(this.w/source.width,this.h/source.height)*.87,w=source.width*s,h=source.height*s;
    dest.save();dest.globalAlpha=r.opacity;dest.globalCompositeOperation='source-over';dest.drawImage(source,(this.w-w)*.5,(this.h-h)*.5,w,h);dest.restore();
  }
  compositeStack(dest,layers, sub=null) {
    for(let i=0;i<layers.length;i++) {
      const l=layers[i];if(!l.visible||l.opacity<=0)continue;
      const src=l.id===this.activeId&&sub?sub:l.c;
      const clipped=[];
      for(let j=i+1;j<layers.length&&layers[j].clip;j++)if(layers[j].visible&&layers[j].opacity>0)clipped.push(layers[j]);
      const hasBelow= i>0 || layers===this.layers && this.layers.indexOf(l)>0;
      if(l.clip&&hasBelow)continue;
      if(clipped.length) {
        this.group??=canvas(this.w,this.h);const gc=ctx(this.group);clear(gc);gc.drawImage(src,0,0);
        for(const q of clipped) {
          const cs=q.id===this.activeId&&sub?sub:q.c;
          if(q.blend==='source-over') {gc.globalCompositeOperation='source-atop';gc.globalAlpha=q.opacity;gc.drawImage(cs,0,0);}
          else {
            this.clipTemp??=canvas(this.w,this.h);const t=ctx(this.clipTemp);clear(t);t.drawImage(this.group,0,0);
            t.globalCompositeOperation=q.blend;t.globalAlpha=q.opacity;t.drawImage(cs,0,0);
            gc.globalAlpha=1;gc.globalCompositeOperation='source-atop';gc.drawImage(this.clipTemp,0,0);
          }
        }
        dest.globalAlpha=l.opacity;dest.globalCompositeOperation=l.blend;dest.drawImage(this.group,0,0);
      } else {dest.globalAlpha=l.opacity;dest.globalCompositeOperation=l.blend;dest.drawImage(src,0,0);}
      while(i+1<layers.length&&layers[i+1].clip)i++;
    }
    reset(dest);
  }
  updateClipPreview(r) {
    if((this.previewGroup?.length??0)<2)return;
    const [base,...clipped]=this.previewGroup;
    if(!base.visible)return;
    this.clipPreview??=canvas(this.w,this.h);
    const d=ctx(this.clipPreview),src=l=>l.id===this.activeId?this.activeCache:l.c;
    reset(d);d.clearRect(...region(r));portion(d,src(base),r);
    for(const l of clipped) {
      if(!l.visible||l.opacity<=0)continue;
      if(l.blend==='source-over') {d.globalCompositeOperation='source-atop';d.globalAlpha=l.opacity;portion(d,src(l),r);}
      else {
        this.clipPreviewTemp??=canvas(this.w,this.h);
        const t=ctx(this.clipPreviewTemp);reset(t);t.clearRect(...region(r));portion(t,this.clipPreview,r);
        t.globalCompositeOperation=l.blend;t.globalAlpha=l.opacity;portion(t,src(l),r);
        d.globalAlpha=1;d.globalCompositeOperation='source-atop';portion(d,this.clipPreviewTemp,r);
      }
    }
    reset(d);
  }
  rebuild() {
    if(!this.ready)return;
    const pivot=this.layers.indexOf(this.layer);
    let first=Math.max(0,pivot),end=first+1;
    while(first>0&&this.layers[first].clip)first--;
    while(this.layers[end]?.clip)end++;
    // A clipping group is composited as the active layer. During pointer motion only its dirty region is touched.
    this.previewGroup=this.layers.slice(first,end);
    for(const c of [this.belowCache,this.aboveCache,this.merged,this.activeCache]) clear(ctx(c));
    const below=ctx(this.belowCache),above=ctx(this.aboveCache),merge=ctx(this.merged);
    this.drawPaper(below); this.drawPaper(merge);
    if(!this.ref.above){this.drawReference(below);this.drawReference(merge);}
    this.compositeStack(below,this.layers.slice(0,first));
    // The above preview is a static atlas. Exact backdrop-dependent blending is applied at commit.
    this.compositeStack(above,this.layers.slice(end));
    if(this.ref.above)this.drawReference(above);
    this.compositeStack(merge,this.layers);
    if(this.ref.above)this.drawReference(merge);
    if(this.layer)ctx(this.activeCache).drawImage(this.layer.c,0,0);
    if(this.transform)this.updateTransform();else this.updateClipPreview(this.full);
    this.request();
  }
  docTransform(c) {
    const {w,h,dpr}=this.bounds,{x,y,angle,scale}=this.v;
    c.setTransform(dpr,0,0,dpr,0,0);c.translate(w/2+x,h/2+y);c.rotate(angle);c.scale(scale*(this.flipped?-1:1),scale);c.translate(-this.w/2,-this.h/2);
  }
  toDoc(pt) {
    const {w,h}=this.bounds,{x,y,angle,scale}=this.v;
    const a=(pt.x-w/2-x)/scale,b=(pt.y-h/2-y)/scale,cos=Math.cos(angle),sin=Math.sin(angle);
    return {...pt,x:(a*cos+b*sin)*(this.flipped?-1:1)+this.w/2,y:-a*sin+b*cos+this.h/2};
  }
  toStage(e,b=this.viewport.getBoundingClientRect()) {return {x:e.clientX-b.left,y:e.clientY-b.top,p:e.pointerType==='pen'?clamp(e.pressure||.11,.05,1):.68,t:e.timeStamp||performance.now()}; }
  request() {
    if(this.paused||this.frame||!this.ready||this.dead)return;
    this.frame=requestAnimationFrame(t=>{this.frame=0;this.render(t);});
  }
  render(time) {
    if(this.paused||!this.ready)return;
    const vc=this.viewCtx;clear(vc);vc.save();this.docTransform(vc);
    if(this.paper==='transparent') {
      if(!this.checker){this.checker=canvas(32,32);const cc=ctx(this.checker);cc.fillStyle='#454457';cc.fillRect(0,0,32,32);cc.fillStyle='#39394c';cc.fillRect(0,0,16,16);cc.fillRect(16,16,16,16);}
      vc.fillStyle=vc.createPattern(this.checker,'repeat');vc.fillRect(0,0,this.w,this.h);
    }
    const previewBase=this.previewGroup?.[0];
    if((this.stroke||this.transform)&&this.layer?.visible&&previewBase?.visible) {
      if(this.stroke&&hasRect(this.stroke.dirty))this.previewStroke();
      vc.drawImage(this.belowCache,0,0);
      vc.globalCompositeOperation=previewBase.blend;vc.globalAlpha=previewBase.opacity;
      vc.drawImage(this.previewGroup.length>1?this.clipPreview:this.activeCache,0,0);
      vc.globalAlpha=1; vc.globalCompositeOperation='source-over';vc.drawImage(this.aboveCache,0,0);
    } else vc.drawImage(this.merged,0,0);
    vc.restore();this.renderOverlay(time);
  }
  renderOverlay(time) {
    const c=this.overlayCtx;clear(c);c.save();this.docTransform(c);
    const line=1/this.v.scale;
    c.lineWidth=line;c.strokeStyle='#c2adf14b';c.strokeRect(0,0,this.w,this.h);
    c.save();c.beginPath();c.rect(0,0,this.w,this.h);c.clip();
    if(this.guide!=='Off'||this.mirror) {
      c.beginPath();c.strokeStyle='#9081d0bb';
      if(this.guide==='Thirds'||this.guide==='Grid') {
        const n=this.guide==='Thirds'?3:8;
        for(let i=1;i<n;i++){c.moveTo(this.w*i/n,0);c.lineTo(this.w*i/n,this.h);c.moveTo(0,this.h*i/n);c.lineTo(this.w,this.h*i/n);}
      } else if(this.guide==='Manga') {
        const x=this.w*.08,y=this.h*.07;
        c.rect(x,y,this.w-2*x,this.h-2*y);c.rect(x*.5,y*.5,this.w-x,this.h-y);
        c.moveTo(x,this.h*.4);c.lineTo(this.w-x,this.h*.4);c.moveTo(this.w*.53,this.h*.4);c.lineTo(this.w*.53,this.h-y);
      }
      c.stroke();
      if(this.mirror){c.beginPath();c.strokeStyle='#f368b7cc';c.setLineDash([7*line,5*line]);c.moveTo(this.w*.5,0);c.lineTo(this.w*.5,this.h);c.stroke();c.setLineDash([]);}
    }
    const s=this.selecting||this.selection;
    if(s) {
      const path=this.path(s);c.strokeStyle='#282339';c.lineWidth=2.2*line;c.stroke(path);
      c.lineWidth=1.1*line;c.strokeStyle='#fff8ff';c.setLineDash([4*line,4*line]);c.lineDashOffset=-Math.floor(time/92)*line;c.stroke(path);
      if(s.invert)c.strokeRect(line,line,this.w-line*2,this.h-line*2);
      c.setLineDash([]);
      if(!this.ants)this.ants=setTimeout(()=>{this.ants=0;this.request();},92);
    }
    if(this.transform){c.strokeStyle='#b480ed';c.setLineDash([6*line,4*line]);c.strokeRect(0,0,this.w,this.h);}
    c.restore();c.restore();
  }
  path(sel=this.selection, mask=false) {
    const p=new Path2D(); if(!sel)return p;
    if(mask&&sel.invert)p.rect(0,0,this.w,this.h);
    if(sel.type==='rect') {
      const a=sel.points[0],b=sel.points[1]||a;p.rect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y));
    } else if(sel.points.length){p.moveTo(sel.points[0].x,sel.points[0].y);for(const pos of sel.points.slice(1))p.lineTo(pos.x,pos.y);p.closePath();}
    return p;
  }
  selectionMask() {
    if(!this.selection)return null;if(this.selection.mask)return this.selection.mask;
    const c=canvas(this.w,this.h),sc=c.getContext('2d',{willReadFrequently:true});
    sc.fillStyle='white';sc.fill(this.path(this.selection,true),'evenodd');
    const mask=sc.getImageData(0,0,this.w,this.h).data;dispose(c);this.selection.mask=mask;return mask;
  }
  invertSelection() {
    if(this.selection){this.selection.invert=!this.selection.invert;this.selection.mask=null;this.request();this.emit();}
  }
  deselect() {this.selection=null;this.request();this.emit();}
  selectedAction(cut) {
    const layer=this.layer;if(!this.selection||!layer)return;
    if(!cut&&this.layers.length>=MAX_LAYERS)return this.events.notify?.('The layer limit is 10');
    const path=this.path(this.selection,true);
    const copy=canvas(this.w,this.h),paint=ctx(copy);paint.save();paint.clip(path,'evenodd');paint.drawImage(layer.c,0,0);paint.restore();
    if(!cut){
      this.addLayer('Selection copy',copy);
    } else {
      dispose(this.cutBuffer);this.cutBuffer=copy;this.events.notify?.('Cut to studio clipboard');
      const c=ctx(layer.c),hist=this.historyPixels(layer,this.full);c.save();c.clip(path,'evenodd');c.clearRect(0,0,this.w,this.h);c.restore();
      layer.rev++;this.reserveHistory(hist);this.rebuild();this.changed();
    }
    this.deselect();
  }
  pasteCut() {
    if(!this.cutBuffer)return;
    if(this.layers.length>=MAX_LAYERS)return this.events.notify?.('The layer limit is 10');
    const c=canvas(this.w,this.h);ctx(c).drawImage(this.cutBuffer,0,0);this.addLayer('Pasted selection',c);this.deselect();
  }
  readImage(src) {
    const c=canvas(this.w,this.h),p=c.getContext('2d',{willReadFrequently:true});
    p.drawImage(src,0,0);const out=p.getImageData(0,0,this.w,this.h).data;dispose(c);return out;
  }
  fill(pos) {
    const layer=this.layer,x=Math.floor(pos.x),y=Math.floor(pos.y);
    if(!layer?.visible||x<0||x>=this.w||y<0||y>=this.h||layer.opacity<=0)return;
    const rgba=this.readImage(this.sampleAll?this.merged:layer.c),alpha=layer.alphaLock?(this.sampleAll?this.readImage(layer.c):rgba):null,mask=this.selectionMask();
    const allow=alpha||mask?i=>(!alpha||alpha[i*4+3]>0)&&(!mask||mask[i*4+3]>127):null;
    const fill=scanlineMask(rgba,this.w,this.h,x,y,{tolerance:this.tolerance,allow,expand:this.gap});
    let r=emptyRect();
    for(let i=0;i<fill.length;i++)if(fill[i]){const x=i%this.w,y=Math.floor(i/this.w);r.x0=Math.min(r.x0,x);r.y0=Math.min(r.y0,y);r.x1=Math.max(r.x1,x+1);r.y1=Math.max(r.y1,y+1);}
    if(!hasRect(r))return;
    const w=r.x1-r.x0,h=r.y1-r.y0,c=canvas(w,h),cc=ctx(c),im=cc.createImageData(w,h),[R,G,B]=splitRGBA(this.color),n=Math.round(this.opacity*255);
    for(let row=0;row<h;row++)for(let col=0;col<w;col++)if(fill[(row+r.y0)*this.w+col+r.x0]){
      const i=(row*w+col)*4;im.data[i]=R;im.data[i+1]=G;im.data[i+2]=B;im.data[i+3]=n;
    }
    cc.putImageData(im,0,0);const history=this.historyPixels(layer,r),lc=ctx(layer.c);
    lc.save();if(layer.alphaLock)lc.globalCompositeOperation='source-atop';lc.drawImage(c,r.x0,r.y0);lc.restore();dispose(c);
    layer.rev++;this.reserveHistory(history);this.rebuild();this.changed();
  }
  pick(pos) {
    const x=Math.floor(pos.x),y=Math.floor(pos.y);
    if(x<0||x>=this.w||y<0||y>=this.h)return;
    const p=this.pixel;p.clearRect(0,0,1,1);p.drawImage(this.merged,x,y,1,1,0,0,1,1);
    const rgba=p.getImageData(0,0,1,1).data;if(!rgba[3])return;
    this.color=toHex(rgba);this.events.notify?.(`Picked ${this.color.toUpperCase()}`);this.emit();
  }
  inside(pos) {return pos.x>=0&&pos.y>=0&&pos.x<this.w&&pos.y<this.h;}
  beginStroke(pt) {
    const layer=this.layer;if(!layer?.visible||!this.inside(pt)||layer.opacity<=0||(layer.alphaLock&&this.brush==='Eraser'))return;
    const sc=this.strokeCtx;clear(sc);
    sc.save();sc.beginPath();sc.rect(0,0,this.w,this.h);sc.clip();
    if(this.selection)sc.clip(this.path(this.selection,true),'evenodd');
    this.stroke={ previous:pt, control:pt,midpoint:pt,dirty:emptyRect(),total:emptyRect(),length:0,speed:0,stamp:0 };
    this.dab(pt,brushRadius(this.brush,pt.p,0,this.size,6));this.request();
  }
  dab(pt,radius) {
    const s=this.stroke,sc=this.strokeCtx,color=this.color;
    const isSoft=this.brush==='Cel Soft',rim=this.brush==='Rim Glow',pencil=this.brush==='Pencil';
    const reach=Math.max(1,rim?radius*1.72:radius);
    const positions=this.mirror&&Math.abs(pt.x-this.w/2)>.4?[pt.x,this.w-pt.x]:[pt.x];
    for(const x of positions) {
      const y=pt.y;
      if(x+reach<0||x-reach>this.w||y+reach<0||y-reach>this.h)continue;
      if(isSoft||rim) {
        if(rim) {
          sc.globalCompositeOperation='source-over';sc.fillStyle='#ffffff';sc.beginPath();sc.arc(x,y,Math.max(.6,radius*.27),0,Math.PI*2);sc.fill();
          sc.globalCompositeOperation='destination-over';
        }
        const g=sc.createRadialGradient(x,y,0,x,y,reach);
        g.addColorStop(0,color);g.addColorStop(isSoft?.18:.25,color+(isSoft?'c6':'a5'));g.addColorStop(.74,color+'31');g.addColorStop(1,color+'00');
        sc.fillStyle=g;sc.fillRect(x-reach,y-reach,reach*2,reach*2);sc.globalCompositeOperation='source-over';
      } else {
        sc.fillStyle=this.brush==='Eraser'?'#ffffff':color;
        if(pencil){
          sc.globalAlpha=.27;const grain=(Math.sin((s.stamp+1)*78.233)*43758.5453)%1;
          sc.beginPath();sc.ellipse(x+grain*.38*radius,y-grain*.42*radius,Math.max(.5,radius*.67),Math.max(.5,radius*.53),grain,0,Math.PI*2);sc.fill();sc.globalAlpha=1;
        } else {sc.beginPath();sc.arc(x,y,Math.max(.52,radius),0,Math.PI*2);sc.fill();}
      }
      const box={x0:clamp(Math.floor(x-reach-2),0,this.w),y0:clamp(Math.floor(y-reach-2),0,this.h),x1:clamp(Math.ceil(x+reach+2),0,this.w),y1:clamp(Math.ceil(y+reach+2),0,this.h)};
      s.dirty=union(s.dirty,box);s.total=union(s.total,box);
    }
    s.stamp++;
  }
  quad(a,b,c,last=false) {
    const s=this.stroke,len=distance(a,b)+distance(b,c);
    const step=Math.max(.65,this.brush==='Rim Glow'?this.size*.105:this.size*.19);
    const n=Math.min(1800,Math.max(1,Math.ceil(len/step)));
    if(len<.14)return;
    for(let j=1;j<=n;j++) {
      const t=j/n,i=1-t;
      const pt={x:i*i*a.x+2*i*t*b.x+t*t*c.x,y:i*i*a.y+2*i*t*b.y+t*t*c.y,p:i*i*a.p+2*i*t*b.p+t*t*c.p};
      const taper=last&&this.brush==='Cel Wedge'?1-.58*t:1;
      this.dab(pt,brushRadius(this.brush,pt.p,s.speed,this.size,s.length+len*t)*taper);
    }
    s.length+=len;
  }
  extendStroke(raw) {
    const s=this.stroke;if(!s)return;
    const last=s.previous,ms=clamp(raw.t-last.t,1,65),mix=1-this.stabilizer*.0072;
    const now={x:last.x+(raw.x-last.x)*mix,y:last.y+(raw.y-last.y)*mix,p:last.p+(raw.p-last.p)*mix,t:raw.t};
    const m=mid(s.control,now);
    s.speed=s.speed*.64+clamp(distance(last,now)/ms,0,10)*.36;
    this.quad(s.midpoint,s.control,m);
    s.control=now;s.midpoint=m;s.previous=now;
  }
  previewStroke() {
    const s=this.stroke,layer=this.layer,r=s.dirty,ac=ctx(this.activeCache);
    reset(ac);ac.clearRect(...region(r));portion(ac,layer.c,r);
    ac.globalAlpha=this.opacity;
    ac.globalCompositeOperation=this.brush==='Eraser'?'destination-out':layer.alphaLock?'source-atop':'source-over';
    portion(ac,this.strokeCanvas,r);reset(ac);this.updateClipPreview(r);s.dirty=emptyRect();
  }
  finishStroke(pt) {
    const s=this.stroke;if(!s)return;
    if(pt){this.extendStroke(pt);this.quad(s.midpoint,s.control,pt,true);}
    this.strokeCtx.restore();this.stroke=null;
    if(!hasRect(s.total)||this.opacity<=0){this.request();return;}
    const l=this.layer,lc=ctx(l.c),h=this.historyPixels(l,s.total);
    lc.save();lc.globalAlpha=this.opacity;
    lc.globalCompositeOperation=this.brush==='Eraser'?'destination-out':l.alphaLock?'source-atop':'source-over';
    // The full-opacity stroke is applied exactly once, regardless of self-overlap.
    portion(lc,this.strokeCanvas,s.total);lc.restore();l.rev++;this.reserveHistory(h);this.rebuild();this.changed();
  }
  discardStroke() {if(this.stroke){this.strokeCtx.restore();this.stroke=null;this.rebuild();}}
  startTransform() {
    if(!this.layer?.visible){this.tool='brush';return;}
    this.transform={x:0,y:0,scale:1,angle:0,flipX:1,flipY:1};this.updateTransform();
  }
  updateTransform() {
    if(!this.transform)return;
    const c=ctx(this.activeCache),t=this.transform;clear(c);c.save();c.translate(this.w/2+t.x,this.h/2+t.y);c.rotate(t.angle);c.scale(t.scale*t.flipX,t.scale*t.flipY);c.drawImage(this.layer.c,-this.w/2,-this.h/2);c.restore();this.updateClipPreview(this.full);this.request();
  }
  transformOption(option) {
    if(!this.transform)return;
    if(option==='reset')this.transform={x:0,y:0,angle:0,scale:1,flipX:1,flipY:1};
    else this.transform[option]*=-1;
    this.updateTransform();this.emit();
  }
  finishTransform(apply) {
    if(!this.transform)return;
    this.transform=null;this.tool='brush';
    if(apply){
      const l=this.layer,h=this.historyPixels(l,this.full),d=ctx(l.c);clear(d);d.drawImage(this.activeCache,0,0);l.rev++;this.reserveHistory(h);this.rebuild();this.changed();
    } else {this.rebuild();this.emit();}
  }
  viewGesture(points) {
    const g=this.gesture,cent=average(points),[a,b]=points;
    return {cent,dist:Math.max(10,distance(a,b)),angle:Math.atan2(b.y-a.y,b.x-a.x),v:{...this.v},t:this.transform?{...this.transform}:null,anchor:this.toDoc(cent)};
  }
  updateGesture() {
    const points=[...this.pointers.values()];if(points.length<2||!this.gesture)return;
    const g=this.gesture,a=g.baseline, now=this.viewGesture(points), delta=angleNorm(now.angle-a.angle);
    if(points.some(p=>distance(p,p.start)>8))g.moved=true;
    if(!g.moved)return;
    if(a.t&&this.transform) {
      const q=this.toDoc(now.cent), p=this.toDoc(a.cent);
      Object.assign(this.transform,{x:a.t.x+q.x-p.x,y:a.t.y+q.y-p.y,angle:a.t.angle+delta*(this.flipped?-1:1),scale:clamp(a.t.scale*now.dist/a.dist,.06,12)});this.updateTransform();
    } else {
      let angle=angleNorm(a.v.angle+delta),snap=Math.round(angle/(Math.PI/2))*(Math.PI/2);
      if(Math.abs(angle-snap)<.065)angle=snap;
      this.v.scale=clamp(a.v.scale*now.dist/a.dist,.035,12);this.v.angle=angle;this.viewFitted=false;
      const dx=(a.anchor.x-this.w/2)*this.v.scale*(this.flipped?-1:1),dy=(a.anchor.y-this.h/2)*this.v.scale;
      this.v.x=now.cent.x-this.bounds.w/2-dx*Math.cos(angle)+dy*Math.sin(angle);
      this.v.y=now.cent.y-this.bounds.h/2-dx*Math.sin(angle)-dy*Math.cos(angle);
      this.request();
    }
  }
  down(e) {
    if(this.paused||!this.ready||e.button>1)return;e.preventDefault();
    this.viewport.setPointerCapture(e.pointerId);
    const screen=this.toStage(e);this.pointers.set(e.pointerId,{...screen,start:screen});
    if(this.pointers.size>1){
      clearTimeout(this.hold);this.discardStroke();this.selecting=null;this.pending=null;this.dragAnchor=null;
      const pts=[...this.pointers.values()];
      if(!this.gesture)this.gesture={start:performance.now(),max:pts.length,moved:false,baseline:this.viewGesture(pts)};
      else {this.gesture.max=Math.max(this.gesture.max,pts.length);this.gesture.baseline=this.viewGesture(pts);}
      return;
    }
    const world=this.toDoc(screen);
    if(e.button===1||this.space){this.pan={screen,x:this.v.x,y:this.v.y};return;}
    if(this.tool==='transform'&&this.transform){this.dragAnchor={world,x:this.transform.x,y:this.transform.y};return;}
    if(!this.inside(world))return;
    this.pending={tool:this.tool,world,screen};
    if(this.tool==='brush')this.beginStroke(world);
    if(this.tool==='lasso'||this.tool==='rect'){this.selecting={type:this.tool,points:[world],invert:false};this.request();}
    if(e.pointerType==='touch'&&(this.tool==='brush'||this.tool==='fill')) {
      this.hold=setTimeout(()=>{
        if(this.pointers.size===1&&this.pending){this.discardStroke();this.pending=null;this.pick(world);}
      },460);
    }
  }
  move(e) {
    if(!this.pointers.has(e.pointerId))return;e.preventDefault();
    const bounds=this.viewport.getBoundingClientRect(),p=this.pointers.get(e.pointerId),screen=this.toStage(e,bounds);Object.assign(p,screen);
    if(this.gesture){this.updateGesture();return;}
    if(distance(p,p.start)>8)clearTimeout(this.hold);
    const world=this.toDoc(screen);
    if(this.pan){this.v.x=this.pan.x+screen.x-this.pan.screen.x;this.v.y=this.pan.y+screen.y-this.pan.screen.y;this.viewFitted=false;this.request();return;}
    if(this.dragAnchor&&this.transform){this.transform.x=this.dragAnchor.x+world.x-this.dragAnchor.world.x;this.transform.y=this.dragAnchor.y+world.y-this.dragAnchor.world.y;this.updateTransform();return;}
    if(this.selecting){const pts=this.selecting.points;if(this.tool==='rect')pts[1]=world;else if(distance(pts.at(-1),world)>.8/this.v.scale)pts.push(world);this.request();return;}
    if(this.stroke){const samples=e.getCoalescedEvents?.();for(const ev of samples?.length?samples:[e]) this.extendStroke(this.toDoc(this.toStage(ev,bounds)));this.request();}
  }
  up(e) {
    if(!this.pointers.has(e.pointerId))return;e.preventDefault();this.pointers.delete(e.pointerId);clearTimeout(this.hold);
    if(this.gesture) {
      if(!this.pointers.size){const g=this.gesture;this.gesture=null;if(!g.moved&&performance.now()-g.start<300){if(g.max===2)this.undo();else if(g.max===3)this.redo();}this.emit();}
      else if(this.pointers.size>=2)this.gesture.baseline=this.viewGesture([...this.pointers.values()]);
      return;
    }
    const world=this.toDoc(this.toStage(e));
    if(this.stroke)this.finishStroke(world);
    if(this.selecting){
      const s=this.selecting;this.selecting=null;
      if(s.type==='rect'){s.points[1]=world;if(distance(s.points[0],world)>3/this.v.scale)this.selection=s;}
      else if(s.points.length>=3)this.selection=s;
      this.emit();this.request();
    }
    if(this.pending?.tool==='fill')this.fill(this.pending.world);
    if(this.pending?.tool==='pick')this.pick(world);
    if(this.pan||this.dragAnchor)this.emit();
    this.pending=null;this.pan=null;this.dragAnchor=null;
  }
  cancelPointer(e) {if(this.pointers.has(e.pointerId))this.abortPointer();}
  abortPointer() {
    this.pointers.clear();this.gesture=null;clearTimeout(this.hold);this.discardStroke();this.pending=null;this.selecting=null;this.pan=null;this.dragAnchor=null;this.request();
  }
  wheel(e) {
    if(!this.ready||this.paused)return;e.preventDefault();
    const s=this.toStage(e),anchor=this.toDoc(s),v=this.v;
    v.scale=clamp(v.scale*Math.exp(-e.deltaY*.0015),.035,12);this.viewFitted=false;
    const dx=(anchor.x-this.w/2)*v.scale*(this.flipped?-1:1),dy=(anchor.y-this.h/2)*v.scale;
    v.x=s.x-this.bounds.w/2-dx*Math.cos(v.angle)+dy*Math.sin(v.angle);v.y=s.y-this.bounds.h/2-dx*Math.sin(v.angle)-dy*Math.cos(v.angle);this.request();this.emit();
  }
  async snapshot() {
    const date=Date.now(),revision=this.revision;
    const { bitmap, ...ref }=this.ref;
    const props={id:this.record.id,title:this.title,w:this.w,h:this.h,paper:this.paper,pose:this.pose,reference:ref.blob?ref:null,date,label:this.record.label,activeId:this.activeId};
    const layers=this.layers.map(l=>{
      const {c,rev,...meta}=l;
      let cached=this.snapshots.get(l.id);
      if(cached?.rev!==rev||cached?.source!==c){cached={rev,source:c,blob:rev===0?Promise.resolve(l.png):png(c)};this.snapshots.set(l.id,cached);}
      return cached.blob.then(blob=>({...meta,png:blob}));
    });
    for(const id of this.snapshots.keys())if(!this.layers.some(l=>l.id===id))this.snapshots.delete(id);
    const s=344/Math.max(this.w,this.h),thumb=canvas(Math.round(this.w*s),Math.round(this.h*s));ctx(thumb).drawImage(this.merged,0,0,thumb.width,thumb.height);
    const out=await Promise.all([Promise.all(layers),png(thumb)]);dispose(thumb);
    return {record:{...props,layers:out[0],thumb:out[1]},revision};
  }
  async artwork({ reference=false, inkOnly=false }={}) {
    const c=canvas(this.w,this.h),d=ctx(c);
    if(!inkOnly)this.drawPaper(d);
    if(reference&&!this.ref.above)this.drawReference(d);
    this.compositeStack(d,this.layers);
    if(reference&&this.ref.above)this.drawReference(d);
    const b=await png(c);dispose(c);return b;
  }
}
