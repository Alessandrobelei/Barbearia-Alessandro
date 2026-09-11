const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const DATA = path.join(__dirname, 'data.json');
const PUBLIC = path.join(__dirname, 'public');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '1234';
const MAX_BODY = 64 * 1024;
const SESSION_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();
const attempts = new Map();

const DEFAULT_DATA = {
  barbearia:{nome:'BARBEARIA ALESSANDRO',whatsapp:'5514998288661',corte:25,sobrancelha:15,barba:20,domiciliar:10,pomada:35,pomadaPromo:30},
  horarios:{semana:{inicio:'17:00',fim:'21:00'},fimSemana:{inicio:'13:00',fim:'21:00'}},
  servicos:[{nome:'Corte',preco:25},{nome:'Barba',preco:20},{nome:'Sobrancelha',preco:15},{nome:'Corte domiciliar',preco:35},{nome:'Pomada normal',preco:35},{nome:'Pomada promocional',preco:30}],
  promocoes:[
    {titulo:'Dia do Cliente',texto:'Terça e quinta: cabelo + barba + sobrancelha por apenas R$ 50.'},
    {titulo:'Corte + Pomada',texto:'R$ 5 de desconto na sobrancelha.'},
    {titulo:'Corte + 2 Pomadas',texto:'Sobrancelha grátis.'},
    {titulo:'Corte + Barba + Pomada',texto:'Sobrancelha grátis.'}
  ],
  agendamentos:[]
};

function clone(x){ return JSON.parse(JSON.stringify(x)); }
function ensureData(){
  try { return JSON.parse(fs.readFileSync(DATA,'utf8')); }
  catch(e){ fs.writeFileSync(DATA,JSON.stringify(DEFAULT_DATA,null,2),'utf8'); return clone(DEFAULT_DATA); }
}
function normalizeData(d){
  d.barbearia={...DEFAULT_DATA.barbearia,...(d.barbearia||{})};
  d.horarios={...DEFAULT_DATA.horarios,...(d.horarios||{})};
  d.horarios.semana={...DEFAULT_DATA.horarios.semana,...(d.horarios.semana||{})};
  d.horarios.fimSemana={...DEFAULT_DATA.horarios.fimSemana,...(d.horarios.fimSemana||{})};
  d.servicos=Array.isArray(d.servicos)?d.servicos:clone(DEFAULT_DATA.servicos);
  d.promocoes=Array.isArray(d.promocoes)?d.promocoes:clone(DEFAULT_DATA.promocoes);
  d.agendamentos=Array.isArray(d.agendamentos)?d.agendamentos:[];
  return d;
}
function readData(){ return normalizeData(ensureData()); }
function saveData(d){
  const tmp=DATA+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(normalizeData(d),null,2),'utf8');
  fs.renameSync(tmp,DATA);
}
function send(res,status,obj,headers={}){
  const body=typeof obj==='string'?obj:JSON.stringify(obj);
  res.writeHead(status,{'Content-Type':typeof obj==='string'?'text/plain; charset=utf-8':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Referrer-Policy':'strict-origin-when-cross-origin',...headers});
  res.end(body);
}
function parseBody(req){
  return new Promise((resolve,reject)=>{
    let s='';
    req.on('data',c=>{ s+=c; if(s.length>MAX_BODY){ reject(new Error('BODY_TOO_LARGE')); req.destroy(); }});
    req.on('end',()=>{ try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)} });
    req.on('error',reject);
  });
}
function token(){ return crypto.randomBytes(32).toString('hex'); }
function auth(req){
  const t=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  const exp=sessions.get(t);
  if(!exp || exp<Date.now()){ sessions.delete(t); return false; }
  return true;
}
function publicConfig(d){ return {barbearia:d.barbearia,horarios:d.horarios,servicos:d.servicos,promocoes:d.promocoes}; }
function cleanText(v,max=160){ return String(v??'').trim().slice(0,max); }
function validTime(t){ return /^\d{2}:\d{2}$/.test(t) && Number(t.slice(0,2))<24 && Number(t.slice(3))<60; }
function parseDate(s){ return /^\d{4}-\d{2}-\d{2}$/.test(s)?new Date(s+'T12:00:00'):null; }
function dayLabel(s){ const d=parseDate(s); if(!d)return ''; return new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'}).format(d); }
function dayKey(s){ const d=parseDate(s); return d?d.getDay():-1; }
function minutes(t){ const [h,m]=t.split(':').map(Number); return h*60+m; }
function isOpen(d,time){
  const key=dayKey(d); if(key<1||key>6||!validTime(time))return false;
  const data=readData(); const h=(key===0||key===6)?data.horarios.fimSemana:data.horarios.semana;
  return minutes(time)>=minutes(h.inicio) && minutes(time)<=minutes(h.fim) && minutes(time)%30===0;
}
function api(req,res){
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/health' && req.method==='GET') return send(res,200,{ok:true});
  if(url.pathname==='/api/config' && req.method==='GET') return send(res,200,publicConfig(readData()));
  if(url.pathname==='/api/availability' && req.method==='GET'){
    const date=url.searchParams.get('date')||''; const d=parseDate(date);
    if(!d)return send(res,400,{error:'Data inválida.'});
    const data=readData();
    const weekday=d.getDay(); const h=(weekday===0||weekday===6)?data.horarios.fimSemana:data.horarios.semana;
    const booked=data.agendamentos.filter(a=>a.status!=='cancelado' && (a.data===date || (!a.data && a.dia===dayLabel(date)))).map(a=>a.hora);
    return send(res,200,{date,day:dayLabel(date),open:weekday!==0||true,openHours:h,booked:[...new Set(booked)]});
  }
  if(url.pathname==='/api/login' && req.method==='POST') return parseBody(req).then(b=>{
    const ip=req.socket.remoteAddress||'unknown'; const now=Date.now();
    const a=attempts.get(ip)||{count:0,until:0}; if(a.until>now)return send(res,429,{error:'Muitas tentativas. Aguarde alguns minutos.'});
    if(String(b.password||'')!==ADMIN_PASSWORD){ a.count++; if(a.count>=5){a.count=0;a.until=now+5*60*1000} attempts.set(ip,a); return send(res,401,{error:'Senha incorreta.'}); }
    attempts.delete(ip); const t=token(); sessions.set(t,Date.now()+SESSION_MS); return send(res,200,{token:t,expiresIn:SESSION_MS});
  }).catch(()=>send(res,400,{error:'Dados inválidos.'}));
  if(url.pathname==='/api/logout' && req.method==='POST'){ sessions.delete((req.headers.authorization||'').replace(/^Bearer\s+/i,'')); return send(res,200,{ok:true}); }
  if(url.pathname==='/api/admin/data' && req.method==='GET'){
    if(!auth(req))return send(res,401,{error:'Não autorizado.'});
    return send(res,200,readData());
  }
  if(url.pathname==='/api/config' && req.method==='PUT') return parseBody(req).then(b=>{
    if(!auth(req))return send(res,401,{error:'Não autorizado.'});
    const d=readData();
    if(b.barbearia)d.barbearia={...d.barbearia,...b.barbearia};
    if(b.horarios)d.horarios={semana:{...d.horarios.semana,...(b.horarios.semana||{})},fimSemana:{...d.horarios.fimSemana,...(b.horarios.fimSemana||{})}};
    if(Array.isArray(b.servicos))d.servicos=b.servicos.filter(s=>cleanText(s.nome,80)).map(s=>({nome:cleanText(s.nome,80),preco:Math.max(0,Number(s.preco)||0)}));
    if(Array.isArray(b.promocoes))d.promocoes=b.promocoes.filter(p=>cleanText(p.titulo,100)).map(p=>({titulo:cleanText(p.titulo,100),texto:cleanText(p.texto,500)}));
    d.barbearia.nome=cleanText(d.barbearia.nome,100)||DEFAULT_DATA.barbearia.nome;
    d.barbearia.whatsapp=String(d.barbearia.whatsapp||'').replace(/\D/g,'');
    ['corte','barba','sobrancelha','domiciliar','pomada','pomadaPromo'].forEach(k=>d.barbearia[k]=Math.max(0,Number(d.barbearia[k])||0));
    saveData(d); return send(res,200,d);
  }).catch(e=>send(res,e.message==='BODY_TOO_LARGE'?413:400,{error:'Dados inválidos.'}));
  if(url.pathname==='/api/agendamentos' && req.method==='GET'){
    if(!auth(req))return send(res,401,{error:'Não autorizado.'}); return send(res,200,readData().agendamentos);
  }
  if(url.pathname==='/api/agendamentos' && req.method==='POST') return parseBody(req).then(b=>{
    const data=cleanText(b.data,10), hora=cleanText(b.hora,5), nome=cleanText(b.nome||'Cliente',80), servico=cleanText(b.servico,160);
    const d=readData();
    if(!data||!parseDate(data)||!hora||!validTime(hora)||!servico)return send(res,400,{error:'Preencha data, horário e serviço.'});
    const dateObj=parseDate(data); const today=new Date(); today.setHours(0,0,0,0); if(dateObj<today)return send(res,400,{error:'Escolha uma data futura.'});
    if(!isOpen(data,hora))return send(res,400,{error:'Esse horário está fora do atendimento.'});
    if(d.agendamentos.some(x=>x.status!=='cancelado' && x.data===data && x.hora===hora))return send(res,409,{error:'Esse horário acabou de ser ocupado. Escolha outro.'});
    const a={id:crypto.randomUUID(),nome,dia:dayLabel(data),data,hora,servico,criadoEm:new Date().toISOString(),status:'pendente'};
    d.agendamentos.push(a); saveData(d); return send(res,201,a);
  }).catch(e=>send(res,e.message==='BODY_TOO_LARGE'?413:400,{error:'Dados inválidos.'}));
  const m=url.pathname.match(/^\/api\/agendamentos\/([^/]+)$/);
  if(m && req.method==='PATCH') return parseBody(req).then(b=>{
    if(!auth(req))return send(res,401,{error:'Não autorizado.'}); const d=readData(), a=d.agendamentos.find(x=>x.id===m[1]); if(!a)return send(res,404,{error:'Agendamento não encontrado.'});
    const status=['pendente','confirmado','cancelado'].includes(b.status)?b.status:a.status; a.status=status; saveData(d); return send(res,200,a);
  }).catch(()=>send(res,400,{error:'Dados inválidos.'}));
  if(m && req.method==='DELETE'){
    if(!auth(req))return send(res,401,{error:'Não autorizado.'}); const d=readData(); d.agendamentos=d.agendamentos.filter(x=>x.id!==m[1]); saveData(d); return send(res,200,{ok:true});
  }
  return send(res,404,{error:'Rota não encontrada.'});
}
function staticFile(req,res){
  let p=new URL(req.url,'http://localhost').pathname; if(p==='/')p='/index.html';
  const file=path.resolve(PUBLIC,'.'+p); const root=path.resolve(PUBLIC);
  if(file!==root && !file.startsWith(root+path.sep))return send(res,403,'Acesso negado');
  fs.readFile(file,(e,b)=>{if(e)return send(res,404,'Não encontrado'); const ext=path.extname(file); const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'}; send(res,200,b,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':ext==='.html'?'no-cache':'public, max-age=3600'});});
}
setInterval(()=>{const n=Date.now(); for(const [t,e] of sessions)if(e<n)sessions.delete(t);},60*60*1000).unref();
http.createServer((req,res)=>{try{if(req.url.startsWith('/api/'))api(req,res);else staticFile(req,res);}catch(e){console.error(e);send(res,500,{error:'Erro interno.'});}}).listen(PORT,()=>console.log('Barbearia Alessandro online na porta '+PORT));
