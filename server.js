const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DB_FILE = path.join(ROOT, 'data', 'data.json');
const sessions = new Map();
const sseClients = new Set();
const rate = new Map();

const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon'};

function loadDB(){
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { fs.mkdirSync(path.dirname(DB_FILE), {recursive:true}); const seed={settings:{brand:'Made by Nexora WEB',phone:'01753519603',adminPassword:process.env.ADMIN_PASSWORD||'nexora-omega-2026'},products:[],categories:[],orders:[],reviews:[],faqs:[],analytics:{events:[]},evolution:{proposals:[]}}; fs.writeFileSync(DB_FILE,JSON.stringify(seed,null,2)); return seed; }
}
function saveDB(db){ fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2)); }
function broadcast(event,payload){ const data=`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`; for(const res of sseClients){ try{res.write(data);}catch{ sseClients.delete(res); } } }
function json(res,status,payload,headers={}){ res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}); res.end(JSON.stringify(payload)); }
function body(req,limit=1_000_000){ return new Promise((resolve,reject)=>{let d='';req.on('data',c=>{d+=c;if(d.length>limit){req.destroy();reject(new Error('Payload too large'));}});req.on('end',()=>{try{resolve(d?JSON.parse(d):{});}catch{reject(new Error('Invalid JSON'));}});req.on('error',reject);}); }
function cookie(req,name){ const m=(req.headers.cookie||'').match(new RegExp('(?:^|; )'+name.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')+'=([^;]+)'));return m?decodeURIComponent(m[1]):null; }
function session(req){ const sid=cookie(req,'omega_sid'); return sid && sessions.get(sid); }
function requireAdmin(req,res){ const s=session(req); if(!s?.admin){json(res,401,{error:'Unauthorized'});return null;} return s; }
function setSession(res,admin=false){ const sid=crypto.randomBytes(24).toString('hex'); sessions.set(sid,{admin,createdAt:Date.now()}); res.setHeader('set-cookie',`omega_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`); return sid; }
function sanitizeText(v,max=2000){ return String(v??'').replace(/[<>]/g,'').slice(0,max).trim(); }
function norm(v){return sanitizeText(v).toLowerCase();}
function id(prefix){return prefix+'-'+crypto.randomBytes(4).toString('hex').toUpperCase();}
function money(n){return `৳${Number(n||0).toLocaleString('en-BD')}`;}

function rateLimit(req,res){
  const key=req.socket.remoteAddress||'anon', now=Date.now(), windowMs=60_000, max=120;
  const arr=(rate.get(key)||[]).filter(t=>now-t<windowMs); arr.push(now); rate.set(key,arr);
  if(arr.length>max){json(res,429,{error:'Too many requests'});return false;} return true;
}

async function handleAPI(req,res,u){
  if(!rateLimit(req,res)) return;
  const db=loadDB();
  if(req.method==='GET' && u.pathname==='/api/store') return json(res,200,{settings:{brand:db.settings.brand,phone:db.settings.phone,theme:db.settings.theme},products:db.products,categories:db.categories,reviews:db.reviews,faqs:db.faqs});
  if(req.method==='GET' && u.pathname==='/api/realtime'){ res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','access-control-allow-origin':'*'});res.write('event: ready\ndata: '+JSON.stringify({ok:true,ts:new Date().toISOString()})+'\n\n');sseClients.add(res);req.on('close',()=>sseClients.delete(res));return; }
  if(req.method==='POST' && u.pathname==='/api/events'){ const b=await body(req,100000); const evt={id:id('EVT'),type:sanitizeText(b.type,80),world:sanitizeText(b.world,40),meta:b.meta||{},ts:new Date().toISOString()}; db.analytics.events.push(evt); db.analytics.events=db.analytics.events.slice(-10000); saveDB(db); broadcast('signal',evt); return json(res,201,{ok:true,id:evt.id}); }
  if(req.method==='POST' && u.pathname==='/api/chat') return handleChat(req,res,db);
  if(req.method==='POST' && u.pathname==='/api/orders'){ const b=await body(req); if(!Array.isArray(b.items)||!b.items.length) return json(res,400,{error:'No items'}); const items=b.items.map(x=>({productId:sanitizeText(x.productId,50),name:sanitizeText(x.name,200),qty:Math.max(1,Math.min(99,Number(x.qty||1))),price:Number(x.price||0),color:sanitizeText(x.color,80),size:sanitizeText(x.size,80)})); const total=items.reduce((s,x)=>s+x.price*x.qty,0); const order={id:id('OMG'),customer:{name:sanitizeText(b.customer?.name,120),phone:sanitizeText(b.customer?.phone,40),address:sanitizeText(b.customer?.address,500)},payment:sanitizeText(b.payment,40),transactionId:sanitizeText(b.transactionId,100),items,total,status:'pending',createdAt:new Date().toISOString()}; db.orders.push(order); items.forEach(it=>{const p=db.products.find(x=>x.id===it.productId); if(p)p.stock=Math.max(0,p.stock-it.qty);}); saveDB(db); broadcast('order',order); return json(res,201,{ok:true,orderId:order.id,order}); }
  if(req.method==='POST' && u.pathname==='/api/ai') return handleAI(req,res,db);


  if(req.method==='POST' && u.pathname==='/api/admin/command'){ if(!requireAdmin(req,res)) return; const b=await body(req,100000); const q=norm(b.command); const low=db.products.filter(p=>p.stock<=5); const rev=db.orders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+o.total,0); let answer='I can analyze orders, revenue, stock, products and evolution signals.'; let dataOut={}; if(/30|গত ৩০|month|মাস/.test(q)){dataOut={orders:db.orders.length,revenue:rev,lowStock:low.map(x=>({id:x.id,name:x.name,stock:x.stock})),topProducts:topProducts(db)};answer=`Last 30-day style summary: ${db.orders.length} recorded orders, ${money(rev)} non-cancelled revenue, ${low.length} low-stock products.`} else if(/stock|কম|low stock|inventory/.test(q)){dataOut={lowStock:low};answer=low.length?`I found ${low.length} products at or below the low-stock threshold.`:'No products are currently at or below the low-stock threshold.'} else if(/best|top|বেশি বিক্রি|sold/.test(q)){dataOut={topProducts:topProducts(db)};answer='Here are the highest-signal products from recorded orders.'} else if(/campaign|collection|homepage|campaign/.test(q)){dataOut={proposal:{title:'Promote a new collection',changes:['Add a featured collection block','Place two high-interest products above the fold','Use one CTA: Explore collection']}};answer='I prepared an owner-reviewable campaign proposal; nothing is published automatically.'} return json(res,200,{ok:true,answer,data:dataOut}); }
  if(u.pathname.startsWith('/api/admin/')){
    if(u.pathname==='/api/admin/login' && req.method==='POST'){ const b=await body(req,100000); if(sanitizeText(b.password,200)!==String(db.settings.adminPassword||process.env.ADMIN_PASSWORD||'')) return json(res,401,{error:'Invalid password'}); setSession(res,true); return json(res,200,{ok:true}); }
    if(u.pathname==='/api/admin/logout' && req.method==='POST'){ const sid=cookie(req,'omega_sid'); if(sid)sessions.delete(sid); res.setHeader('set-cookie','omega_sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'); return json(res,200,{ok:true}); }
    if(u.pathname==='/api/admin/me' && req.method==='GET') return json(res,200,{admin:!!session(req)?.admin});
    if(!requireAdmin(req,res)) return;
    if(u.pathname==='/api/admin/data' && req.method==='GET') return json(res,200,{...db,settings:{...db.settings,adminPassword:undefined}});
    if(u.pathname==='/api/admin/products' && req.method==='GET') return json(res,200,{items:db.products});
    if(u.pathname==='/api/admin/products' && req.method==='POST'){ const b=await body(req); const p={id:b.id||id('P'),name:sanitizeText(b.name,140),category:sanitizeText(b.category,100)||'Other / Custom Business',price:Number(b.price||0),oldPrice:Number(b.oldPrice||0),stock:Math.max(0,Number(b.stock||0)),colors:Array.isArray(b.colors)?b.colors.map(x=>sanitizeText(x,50)).slice(0,12):[],sizes:Array.isArray(b.sizes)?b.sizes.map(x=>sanitizeText(x,50)).slice(0,12):[],description:sanitizeText(b.description,1000),image:sanitizeText(b.image,1000)}; const idx=db.products.findIndex(x=>x.id===p.id); if(idx>=0)db.products[idx]=p; else db.products.push(p); saveDB(db); return json(res,200,{ok:true,item:p}); }
    if(u.pathname.startsWith('/api/admin/products/') && req.method==='DELETE'){ const pid=sanitizeText(u.pathname.split('/').pop(),60); db.products=db.products.filter(p=>p.id!==pid); saveDB(db); return json(res,200,{ok:true}); }
    if(u.pathname==='/api/admin/categories' && req.method==='POST'){ const b=await body(req); const c=sanitizeText(b.category,120); if(c&&!db.categories.includes(c))db.categories.push(c);saveDB(db);return json(res,200,{ok:true,categories:db.categories}); }
    if(u.pathname==='/api/admin/reviews' && req.method==='POST'){ const b=await body(req); const r={id:b.id||id('R'),name:sanitizeText(b.name,80),rating:Math.max(1,Math.min(5,Number(b.rating||5))),text:sanitizeText(b.text,400),world:sanitizeText(b.world,50)};const i=db.reviews.findIndex(x=>x.id===r.id);if(i>=0)db.reviews[i]=r;else db.reviews.push(r);saveDB(db);return json(res,200,{ok:true,item:r}); }
    if(u.pathname==='/api/admin/faqs' && req.method==='POST'){ const b=await body(req); const f={q:sanitizeText(b.q,200),a:sanitizeText(b.a,800)};db.faqs.push(f);saveDB(db);return json(res,200,{ok:true,item:f}); }
    if(u.pathname==='/api/admin/settings' && req.method==='POST'){ const b=await body(req); if(b.brand!==undefined)db.settings.brand=sanitizeText(b.brand,100); if(b.phone!==undefined)db.settings.phone=sanitizeText(b.phone,40); if(b.theme&&typeof b.theme==='object')db.settings.theme={...db.settings.theme,...Object.fromEntries(Object.entries(b.theme).map(([k,v])=>[k,sanitizeText(v,30)]))}; saveDB(db);return json(res,200,{ok:true,settings:db.settings}); }
    if(u.pathname==='/api/admin/change-password' && req.method==='POST'){ const b=await body(req); const old=sanitizeText(b.current,200); if(old!==db.settings.adminPassword)return json(res,401,{error:'Current password incorrect'}); db.settings.adminPassword=sanitizeText(b.next,200);saveDB(db);return json(res,200,{ok:true}); }
    if(u.pathname==='/api/admin/orders' && req.method==='GET') return json(res,200,{items:db.orders});
    if(u.pathname.match(/^\/api\/admin\/orders\/[^/]+\/status$/) && req.method==='POST'){ const oid=u.pathname.split('/')[4], b=await body(req); const o=db.orders.find(x=>x.id===oid);if(!o)return json(res,404,{error:'Order not found'});o.status=sanitizeText(b.status,40);saveDB(db);return json(res,200,{ok:true,order:o}); }
    if(u.pathname==='/api/admin/analytics' && req.method==='GET'){ const events=db.analytics.events; const byType={};events.forEach(e=>byType[e.type]=(byType[e.type]||0)+1); const revenue=db.orders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+o.total,0); return json(res,200,{events:events.length,byType,revenue,orders:db.orders.length,products:db.products.length,lowStock:db.products.filter(p=>p.stock<=5)}); }
    if(u.pathname==='/api/admin/evolution/propose' && req.method==='POST'){ const eventCounts={};db.analytics.events.forEach(e=>eventCounts[e.type]=(eventCounts[e.type]||0)+1); const proposals=[{id:id('EVOLVE'),title:'Reduce friction around intent entry',reason:(eventCounts.intent_submit||0)<5?'Intent usage is currently low in the observed sample.':'Intent activity is growing; streamline handoff into the active world.',actions:['Make natural-language entry more prominent','Offer 3 example intents','Keep reset and world switch within one tap']},{id:id('EVOLVE'),title:'Promote high-interest products earlier',reason:'Product-open signals can guide a stronger first-screen recommendation.',actions:['Increase high-interest cards near the top','Add consent-aware similar-item suggestion']}]; db.evolution.proposals=[...proposals,...db.evolution.proposals].slice(0,12);saveDB(db);return json(res,200,{ok:true,proposals}); }
    if(u.pathname==='/api/admin/evolution/apply' && req.method==='POST'){ const b=await body(req); const p=(db.evolution.proposals||[]).find(x=>x.id===b.id); if(!p)return json(res,404,{error:'Proposal not found'}); p.status='approved'; p.appliedAt=new Date().toISOString();saveDB(db);return json(res,200,{ok:true,proposal:p,message:'Approved proposal recorded. Connect deployment automation to publish code changes safely.'}); }
    return json(res,404,{error:'Unknown admin route'});
  }
  return json(res,404,{error:'Unknown API route'});
}


function topProducts(db){ const map=new Map(); for(const o of db.orders){ for(const i of o.items||[]){ const v=map.get(i.productId)||{productId:i.productId,name:i.name,qty:0,revenue:0};v.qty+=i.qty;v.revenue+=i.qty*i.price;map.set(i.productId,v); } } return [...map.values()].sort((a,b)=>b.qty-a.qty).slice(0,5); }

async function handleChat(req,res,db){
  try{ const b=await body(req,100000); const text=sanitizeText(b.message,1000); const n=norm(text); const products=db.products; let filtered=products;
    const budget=(n.match(/(?:under|within|budget|below|under\s*৳?)\s*(\d[\d,]*)/)||[])[1];
    const budgetNum=budget?Number(budget.replace(/,/g,'')):null;
    const cat=db.categories.find(c=>n.includes(c.toLowerCase()));
    if(cat)filtered=filtered.filter(p=>p.category===cat);
    const words=n.split(/\s+/).filter(w=>w.length>2);
    const hit=filtered.filter(p=>words.some(w=>norm(p.name+' '+p.description+' '+p.category).includes(w)));
    if(hit.length)filtered=hit;
    if(budgetNum!=null)filtered=filtered.filter(p=>p.price<=budgetNum);
    if(/\b(cheap|affordable|low|sosta|kom|budget|under)\b/.test(n))filtered=filtered.sort((a,b)=>a.price-b.price);
    if(/\b(expensive|premium|best|valo|bhalo|good|kemon|recommend|option)\b/.test(n))filtered=filtered.filter(p=>p.stock>0).slice().sort((a,b)=>b.stock-a.stock);
    const picks=filtered.filter(p=>p.stock>0).slice(0,3);
    let reply='OMEGA is listening. Tell me what outcome you want, and I will shape the next experience around it.';
    let mode='ASK';
    if(/saree|dress|shirt|fashion|clothing|পোশাক|শাড়ি/.test(n)){mode='SHOP';reply='আপনার জন্য shopping mode তৈরি করছি। Budget, color বা size বললেই আমি options narrow করে দেব।';}
    if(/restaurant|website chai|website|business|restaurant|ব্যবসা/.test(n)){mode='BUSINESS';reply='Business mode activated. I can structure a website plan, offer architecture and growth actions around your goal.';}
    if(/build|create|বানাও|build me/.test(n)){mode='CREATE';reply='Create mode is ready. Describe what you want built and I will turn the request into an implementation plan.';}
    if(/order|buy|kinbo|নেব|কিনতে/.test(n)){mode='SHOP';reply='I can take you directly toward checkout. Pick an option below, then I will collect the needed details before creating the order.';}
    if(n.includes('delivery')||n.includes('shipping'))reply='Delivery rules are configurable by the owner. You can set delivery policy and notes from Admin OS.';
    if(n.includes('payment')||n.includes('bkash')||n.includes('nagad'))reply='Payment options can be configured for COD and online methods. For online payments, transaction reference can be captured at checkout.';
    return json(res,200,{ok:true,mode,reply,products:picks.map(p=>({id:p.id,name:p.name,price:p.price,oldPrice:p.oldPrice,stock:p.stock,colors:p.colors,sizes:p.sizes,image:p.image,category:p.category,description:p.description})),suggestions:['SHOP','EXPLORE','BUILD','ASK']});
  }catch(e){return json(res,500,{error:e.message});}
}

async function handleAI(req,res,db){
  if(!process.env.OPENAI_API_KEY) return json(res,503,{error:'OPENAI_API_KEY is not configured',fallback:true});
  try{
    const b=await body(req,150000); const messages=Array.isArray(b.messages)?b.messages.slice(-20):[];
    const payload={model:process.env.OPENAI_MODEL||'gpt-5-mini',input:[{role:'system',content:[{type:'input_text',text:`You are NEXORA OMEGA, a warm multilingual digital-world concierge. Help with shopping, discovery, website/business building, support, analytics and navigation. Current catalog: ${JSON.stringify(db.products).slice(0,12000)}. Never invent product facts. Answer in the user's language/style. If the user asks for an action that changes data, explain/prepare it; never claim it happened unless backend confirms it.`}]},...messages.map(m=>({role:m.role==='assistant'?'assistant':'user',content:[{type:'input_text',text:sanitizeText(m.content,4000)}]}))]};
    const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+process.env.OPENAI_API_KEY},body:JSON.stringify(payload)}); const j=await r.json(); if(!r.ok)return json(res,r.status,{error:j.error?.message||'AI request failed'}); const out=j.output_text||j.output?.map(x=>x.content?.map(c=>c.text||'').join('')).join('')||'OMEGA could not produce a response.'; return json(res,200,{ok:true,text:out});
  }catch(e){return json(res,500,{error:e.message});}
}

function staticFile(req,res,u){
  let p=u.pathname==='/'?'/index.html':(u.pathname==='/admin'||u.pathname==='/admin/')?'/admin.html':u.pathname;
  try{p=decodeURIComponent(p);}catch{return res.writeHead(400).end('Bad request');}
  const file=path.resolve(PUBLIC,'.'+p); if(!file.startsWith(path.resolve(PUBLIC)+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory())return res.writeHead(404).end('Not found');
  res.writeHead(200,{'content-type':MIME[path.extname(file).toLowerCase()]||'application/octet-stream','cache-control':path.extname(file)==='.html'?'no-cache':'public, max-age=86400'}); fs.createReadStream(file).pipe(res);
}

const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname==='/health')return json(res,200,{ok:true,name:'NEXORA OMEGA',version:'2.0.0',time:new Date().toISOString()});if(u.pathname.startsWith('/api/'))return await handleAPI(req,res,u);return staticFile(req,res,u);}catch(e){console.error(e);json(res,500,{error:'Internal server error'});}});
server.listen(PORT,HOST,()=>console.log(`NEXORA OMEGA v2 running on ${HOST}:${PORT}`));
