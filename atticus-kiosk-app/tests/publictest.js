const U="http://localhost:8770";
const call=async(op,body={},h={})=>{const r=await fetch(U+"/api/app",{method:"POST",headers:{"content-type":"application/json",...h},body:JSON.stringify({op,...body})});return {status:r.status,...(await r.json())};};
let pass=0,total=0; const ck=(n,c,d="")=>{total++;if(c)pass++;console.log((c?"PASS ":"FAIL ")+n,d)};
(async()=>{
  await fetch(U+"/__reset");
  ck("Anyone can see the wheel with no key", (await call("state")).ok);
  const phone={"x-forwarded-for":"203.0.113.9"};
  const d=await call("draw",{form:{email:"phone1@example.com",name:"Phone Author"},tablet:"QR"},phone);
  ck("An author can enter from their own phone", d.state==="won", d.prize?.name);
  // isolation is now by deployment, not by request
  const other=await call("draw",{campaign:"fbf26",form:{email:"x@example.com",name:"X"}},{"x-forwarded-for":"203.0.113.11"});
  ck("A request naming another campaign is refused", other.status===400 && /only serves/.test(other.error||""), other.error);
  const st=await call("state");
  ck("This deployment serves only its own campaign", st.campaign.id==="preview" && st.campaign.is_preview===true, st.campaign.id);
  // abuse limit per caller
  const spam=[];
  for(let i=0;i<14;i++) spam.push(await call("draw",{form:{email:`spam${i}@example.com`,name:"S"}},{"x-forwarded-for":"198.51.100.7"}));
  const blocked=spam.filter(r=>r.status===429).length;
  ck("Repeated entries from one connection are throttled", blocked>0 && spam[0].state==="won", `${14-blocked} allowed, ${blocked} blocked`);
  ck("A different connection is unaffected",
     (await call("draw",{form:{email:"other@example.com",name:"Other"}},{"x-forwarded-for":"192.0.2.55"})).state==="won");
  ck("Admin data still needs a login, key or no key", (await call("entries")).status===401);
  console.log(`\n${pass}/${total} passed`);
})();
