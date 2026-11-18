import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { launch } from './browser.mjs';

// Host smoke test for the actual APK payload and its nested WebView URL/CSP.
// This does not impersonate a physical Android device or test the OS activities.
const origin='https://appassets.androidplatform.net', start=`${origin}/assets/index.html`;
const files=await mkdtemp(join(tmpdir(),'komastudio-apk-'));
let browser;
try{
  execFileSync('unzip',['-q','release/KomaStudio.apk','assets/*','-d',files]);
  browser=await launch();
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,serviceWorkers:'block'});
  const headers={
    'Cross-Origin-Opener-Policy':'same-origin', 'Cross-Origin-Embedder-Policy':'require-corp',
    'Cross-Origin-Resource-Policy':'same-origin', 'X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'self'",
  };
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.webp':'image/webp','.png':'image/png','.wasm':'application/wasm'};
  const outside=[], errors=[];
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url()), pathname=decodeURIComponent(url.pathname);
    if(url.origin!==origin || !pathname.startsWith('/assets/') || pathname.includes('..')) {outside.push(url.href);await route.abort();return;}
    await route.fulfill({status:200,headers,contentType:mime[extname(pathname)]||'application/octet-stream',body:await readFile(join(files,pathname.slice(1)))});
  });
  await context.addInitScript(()=>{
    window.exports=[];
    window.KomaAndroid={
      beginExport(name,mime,share){exports.push({name,mime,share,data:[]});return exports.length.toString();},
      appendExport(id,chunk){exports[Number(id)-1].data.push(chunk);return true;},
      finishExport(id,complete){exports[Number(id)-1].complete=complete;},
    };
  });
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(start);
  await page.getByRole('button',{name:/Photo → 3D Pose Copy body/}).tap();
  await page.getByRole('button',{name:'Try sample'}).tap();
  await page.getByTestId('skeleton-preview').waitFor({timeout:65000});
  assert.match(await page.locator('.photo-result').innerText(),/2 hands found/);
  await page.getByRole('button',{name:'Apply pose'}).tap();
  await page.getByRole('button',{name:'Use pose reference'}).tap();
  await page.getByRole('button',{name:'Export PNG'}).tap();
  await page.getByLabel('Include 3D pose reference').check();
  await page.getByRole('button',{name:'Save PNG'}).tap();
  await page.waitForFunction(()=>window.exports.at(-1)?.complete);
  const out=await page.evaluate(()=>window.exports.at(-1));
  assert.equal(out.mime,'image/png');assert.equal(out.share,false);
  const png=Buffer.concat(out.data.map(part=>Buffer.from(part,'base64')));
  assert.equal(png.toString('ascii',1,4),'PNG');assert.equal(png.readUInt32BE(16),1080);assert.equal(png.readUInt32BE(20),1520);
  assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);
  console.log('PASS: signed APK assets load under the Android asset origin and CSP; local photo inference, bake and PNG bridge payload work in Chromium.');
}finally{
  await browser?.close();await rm(files,{recursive:true,force:true});
}
