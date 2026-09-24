const U="http://localhost:8770";
let cookie="", unlockTok="";
const call=async(op,body={},headers={})=>{const r=await fetch(U+"/api/app",{method:"POST",
  headers:{"content-type":"application/json",...(cookie?{cookie}:{}),...(unlockTok?{"x-unlock":unlockTok}:{}),...headers},
  body:JSON.stringify({op,...body})});
  const sc=r.headers.get("set-cookie"); if(sc) cookie=sc.split(";")[0];
  return {status:r.status, ...(await r.json())};};
let pass=0,total=0; const ck=(n,c,d="")=>{total++;if(c)pass++;console.log((c?"PASS ":"FAIL ")+n,d)};
(async()=>{
  await fetch(U+"/__reset");
  await fetch(U+"/__admin?email=admin@atticus.test&password=secret123&name=John");
  // participant path
  const d=await call("draw",{form:{email:"maria@example.com",name:"Maria Santos",phone:"+14155550100",book:"The Lantern Road"},tablet:"Tablet 1"});
  ck("Spin saves the entry and awards a prize", d.state==="won" && d.entry.claim_ref.startsWith("ATC-"), d.prize?.name);
  const again=await call("draw",{form:{email:"MARIA@example.com",name:"Maria"},tablet:"Tablet 2"});
  ck("Same author on another tablet is blocked", again.state==="already");
  // Done with an incomplete template: queued, not sent
  const done1=await call("done",{entryId:d.entry.id});
  const mail1=await (await fetch(U+"/__mail")).json();
  ck("Done leaves an incomplete email queued", done1.status==="queued" && mail1.length===0 && done1.missing.length>0, done1.missing?.slice(0,2).join(", "));
  // admin area needs a login
  const noAuth=await (async()=>{const c=cookie;cookie="";const r=await call("entries");cookie=c;return r;})();
  ck("Entries need a login", noAuth.status===401 && /sign in/i.test(noAuth.error), noAuth.error);
  const badLogin=await call("login",{email:"admin@atticus.test",password:"wrong"});
  ck("Wrong password refused", badLogin.status===401);
  const login=await call("login",{email:"admin@atticus.test",password:"secret123"});
  ck("Admin login works and returns one role", login.ok && login.admin.email==="admin@atticus.test" && !("role" in login.admin), JSON.stringify(login.admin));
  unlockTok=login.unlock; const H={};
  const list=await call("entries",{},H);
  ck("Admin sees the entry", list.entries.length===1 && list.entries[0].email==="maria@example.com");
  // complete the template, then Done sends
  await call("settingsSave",{key:"email_shared",value:{teamName:"The Atticus Publishing team",supportEmail:"hello@atticuspublishing.com",website:"https://www.atticuspublishing.com",privacyUrl:"https://www.atticuspublishing.com/privacy"}},H);
  for (const p of (await call("state")).prizes) {
    const f = p.id.startsWith("v") ? {currency:"USD",services:"editing and marketing",minSpend:"None",expiry:"31 March 2027",partial:"Yes",redeem:"Quote your claim reference"}
      : p.id.startsWith("bs") ? {description:"A display",location:"Partner store",placement:"Front table",duration:"4 weeks",copies:"None",shipping:"We pay",timeline:"About 2 weeks"}
      : {description:"Included",submit:"Nothing",claim:"Reply to us",timeline:"About 5 weeks",conditions:"Standard terms"};
    await call("prizeSave",{prize:{id:p.id,emailFields:f}},H);
  }
  const d2=await call("draw",{form:{email:"kai@example.com",name:"Kai Tan"},tablet:"Tablet 2"});
  const doneQ=await (await fetch(U+"/__mail")).json();
  ck("Drawing alone never sends an email", doneQ.length===0);
  const done2=await call("done",{entryId:d2.entry.id});
  const mail2=await (await fetch(U+"/__mail")).json();
  ck("Done sends when the wording is complete", done2.status==="sent" && mail2.length===1 && mail2[0].to==="kai@example.com", mail2[0]?.subject);
  const done3=await call("done",{entryId:d2.entry.id});
  ck("Pressing Done again sends nothing more", done3.already===true && (await (await fetch(U+"/__mail")).json()).length===1);
  ck("The email carries the do-not-reply notice", /do not reply/i.test(mail2[0].html));
  // test mode
  const stBefore=await call("state");
  const t=await call("draw",{form:{email:"tester@atticus.test",name:"Tester"},tablet:"Tablet 1",test:true});
  const stAfter=await call("state");
  const wasLeft=stBefore.prizes.find(p=>p.id===t.prize.id).left, nowLeft=stAfter.prizes.find(p=>p.id===t.prize.id).left;
  const mailBefore=(await (await fetch(U+"/__mail")).json()).length;
  const tDone=await call("done",{entryId:t.entry.id});
  const mailAfter=(await (await fetch(U+"/__mail")).json()).length;
  ck("Test entry takes no stock and sends nothing", wasLeft===nowLeft && tDone.status==="test" && mailAfter===mailBefore, `stock ${wasLeft} → ${nowLeft}`);
  // removal restores exactly one unit
  const before=(await call("state")).prizes.find(p=>p.id===d.prize.id).left;
  const rm=await call("entryRemove",{id:d.entry.id,reason:"test data"},H);
  const after=(await call("state")).prizes.find(p=>p.id===d.prize.id).left;
  ck("Removing an entry returns exactly one unit", rm.ok && after===before+1, `${before} → ${after}`);
  const rm2=await call("entryRemove",{id:d.entry.id,reason:"again"},H);
  const after2=(await call("state")).prizes.find(p=>p.id===d.prize.id).left;
  ck("Removing twice doesn't return stock twice", rm2.already===true && after2===after);
  const back=await call("draw",{form:{email:"maria@example.com",name:"Maria Santos"},tablet:"Tablet 1"});
  ck("The removed author can enter again", back.state==="won");
  // simultaneous claims for the last unit
  await fetch(U+"/__reset");
  await fetch(U+"/__admin?email=admin@atticus.test&password=secret123&name=John");
  const relog=await call("login",{email:"admin@atticus.test",password:"secret123"}); unlockTok=relog.unlock;
  for (const p of (await call("state")).prizes) {
    const r=await call("prizeSave",{prize:{id:p.id,active:p.id==="v2500"}},H);
    if(!r.ok) console.log("  prize setup failed:", r.error);
  }
  const onWheel=(await call("state")).prizes.filter(p=>p.active).map(p=>p.id);
  ck("Only the last prize is left on the wheel", onWheel.join()==="v2500", onWheel.join());
  const results=await Promise.all([1,2,3,4,5,6].map(i=>
    call("draw",{form:{email:`race${i}@example.com`,name:"Racer "+i},tablet:"Tablet "+(i%2?1:2)})));
  const wins=results.filter(r=>r.state==="won").length, closed=results.filter(r=>r.state==="closed").length;
  const v2500=(await call("state")).prizes.find(p=>p.id==="v2500");
  ck("Six tablets racing for the last prize: exactly one wins", wins===1 && closed===5 && v2500.won===1 && v2500.left===0, `${wins} won, ${closed} closed`);
  console.log(`\n${pass}/${total} passed`);
})();
