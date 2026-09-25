const U="http://localhost:8770"; let cookie="";
async function call(op,body={},h={}){
  const r=await fetch(U+"/api/app",{method:"POST",headers:{"content-type":"application/json",...(cookie?{cookie}:{}),...h},body:JSON.stringify({op,...body})});
  const sc=r.headers.get("set-cookie"); if(sc) cookie=sc.split(";")[0];
  return {status:r.status,...(await r.json())};
}
let pass=0,total=0; const ck=(n,c,d="")=>{total++;if(c)pass++;console.log((c?"PASS ":"FAIL ")+n,d)};
(async()=>{
  await fetch(U+"/__reset"); await fetch(U+"/__admin?email=john@atticus.test&password=secret123&name=John");
  ck("Before signing in, admin data is refused", (await call("entries")).status===401);
  const login=await call("login",{email:"john@atticus.test",password:"secret123"});
  ck("Signing in gives a session and an unlock", login.ok && !!login.unlock && cookie.startsWith("atk="));
  ck("The session token never reaches the page script", !("setSession" in login) && !("token" in login));
  const UN={"x-unlock":login.unlock};
  ck("Signed in and unlocked: entries visible", (await call("entries",{},UN)).ok);
  ck("Signed in but locked: entries refused", (await call("entries")).status===423);
  ck("Locked message asks for the PIN only", /PIN/.test((await call("entries")).error));
  ck("Wrong PIN refused", (await call("unlock",{pin:"1111"})).status===401);
  const un=await call("unlock",{pin:"2026"});
  ck("Right PIN reopens the view without a password", un.ok && !!un.unlock && un.admin.email==="john@atticus.test");
  ck("Reopened view can read entries", (await call("entries",{},{"x-unlock":un.unlock})).ok);
  ck("A made-up unlock code is refused", (await call("entries",{},{"x-unlock":"abc.9999999999999.deadbeef"})).status===423);
  // PIN alone is useless once the tablet is logged out
  const keep=cookie; await call("logout"); 
  ck("Log out clears the session", cookie==="atk=" || cookie==="");
  ck("After log out, the PIN alone gets nothing", (await call("unlock",{pin:"2026"})).status===401);
  cookie=keep;
  ck("An old unlock code without a session is refused", (await (async()=>{const c=cookie;cookie="";const r=await call("entries",{},{"x-unlock":un.unlock});cookie=c;return r;})()).status===401);
  ck("Session restored: still works", (await call("entries",{},{"x-unlock":un.unlock})).ok);
  const chg=await call("setPin",{pin:"246810"},{"x-unlock":un.unlock});
  ck("Admin can change the PIN", chg.ok);
  ck("Old PIN stops working", (await call("unlock",{pin:"2026"})).status===401);
  ck("New PIN works", (await call("unlock",{pin:"246810"})).ok);
  await call("setPin",{pin:"2026"},{"x-unlock":un.unlock});
  console.log(`\n${pass}/${total} passed`);
})();
