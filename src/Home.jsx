import React, { useState } from 'react';
import { Aperture, ArrowDownUp, ArrowRight, ArrowUpRight, Box, ChevronRight, CircleHelp, FolderOpen, Grid2X2, House, ImagePlus, Layers3, List, LockKeyhole, MoreHorizontal, Pencil, Plus, ScanLine, Sparkles, SquareDashed, Zap } from 'lucide-react';
import { BlobImage, IconButton, Logo, Modal, PaperDots } from './ui';

const quick = [
  [Zap, 'Quick Draw', '1080 × 1520 · Pose ready', 'violet', 'quick'],
  [SquareDashed, 'Custom Canvas', 'Set size and paper color', 'peach', 'custom'],
  [Box, '3D Pose Studio', 'Pose & shape a figure', 'blue', 'pose'],
  [ScanLine, 'Photo → 3D Pose', 'Copy body & hands from image', 'mint', 'photo'],
];
const navigation = [[House, 'Home', 'home'], [FolderOpen, 'Project Gallery', 'gallery'], [Pencil, 'Draw Workspace', 'resume'], [Box, '3D Pose Studio', 'pose']];
const formats = [[1080, 1520, 'Manga'], [1080, 1080, 'Square'], [1920, 1080, 'Landscape'], [2560, 1440, 'Wide']];

export function CustomCanvas({ onClose, onCreate }) {
  const [w, setW] = useState('1080'), [h, setH] = useState('1520'), [paper, setPaper] = useState('#f7f4ee');
  const valid = [w, h].every(n => Number.isInteger(+n) && +n >= 256 && +n <= 3072);
  return <Modal title="Custom canvas" subtitle="Choose a preset or set your own dimensions." icon={SquareDashed} onClose={onClose}
    footer={<><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" form="custom-canvas" disabled={!valid}><Plus size={17}/> Create canvas</button></>}>
    <form id="custom-canvas" onSubmit={e => { e.preventDefault(); if (valid) onCreate({ w: +w, h: +h, paper }); }} className="form-stack">
      <div className="chip-row">{formats.map(([width, height, label]) => <button className={`chip ${+w === width && +h === height ? 'selected' : ''}`} key={label} type="button" onClick={() => { setW(`${width}`); setH(`${height}`); }}>{label}</button>)}</div>
      <div className="dimensions"><label>Width <span>px</span><input aria-label="Width in pixels" type="number" inputMode="numeric" min="256" max="3072" value={w} onChange={e => setW(e.target.value)}/></label><span>×</span><label>Height <span>px</span><input aria-label="Height in pixels" type="number" inputMode="numeric" min="256" max="3072" value={h} onChange={e => setH(e.target.value)}/></label></div>
      <small className={!valid ? 'field-error' : 'muted'}>256–3072 px per side</small>
      <div className="form-stack compact"><span className="field-label">Paper color</span><PaperDots value={paper} onChange={setPaper}/></div>
    </form>
  </Modal>;
}

export default function Home({ action, page, projects, busy }) {
  const [list, setList] = useState(false), [oldest, setOldest] = useState(false), [menu, setMenu] = useState(null), [help, setHelp] = useState(false);
  const gallery = page === 'gallery';
  const navigate = id => { setMenu(null); action(id); };
  const ordered = [...projects].sort((a, b) => oldest ? a.date - b.date : b.date - a.date);
  return <div className="home-shell">
    <aside className="sidebar">
      <button className="logo-button" onClick={() => navigate('home')} aria-label="KomaStudio home"><Logo/></button>
      <div className="sidebar-main">
        <button className="sidebar-create" onClick={() => navigate('custom')}><Plus size={18}/> New project</button>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Workspace">{navigation.map(([Icon, label, id]) => <button key={id} className={page === id ? 'current' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={17}/><span>{label}</span>{page === id && <span className="nav-indicator"/>}</button>)}</nav>
        <span className="nav-label second">TOOLS</span>
        <nav aria-label="Studio tools"><button onClick={() => navigate('photo')}><ScanLine size={17}/><span>Photo to Pose</span><span className="nav-ai">AI</span></button></nav>
      </div>
      <div className="sidebar-foot">
        <button className="help-link" onClick={() => setHelp(true)}><CircleHelp size={17}/> Studio guide</button>
        <div className="privacy-card"><span className="privacy-icon"><LockKeyhole size={15}/></span><div><strong>On this device</strong><small>Private by design</small></div></div>
      </div>
    </aside>
    <div className="home-main">
      <header className="home-top">
        <div className="breadcrumb"><span>Workspace</span><ChevronRight size={14}/><strong>{gallery ? 'Project Gallery' : 'Home'}</strong></div>
        <div className="mobile-brand"><Logo small/></div>
        <div className="header-right"><span className="offline-badge"><i/> Offline studio</span><span className="header-divider"/><IconButton icon={CircleHelp} label="Studio guide" onClick={() => setHelp(true)}/></div>
      </header>
      <main className="dashboard" onClick={() => { if (menu) setMenu(null); }}>
        {!gallery && <>
          <section className="hero" aria-labelledby="hero-title">
            <div className="hero-shade"/>
            <div className="hero-content">
              <span className="hero-tag"><Sparkles size={13}/> YOUR CREATIVE WORKSPACE</span>
              <h1 id="hero-title">Draw what you<br/><em>imagine.</em></h1>
              <p>Sketch, shade, and bring your characters to life.<br className="hero-break"/> Your anime art studio, even offline.</p>
              <button className="button primary hero-cta" onClick={() => navigate('quick')} disabled={busy}><Pencil size={16}/> Start drawing <ArrowRight size={16}/></button>
            </div>
            <div className="hero-index"><span>01</span><i/> CHARACTER STUDY</div>
            <span className="hero-corner" aria-hidden="true"/>
          </section>
          <section className="quick-section" aria-labelledby="quick-title">
            <div className="section-heading"><div><h2 id="quick-title">Quick actions</h2><p>Pick a starting point for your next idea.</p></div></div>
            <div className="quick-grid">{quick.map(([Icon, title, detail, color, id]) => <button type="button" className={`quick-card ${color}`} key={id} onClick={() => navigate(id)} disabled={busy && id === 'quick'}><span className="quick-symbol"><Icon size={21} strokeWidth={1.9}/></span><ArrowUpRight className="quick-arrow" size={16}/><strong>{title}</strong><span className="quick-detail">{detail}</span></button>)}</div>
          </section>
        </>}
        <section className={`gallery-section ${gallery ? 'gallery-page' : ''}`} aria-labelledby="gallery-title">
          <div className="section-heading gallery-heading"><div>{gallery && <span className="eyebrow"><Layers3 size={13}/> YOUR WORK</span>}<h2 id="gallery-title">Project gallery</h2><p>{gallery ? `${projects.length} ${projects.length === 1 ? 'project' : 'projects'} stored on this device` : 'Pick up where you left off.'}</p></div>
            <div className="gallery-controls"><IconButton icon={ArrowDownUp} label={oldest ? 'Sort newest first' : 'Sort oldest first'} active={oldest} aria-pressed={oldest} onClick={() => setOldest(v => !v)}/><div className="segmented"><IconButton icon={Grid2X2} label="Grid view" active={!list} aria-pressed={!list} onClick={() => setList(false)}/><IconButton icon={List} label="List view" active={list} aria-pressed={list} onClick={() => setList(true)}/></div>{gallery && <button className="button primary gallery-new" onClick={() => navigate('custom')}><Plus size={16}/> New project</button>}</div>
          </div>
          {ordered.length ? <div className={`project-grid ${list ? 'as-list' : ''}`}>
            {ordered.map(p => <article className="project-card" key={p.id}>
              <button className="project-open" onClick={() => action('open', p)} aria-label={`Open ${p.title}`}>
                <div className="project-art" style={{ '--project-paper': p.paper === 'transparent' ? '#252333' : p.paper }}>
                  {p.thumb || p.thumbUrl ? <BlobImage blob={p.thumb} src={p.thumbUrl} alt=""/> : <div className="blank-thumbnail"><Pencil size={26}/></div>}
                  <span className="project-category">{p.label}</span>
                </div>
                <div className="project-meta"><strong>{p.title}</strong><span>{p.w} × {p.h} px</span></div>
              </button>
              <IconButton icon={MoreHorizontal} label={`Options for ${p.title}`} className="project-menu-toggle" aria-expanded={menu === p.id} onClick={e => { e.stopPropagation(); setMenu(menu === p.id ? null : p.id); }}/>
              {menu === p.id && <div className="small-menu project-menu" onClick={e => e.stopPropagation()}>
                <button onClick={() => { setMenu(null); action('rename', p); }}>Rename</button><button onClick={() => { setMenu(null); action('duplicate', p); }}>Duplicate</button><button className="danger-text" onClick={() => { setMenu(null); action('delete', p); }}>Delete</button>
              </div>}
            </article>)}
          </div> : <div className="gallery-empty"><FolderOpen size={26}/><strong>No projects yet</strong><p>Start with a blank canvas or pull a pose into your next drawing.</p><button className="button secondary" onClick={() => navigate('custom')}><Plus size={16}/> New project</button></div>}
        </section>
        <footer className="dashboard-footer"><span><Aperture size={14}/> KomaStudio<span className="footer-dot">·</span> Made for making.</span><span>Stored locally, always.</span></footer>
      </main>
    </div>
    <nav className="mobile-nav" aria-label="Mobile workspace">{[[House, 'Home', 'home'], [FolderOpen, 'Projects', 'gallery'], [Plus, 'Create', 'custom'], [Box, 'Pose', 'pose'], [ImagePlus, 'Photo', 'photo']].map(([Icon, label, id]) => <button key={id} className={page === id ? 'current' : ''} onClick={() => navigate(id)}><Icon size={19}/><span>{label}</span></button>)}</nav>
    {help && <Modal title="Studio guide" subtitle="Everything happens on this device. No account, upload, or camera needed." icon={CircleHelp} onClose={() => setHelp(false)} footer={<button className="button primary" onClick={() => setHelp(false)}>Got it</button>}>
      <dl className="guide-list"><dt>Navigate the canvas</dt><dd>Pinch with two fingers to pan, zoom, and turn. Tap with two fingers to undo or three fingers to redo.</dd><dt>Pick a color</dt><dd>Hold still on the canvas, or tap an image in the floating Ref viewer.</dd><dt>Work between Draw and Pose</dt><dd><b>Use</b> places the current figure on the pose reference layer. <b>Ink</b> overlays your sketch in Pose Studio.</dd><dt>Desktop shortcuts</dt><dd><kbd>B</kbd> Brush <kbd>E</kbd> Eraser <kbd>I</kbd> Eyedropper <kbd>F</kbd> Fill <kbd>V</kbd> Move <kbd>0</kbd> Fit <kbd>Ctrl</kbd> + <kbd>Z</kbd> Undo</dd></dl>
    </Modal>}
  </div>;
}
