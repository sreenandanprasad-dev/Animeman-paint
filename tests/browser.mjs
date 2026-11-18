import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

export async function launch(){
  const env={...process.env};
  let executablePath=env.PLAYWRIGHT_CHROMIUM_PATH;
  if(!executablePath&&process.platform==='linux'&&process.arch==='x64') {
    const base=new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br',import.meta.url);
    const libs=await mkdtemp(join(tmpdir(),'koma-chromium-'));
    const untar=spawnSync('tar',['-xf','-','-C',libs],{input:brotliDecompressSync(await readFile(base))});
    if(untar.status!==0)throw new Error('Could not initialize Chromium libraries');
    env.LD_LIBRARY_PATH=[join(libs,'lib'),env.LD_LIBRARY_PATH].filter(Boolean).join(':');
    const bundled=(await import('@sparticuz/chromium')).default;
    executablePath=await bundled.executablePath();
  }
  const args=['--no-sandbox','--enable-gpu-rasterization','--enable-accelerated-2d-canvas','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'];
  return chromium.launch({executablePath,headless:true,args,env});
}
export async function productionServer(){
  if(process.env.KOMA_TEST_URL)return { url:process.env.KOMA_TEST_URL, close:()=>{} };
  const port=process.env.KOMA_TEST_PORT||4174, url=`http://localhost:${port}/`;
  const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','0.0.0.0','--port',port,'--strictPort'],{stdio:['ignore','pipe','pipe']});
  try{
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Production preview did not start')),15000);
      server.stdout.on('data',data=>{if(String(data).includes(`localhost:${port}`)){clearTimeout(timer);resolve();}});
      server.stderr.on('data',data=>process.stderr.write(data));
      server.once('exit',code=>{clearTimeout(timer);reject(new Error(`Preview exited (${code})`));});
      server.once('error',e=>{clearTimeout(timer);reject(e);});
    });
    return {url,close:()=>server.kill()};
  }catch(e){server.kill();throw e;}
}
export async function screenshots(page, name, fullPage=false){
  await mkdir('artifacts',{recursive:true});
  await page.screenshot({path:`artifacts/${name}.png`,scale:'css',fullPage,animations:'disabled'});
}
