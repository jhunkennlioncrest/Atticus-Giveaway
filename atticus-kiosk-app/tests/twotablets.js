// Two tablets, same admin. Locking one must not disturb the other.
const U="http://localhost:8770";
function tablet(){ let cookie="", unlock="";
  return { async call(op,body={},h={}){
      const r=await fetch(U+"/api/app",{method:"POST",headers:{"content-type":"application/json",
        ...(cookie?{cookie}:{}),...(unlock?{"x-unlock":unlock}:{}),...h},body:JSON.stringify({op,...body})});
      const sc=r.headers.get("set-cookie"); if(sc) cookie=sc.split(";")[0];
      return {status:r.status,...(await r.json())}; },
    set u(v){unlock=v}, get u(){return unlock} }; }
let pass=0,total=0; const ck=(n,c,d="")=>{total++;if(c)pass++;console.log((c?"PASS ":"FAIL ")+n,d)};
(async()=>{
  await fetch(U+"/__reset"); await fetch(U+"/__admin?email=john@atticus.test&password=secret123&name=John");
  const A=tablet(), B=tablet();
  A.u=(await A.call("login",{email:"john@atticus.test",password:"secret123"})).unlock;
  B.u=(await B.call("login",{email:"john@atticus.test",password:"secret123"})).unlock;
  ck("Both tablets are working", (await A.call("entries")).ok && (await B.call("entries")).ok);
  await A.call("lock");
  ck("Tablet A is locked on the server", (await A.call("entries")).status===423);
  ck("Tablet B is untouched", (await B.call("entries")).ok);
  A.u=(await A.call("unlock",{pin:"2026"})).unlock;
  ck("Tablet A reopens with the PIN", (await A.call("entries")).ok);
  ck("Tablet B still fine afterwards", (await B.call("entries")).ok);
  await B.call("logout");
  ck("Logging out B ends B's session", (await B.call("entries")).status===401);
  ck("A is unaffected by B logging out", (await A.call("entries")).ok);
  console.log(`\n${pass}/${total} passed`);
})();
