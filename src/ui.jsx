import React, { useEffect, useId, useRef } from 'react';
import { Check, X } from 'lucide-react';
import { asset } from './storage';

export const PAPERS = [
  ['#f7f4ee', 'Warm white'], ['#ffffff', 'White'], ['#f1dfc3', 'Parchment'],
  ['#e1e6f5', 'Cool blue'], ['#efdfe9', 'Rose'], ['#37333f', 'Charcoal'], ['transparent', 'Transparent'],
];
export function Logo({ small = false }) {
  return <span className={`brand${small ? ' small' : ''}`}><img src={asset('mark.svg')} alt=""/><span><strong>Koma<span>Studio</span></strong>{!small && <small>ILLUSTRATION STUDIO</small>}</span></span>;
}
export function IconButton({ icon: Icon, label, active, className = '', children, ...props }) {
  return <button type="button" className={`icon-button ${active ? 'is-active' : ''} ${className}`} title={label} aria-label={label} {...props}><Icon size={18}/>{children}</button>;
}
export function Modal({ title, subtitle, icon: Icon, onClose, children, footer, className = '' }) {
  const titleId = useId(), ref = useRef(null), close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement, dialog = ref.current;
    // Focus the dialog rather than a field so mobile keyboards don't pop up automatically.
    dialog.focus({ preventScroll: true });
    function key(e) {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); close.current?.(); }
      if (e.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), a[href], [tabindex="0"]')].filter(el => el.getClientRects().length);
      if (!focusable.length) return;
      if (e.shiftKey && (document.activeElement === focusable[0] || document.activeElement === dialog)) { e.preventDefault(); focusable.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === focusable.at(-1)) { e.preventDefault(); focusable[0].focus(); }
    }
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); previous?.focus?.({ preventScroll: true }); };
  }, []);
  return <div className="modal-shade" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
      <div className="modal-head">
        {Icon && <div className="modal-symbol"><Icon size={23}/></div>}
        <IconButton icon={X} label="Close dialog" className="modal-x" onClick={onClose}/>
        <h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}
      </div>
      <div className="modal-body">{children}</div>{footer && <div className="modal-footer">{footer}</div>}
    </section>
  </div>;
}
export function PaperDots({ value, onChange }) {
  return <div className="paper-dots">{PAPERS.map(([css, name]) => <button key={css} type="button" className={`paper-dot ${css === 'transparent' ? 'checker' : ''}`} style={{ '--paper': css }} title={name} aria-label={name} aria-pressed={css === value} onClick={() => onChange(css)}>{value === css && <Check size={14}/>}</button>)}</div>;
}
export function Toggle({ checked, onChange, children, title, disabled }) {
  return <label className="toggle" title={title}><span>{children}</span><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} disabled={disabled}/><i aria-hidden="true"/></label>;
}
export function Range({ label, value, min = 0, max = 100, step = 1, onChange, onStart, onEnd, format, disabled }) {
  return <label className="field-range"><span>{label}<output>{format ? format(value) : value}</output></span><input type="range" aria-label={label} min={min} max={max} step={step} value={value}
    style={{ '--range': `${(value - min) / (max - min) * 100}%` }} onChange={e => onChange(+e.target.value)} onPointerDown={onStart} onPointerUp={onEnd} onPointerCancel={onEnd} onKeyDown={onStart} onKeyUp={onEnd} disabled={disabled}/></label>;
}
export function FileInput({ inputRef, accept, onPick, label }) {
  return <input hidden ref={inputRef} type="file" accept={accept} aria-label={label} onChange={e => { const [file] = e.target.files; e.target.value = ''; if (file) onPick(file); }}/>;
}
export function BlobImage({ blob, src, ...props }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    const url = blob ? URL.createObjectURL(blob) : null;
    if (url || src) el.src = url || src;
    else el.removeAttribute('src');
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [blob, src]);
  return <img ref={ref} {...props}/>;
}
