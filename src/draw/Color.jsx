import React, { useState } from 'react';
import { Palette } from 'lucide-react';
import { Modal, Range } from '../ui';
import { clamp, hsvToRgb, rgbToHsv, splitRGBA, toHex } from './raster';

const palettes = [
  ['Skin bases', ['#fff0e5','#fbd9c1','#f9baa4','#e89683','#c47060','#874a49','#5c343c']],
  ['Cel shadows', ['#e6c7ea','#ba9ccd','#9a76b9','#7a598e','#4e3d66','#35334f','#252438']],
  ['Studio accents', ['#f7f4ee','#e584a9','#eeaf8a','#edcc87','#82ccba','#91a5e5','#2d2539']],
];
export default function ColorPicker({ color, change, close }) {
  const [[h,s,v], setHSV] = useState(() => rgbToHsv(splitRGBA(color)));
  const [hex, setHex] = useState(color.toUpperCase());
  const set = (h,s,v) => { const c=toHex(hsvToRgb(h,s,v));setHSV([h,s,v]);setHex(c.toUpperCase());change(c); };
  const setColor = c => { setHSV(rgbToHsv(splitRGBA(c)));setHex(c.toUpperCase());change(c.toLowerCase()); };
  const theta=h*Math.PI/180;
  const target = wheel => e => {
    if(e.type==='pointerdown')e.currentTarget.setPointerCapture(e.pointerId);
    else if(!e.currentTarget.hasPointerCapture(e.pointerId))return;
    const b=e.currentTarget.getBoundingClientRect(),x=(e.clientX-b.left)/b.width,y=(e.clientY-b.top)/b.height;
    if(wheel) set((Math.atan2(x-.5,.5-y)*180/Math.PI+360)%360,s,v);else set(h,clamp(x,0,1),clamp(1-y,0,1));
  };
  return <Modal title="Brush color" subtitle="Mix a color or start with an anime palette." icon={Palette} onClose={close} footer={<button className="button primary" onClick={close}>Done</button>}>
    <div className="color-mixer">
      <div className="hsv-wheel" role="slider" tabIndex={0} aria-label="Hue wheel" aria-valuemin={0} aria-valuemax={359} aria-valuenow={Math.round(h)%360}
        onKeyDown={e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();set((h+(['ArrowLeft','ArrowDown'].includes(e.key)?-5:5)+360)%360,s,v);}}} onPointerDown={target(true)} onPointerMove={target(true)}>
        <span className="hue-dot" style={{left:`${50+Math.sin(theta)*44}%`,top:`${50-Math.cos(theta)*44}%`,background:`hsl(${h} 100% 50%)`}}/>
        <div className="sv-square" aria-hidden="true" style={{'--hue':`hsl(${h} 100% 50%)`}} onPointerDown={e=>{e.stopPropagation();target(false)(e);}} onPointerMove={e=>{e.stopPropagation();target(false)(e);}}><i style={{left:`${s*100}%`,top:`${(1-v)*100}%`,background:color}}/></div>
      </div>
      <div className="color-numbers"><div className="hex-field"><span style={{background:color}}/><input aria-label="Hex brush color" maxLength={7} value={hex} onChange={e=>{const value=e.target.value;setHex(value);if(/^#[0-9a-f]{6}$/i.test(value))setColor(value);}}/></div>
        <Range label="Hue" min={0} max={359} value={Math.round(h)%360} onChange={n=>set(n,s,v)}/><Range label="Saturation" value={Math.round(s*100)} onChange={n=>set(h,n/100,v)}/><Range label="Value" value={Math.round(v*100)} onChange={n=>set(h,s,n/100)}/>
      </div>
    </div>
    <div className="anime-palettes">{palettes.map(([name, colors])=><div key={name}><span>{name}</span><div>{colors.map(c=><button type="button" key={c} aria-label={`${name} ${c.toUpperCase()}`} aria-pressed={c===color} style={{background:c}} onClick={()=>setColor(c)}/>)}</div></div>)}</div>
  </Modal>;
}
