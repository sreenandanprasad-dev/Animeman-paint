import { writeFile } from 'node:fs/promises';
import { launch, productionServer } from './browser.mjs';
// Regenerate the Quick Draw reference from the same production 3D baking path.
const server=await productionServer();
const browser=await launch().catch(e=>{server.close();throw e;});
try {
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.goto(server.url);
  await page.getByRole('button',{name:/3D Pose Studio Pose & shape/}).click();
  await page.getByRole('button',{name:'Use pose reference'}).click();
  await page.getByRole('button',{name:'Export PNG'}).waitFor();
  const source=await page.evaluate(async()=>{
    const db=await new Promise(r=>{const req=indexedDB.open('komastudio-v1',1);req.onsuccess=()=>r(req.result);});
    const list=await new Promise(r=>{const req=db.transaction('projects').objectStore('projects').getAll();req.onsuccess=()=>r(req.result);});
    db.close();
    const blob=list.find(p=>p.reference)?.reference.blob;
    return new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result.split(',')[1]);fr.readAsDataURL(blob);});
  });
  await writeFile('public/figures/starter-ref.png',Buffer.from(source,'base64'));
  console.log('Baked public/figures/starter-ref.png. Run npm run build to include it.');
}finally{await browser.close();server.close();}
