/* Local harness: serves the real kiosk files and runs the REAL api/_core.js,
   backed by a local Postgres carrying the same schema as Supabase.
   Only two things are stand-ins: Supabase Auth (passwords) and the email provider. */
const http=require("http"), fs=require("fs"), path=require("path"), crypto=require("crypto");
const { Client } = require("pg");
const { run, unlockTools } = require("../api/_core.js");
const { renderEmail } = require("../api/_email.js");

const SITE = require("path").join(__dirname, "..");
/* Connection details: override any of these with the usual PG environment variables. */
const pg = new Client({ host: process.env.PGHOST || "127.0.0.1", port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "kiosk", password: process.env.PGPASSWORD || "kiosk",
  database: process.env.PGDATABASE || "kiosk_test" });
const sentMail=[]; let failNext=null;
const users=new Map(), tokens=new Map();     // stand-in for Supabase Auth

const db = { async rpc(fn,args={}){
  const keys=Object.keys(args);
  const sql=`select ${fn}(${keys.map((k,i)=>`${k} => $${i+1}`).join(",")}) as v`;
  const r=await pg.query(sql, keys.map(k=>{ const v=args[k]; return v && typeof v==="object" ? JSON.stringify(v) : v; }));
  return r.rows[0].v;
}};
const auth = {
  async login(email,password){
    const u=users.get(String(email).toLowerCase());
    if(!u || u.password!==password) return {ok:false};
    const t=crypto.randomUUID(); tokens.set(t,u.id); return {ok:true, token:t, user:{id:u.id}};
  },
  async verify(token){ const id=tokens.get(token); return id?{id}:null; },
  async reset(email){ return {ok:true}; },
  async setPassword(token,pw){ const id=tokens.get(token); if(!id) return {ok:false}; for(const u of users.values()) if(u.id===id) u.password=pw; return {ok:true}; },
  async invite(email){ const id=crypto.randomUUID(); users.set(String(email).toLowerCase(),{id,password:"invited"}); return {ok:true,userId:id}; }
};
async function sendMail(msg){
  if(failNext){ const m=failNext; failNext=null; throw new Error(m); }
  sentMail.push(msg); return "local_"+sentMail.length;
}
const types={".html":"text/html",".js":"application/javascript",".webmanifest":"application/manifest+json",
  ".png":"image/png",".woff2":"font/woff2",".json":"application/json",".md":"text/markdown"};

http.createServer(async (req,res)=>{
  const u=new URL(req.url,"http://x");
  if(u.pathname==="/api/app"){
    // mirrors the guard in api/app.js: no campaign configured, no service
    if(!process.env.CAMPAIGN_ID){ res.writeHead(503,{"content-type":"application/json"});
      return res.end(JSON.stringify({ok:false,error:"CAMPAIGN_ID is not set on this deployment."})); }
    
    let body={}; try{ const c=[]; for await(const x of req) c.push(x); body=JSON.parse(Buffer.concat(c).toString()||"{}"); }catch{}
    const ctx={ db, auth, headers:req.headers, campaign:process.env.CAMPAIGN_ID||"",
                kioskKey:process.env.KIOSK_KEY||"", renderEmail, sendMail, unlock:unlockTools("test-secret") };
    res.setHeader("Content-Type","application/json"); res.setHeader("Cache-Control","no-store");
    try{ const data=await run(ctx,String(body.op||""),body);
      if(data.setSession){ res.setHeader("Set-Cookie",`atk=${encodeURIComponent(data.setSession)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${(data.sessionHours||12)*3600}`); delete data.setSession; }
      if(data.clearSession) res.setHeader("Set-Cookie","atk=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
      res.end(JSON.stringify({ok:true,...data})); }
    catch(err){ res.statusCode=err.code||500; res.end(JSON.stringify({ok:false,error:String(err.message||err)})); }
    return;
  }
  // test hooks
  if(u.pathname==="/__mail"){ res.setHeader("Content-Type","application/json"); return res.end(JSON.stringify(sentMail)); }
  if(u.pathname==="/__failmail"){ failNext=u.searchParams.get("m")||"provider error"; return res.end("ok"); }
  if(u.pathname==="/__admin"){ try{ const e=u.searchParams.get("email"), p=u.searchParams.get("password");
    const id=crypto.randomUUID(); users.set(e.toLowerCase(),{id,password:p});
    await db.rpc("app_admin_add",{p_user:id,p_email:e,p_name:u.searchParams.get("name")||"Admin",p_by:"setup"});
    return res.end("ok"); }catch(err){ res.statusCode=500; return res.end(String(err.message||err)); } }
  if(u.pathname==="/__reset"){ await pg.query("delete from audit; delete from email_job; delete from entry; update prize set active=true, email_fields='{}'::jsonb; delete from settings; delete from staff; delete from rate_hit"); sentMail.length=0; return res.end("ok"); }
  let f=path.join(SITE, u.pathname==="/"?"index.html":u.pathname);
  if(!fs.existsSync(f)){ res.statusCode=404; return res.end("nf"); }
  res.setHeader("Content-Type", types[path.extname(f)]||"application/octet-stream");
  res.end(fs.readFileSync(f));
}).listen(Number(process.env.PORT || 8770), async()=>{ await pg.connect(); console.log("harness on "+(process.env.PORT||8770)); });
