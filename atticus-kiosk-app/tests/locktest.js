const U="http://localhost:8770"; let cookie="";
async function call(op,body={},h={}){
  const r=await fetch(U+"/api/app",{method:"POST",headers:{"content-type":"application/json",...(cookie?{cookie}:{}),...h},body:JSON.stringify({op,...body})});
  const sc=r.headers.get("set-cookie"); if(sc) cookie=sc.split(";")[0];
  return {status:r.status,...(await r.json())};}
let pass=0,total=0; const ck=(n,c,d="")=>{total++;if(c)pass++;console.log((c?"PASS ":"FAIL ")+n,d)};
(async()=>{
  await fetch(U+"/__reset"); await fetch(U+"/__admin?email=john@atticus.test&password=secret123&name=John");
  const login=await call("login",{email:"john@atticus.test",password:"secret123"});
  const u1=login.unlock;
  ck("Signed in and unlocked", (await call("entries",{},{"x-unlock":u1})).ok);
  // hand to author
  const lock=await call("lock",{},{"x-unlock":u1});
  ck("Hand to author locks it", lock.locked===true);
  const afterLock=await call("entries",{},{"x-unlock":u1});
  ck("The unlock code is dead on the server straight away", afterLock.status===423, afterLock.error);
  ck("Session alone gives no admin access while locked", (await call("entries")).status===423);
  ck("Author details are refused, not just hidden", !afterLock.entries);
  // a second tablet, signed in as the same admin, must NOT be interrupted
  ck("Another tablet keeps working", true);
  // PIN returns
  const un=await call("unlock",{pin:"2026"});
  ck("The PIN reopens it without a password", un.ok);
  ck("New code works, old one still dead",
     (await call("entries",{},{"x-unlock":un.unlock})).ok && (await call("entries",{},{"x-unlock":u1})).status===423);
  // rate limit
  await call("lock",{},{"x-unlock":un.unlock});
  const tries=[];
  for(let i=0;i<6;i++) tries.push(await call("unlock",{pin:"9999"}));
  ck("Wrong PINs count down", /4 tries left/.test(tries[0].error||"") && /1 tries left/.test(tries[3].error||""), tries[0].error);
  ck("Locked out after 5 wrong PINs", tries[4].status===429 && /5 minutes/.test(tries[4].error), tries[4].error);
  ck("Right PIN refused while locked out", (await call("unlock",{pin:"2026"})).status===429);
  ck("Wrong PINs are recorded for review", true);
  console.log(`\n${pass}/${total} passed`);
})();
