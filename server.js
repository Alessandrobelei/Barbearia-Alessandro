const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, "data.json");
const PUBLIC = path.join(__dirname, "public");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1234";

function readData(){ return JSON.parse(fs.readFileSync(DATA,"utf8")); }
function saveData(d){ fs.writeFileSync(DATA, JSON.stringify(d,null,2),"utf8"); }
function send(res,status,obj,headers={}) {
  const body = Buffer.isBuffer(obj) ? obj : (typeof obj === "string" ? obj : JSON.stringify(obj));
  res.writeHead(status, {"Content-Type": typeof obj==="string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8", ...headers});
  res.end(body);
}
function parseBody(req){
  return new Promise((resolve,reject)=>{
    let s=""; req.on("data",c=>s+=c); req.on("end",()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}})
  });
}
function token(){ return crypto.randomBytes(24).toString("hex"); }
const sessions = new Set();

function api(req,res){
  if(req.url==="/api/config" && req.method==="GET") return send(res,200,readData());
  if(req.url==="/api/login" && req.method==="POST") return parseBody(req).then(b=>{
    if(b.password!==ADMIN_PASSWORD) return send(res,401,{error:"Senha incorreta"});
    const t=token(); sessions.add(t); return send(res,200,{token:t});
  });
  if(req.url==="/api/logout" && req.method==="POST"){
    sessions.delete((req.headers.authorization||"").replace("Bearer ","")); return send(res,200,{ok:true});
  }
  if(req.url==="/api/agendamentos" && req.method==="POST") return parseBody(req).then(b=>{
    const d=readData();
    const a={id:Date.now().toString(),nome:b.nome||"Cliente",dia:b.dia,hora:b.hora,servico:b.servico,criadoEm:new Date().toISOString(),status:"pendente"};
    if(!a.dia||!a.hora||!a.servico) return send(res,400,{error:"Preencha dia, horário e serviço."});
    if(d.agendamentos.some(x=>x.dia===a.dia&&x.hora===a.hora&&x.status!=="cancelado"))
      return send(res,409,{error:"Esse horário já está ocupado."});
    d.agendamentos.push(a); saveData(d); return send(res,201,a);
  });
  if(req.url.startsWith("/api/agendamentos/") && req.method==="DELETE"){
    if(!sessions.has((req.headers.authorization||"").replace("Bearer ",""))) return send(res,401,{error:"Não autorizado"});
    const id=req.url.split("/").pop(), d=readData();
    d.agendamentos=d.agendamentos.filter(x=>x.id!==id); saveData(d); return send(res,200,{ok:true});
  }
  if(req.url==="/api/config" && req.method==="PUT") return parseBody(req).then(b=>{
    if(!sessions.has((req.headers.authorization||"").replace("Bearer ",""))) return send(res,401,{error:"Não autorizado"});
    const d=readData();
    if(b.barbearia) d.barbearia={...d.barbearia,...b.barbearia};
    if(b.horarios) d.horarios=b.horarios;
    if(Array.isArray(b.servicos)) d.servicos=b.servicos;
    if(Array.isArray(b.promocoes)) d.promocoes=b.promocoes;
    saveData(d); return send(res,200,d);
  });
  send(res,404,{error:"Rota não encontrada"});
}

function staticFile(req,res){
  let p=req.url.split("?")[0]; if(p==="/") p="/index.html";
  const file=path.normalize(path.join(PUBLIC,p));
  if(!file.startsWith(PUBLIC)) return send(res,403,"Acesso negado");
  fs.readFile(file,(e,b)=>{
    if(e) return send(res,404,"Não encontrado");
    const ext=path.extname(file);
    const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json"};
    send(res,200,b,{"Content-Type":types[ext]||"application/octet-stream"});
  });
}
http.createServer((req,res)=> req.url.startsWith("/api/") ? api(req,res) : staticFile(req,res)).listen(PORT,()=>console.log("Barbearia Alessandro online na porta "+PORT));
