import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const ROOT=path.resolve(import.meta.dirname,'../out');
fs.mkdirSync('/tmp/pw',{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.txt':'text/plain','.json':'application/json'};
const server=http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); let f=path.join(ROOT,p); if(!path.extname(p)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){ f=path.join(ROOT,'index.html'); } res.setHeader('content-type',mime[path.extname(f)]||'application/octet-stream'); fs.createReadStream(f).pipe(res); }).listen(4177);
const results=[]; const ok=(n,c,d='')=>{results.push([c?'PASS':'FAIL',n,d]); };
const browser=await chromium.launch();
const ctx=await browser.newContext({viewport:{width:393,height:851},deviceScaleFactor:2,acceptDownloads:true,isMobile:true,hasTouch:true});
const page=await ctx.newPage();
const errors=[]; page.on('pageerror',e=>errors.push('pageerror: '+e.message)); page.on('console',m=>{ if(m.type()==='error') errors.push('console: '+m.text()); });
const B='http://localhost:4177';
// 1 first launch + every route as a deep link (Capacitor serves index.html for these)
await page.goto(B+'/'); await page.waitForFunction(()=>document.querySelector('main')&&document.querySelector('main').innerText.length>50,{timeout:15000});
ok('first launch renders overview', (await page.locator('main').innerText()).length>50);
ok('first launch persists an empty database', await page.evaluate(()=>{const raw=localStorage.getItem('pt.demo.db.v1'); if(!raw) return false; const d=JSON.parse(raw); return d.meals.length===0&&d.transactions.length===0&&d.weighIns.length===0;}));
for (const r of ['chat','bulking','budget','history','settings']) { await page.goto(`${B}/${r}`); await page.waitForSelector('main'); await page.waitForTimeout(600); const t=await page.locator('main').innerText(); ok(`route /${r} renders`, t.length>30, t.slice(0,40).replace(/\n/g,' ')); }
await page.screenshot({path:'/tmp/pw/settings.png'});
// Create real records through the UI before export, cancellation, erase and restore.
await page.goto(B+'/bulking');
await page.getByRole('button',{name:'Log meal',exact:true}).first().click();
await page.locator('dialog[open]').getByLabel('Food 1',{exact:true}).fill('E2E rice');
await page.locator('dialog[open]').getByRole('button',{name:'Log meal',exact:true}).click();
await page.waitForFunction(()=>JSON.parse(localStorage.getItem('pt.demo.db.v1')).meals.length===1);
await page.locator('dialog[open]').waitFor({state:'hidden'});
await page.getByLabel('Weight (kg)').fill('70');
await page.getByRole('button',{name:'Log weight',exact:true}).click();
await page.waitForFunction(()=>JSON.parse(localStorage.getItem('pt.demo.db.v1')).weighIns.length===1);
await page.goto(B+'/budget');
await page.getByRole('button',{name:'Add expense',exact:true}).first().click();
await page.locator('dialog[open]').getByLabel('Amount (₹)').fill('60');
await page.locator('dialog[open]').getByLabel('Description').fill('E2E expense');
await page.locator('dialog[open]').getByRole('button',{name:'Add expense',exact:true}).click();
await page.waitForFunction(()=>JSON.parse(localStorage.getItem('pt.demo.db.v1')).transactions.length===1);
// 2 export JSON
await page.goto(B+'/settings'); await page.waitForSelector('text=Your data');
const [dl]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:/Export everything/}).click()]);
const file='/tmp/pw/backup.json'; await dl.saveAs(file); const bundle=JSON.parse(fs.readFileSync(file,'utf8'));
ok('export has format fields and records', bundle.app==='personal-tracker'&&bundle.formatVersion===2&&bundle.meals.length>0&&bundle.transactions.length>0&&bundle.weighIns.length>0, `${bundle.meals.length} meals, ${bundle.transactions.length} tx, ${bundle.weighIns.length} weigh-ins`);
// 3 Escape/back closes dialog; erase requires confirmation
await page.getByRole('button',{name:'Delete all records'}).click(); await page.waitForSelector('dialog[open]');
await page.evaluate(()=>document.querySelector('dialog[open]').dispatchEvent(new Event('cancel',{cancelable:true})));
await page.waitForTimeout(300); ok('back-button style cancel closes the dialog without deleting', (await page.locator('dialog[open]').count())===0 && await page.evaluate(()=>{const d=JSON.parse(localStorage.getItem('pt.demo.db.v1'));return d.meals.length>0&&d.transactions.length>0&&d.weighIns.length>0;}));
await page.getByRole('button',{name:'Delete all records'}).click(); await page.waitForSelector('dialog[open]'); await page.getByRole('button',{name:'Delete everything'}).click(); await page.waitForTimeout(800);
ok('erase empties meals/transactions/weigh-ins', await page.evaluate(()=>{const d=JSON.parse(localStorage.getItem('pt.demo.db.v1'));return d.transactions.length===0&&d.meals.length===0&&d.weighIns.length===0;}));
await page.goto(B+'/'); await page.waitForSelector('main'); await page.waitForTimeout(500);
ok('empty database renders overview without errors', (await page.locator('main').innerText()).length>30);
// 4 restore
await page.goto(B+'/settings'); await page.waitForSelector('text=Your data');
await page.setInputFiles('input[type=file]',file); await page.waitForSelector('dialog[open]');
await page.getByRole('button',{name:'Replace my records'}).click(); await page.waitForTimeout(900);
const after=await page.evaluate(()=>{const d=JSON.parse(localStorage.getItem('pt.demo.db.v1'));return {meals:d.meals,transactions:d.transactions,weighIns:d.weighIns};});
const restoredIds=(records)=>records.map(r=>r.id).sort().join(',');
ok('restore brings back exactly the exported records', ['meals','transactions','weighIns'].every(k=>after[k].length===bundle[k].length&&restoredIds(after[k])===restoredIds(bundle[k])), [after.meals.length,after.transactions.length,after.weighIns.length].join('/'));
// 5 invalid backup is rejected, data untouched
fs.writeFileSync('/tmp/pw/bad.json','{"meals":[{"id":"x"}],"transactions":[],"weighIns":[]}');
await page.setInputFiles('input[type=file]','/tmp/pw/bad.json'); await page.waitForTimeout(500);
ok('invalid backup rejected with message, no dialog', (await page.locator('dialog[open]').count())===0 && /invalid|nothing was restored/i.test(await page.locator('body').innerText()));
// 6 survives restart
await page.reload(); await page.waitForSelector('main'); 
ok('records survive an app restart (reload)', await page.evaluate(()=>JSON.parse(localStorage.getItem('pt.demo.db.v1')).transactions.length)===bundle.transactions.length);
// 7 offline notice
await ctx.setOffline(true); await page.waitForTimeout(500);
ok('offline notice appears', /offline/i.test(await page.locator('body').innerText()));
await ctx.setOffline(false);
// 8 corrupt storage is set aside
await page.evaluate(()=>localStorage.setItem('pt.demo.db.v1','{"version":1,"meals":['));
await page.reload(); await page.waitForSelector('main'); await page.waitForTimeout(800);
ok('corrupt data: notice shown and original kept', /couldn.t be read/i.test(await page.locator('body').innerText()) && await page.evaluate(()=>Object.keys(localStorage).some(k=>k.includes('.unreadable.'))));
// 9 large history
await page.evaluate((b)=>{ const d=JSON.parse(JSON.stringify(b)); const tx=[],meals=[]; for(let i=0;i<4000;i++){ tx.push({id:'t'+i,type:'expense',amount:(i%97)+0.5,currency:'INR',category:'food',description:'Item '+i,merchant:null,notes:null,occurredAt:new Date(Date.now()-i*3600e3).toISOString(),source:'manual'}); } for(let i=0;i<1500;i++){ meals.push({id:'m'+i,mealType:'lunch',eatenAt:new Date(Date.now()-i*7200e3).toISOString(),notes:null,source:'manual',items:[{id:'i'+i,foodName:'Rice',quantity:1,unit:'cup',caloriesKcal:200,proteinG:4,isEstimate:false,nutritionSource:'user_entered'}]}); } localStorage.setItem('pt.demo.db.v1',JSON.stringify({version:1,meals,transactions:tx,weighIns:d.weighIns,settings:d.settings,sessions:[],messages:[],processed:{}})); }, bundle);
const t0=Date.now(); await page.goto(B+'/history'); await page.waitForSelector('main'); await page.waitForFunction(()=>document.querySelector('main').innerText.length>200,{timeout:30000}); const ms=Date.now()-t0;
ok('history with 5,500 records renders', ms<8000, ms+' ms');
const t1=Date.now(); await page.goto(B+'/budget'); await page.waitForSelector('main'); await page.waitForTimeout(500); ok('budget with 4,000 transactions renders', Date.now()-t1<8000, (Date.now()-t1)+' ms');
// 10 responsive screenshots
await page.evaluate((b)=>localStorage.setItem('pt.demo.db.v1',JSON.stringify({version:1,meals:b.meals,transactions:b.transactions,weighIns:b.weighIns,settings:b.settings,sessions:[],messages:[],processed:{}})),bundle);
await page.goto(B+'/'); await page.waitForTimeout(1200); await page.screenshot({path:'/tmp/pw/overview.png'});
await page.setViewportSize({width:851,height:393}); await page.waitForTimeout(500); await page.screenshot({path:'/tmp/pw/landscape.png'});
ok('landscape renders', (await page.locator('main').innerText()).length>30);
await page.setViewportSize({width:800,height:1280}); await page.waitForTimeout(500); ok('tablet renders', (await page.locator('main').innerText()).length>30);
const filtered=errors.filter(e=>!/favicon|ERR_INTERNET_DISCONNECTED|Failed to load resource.*404/.test(e)); ok('no uncaught page errors during the run', filtered.length===0, filtered.slice(0,3).join(' | '));
for(const r of results) console.log(r.join(' | '));
await browser.close(); server.close();
if(results.some(([status])=>status==='FAIL')) process.exitCode=1;
