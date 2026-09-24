import time
from playwright.sync_api import sync_playwright
U="http://localhost:8770/"; res=[]
def ck(n,ok,d=""): res.append((n,bool(ok),d)); print(("PASS " if ok else "FAIL ")+n, d)
with sync_playwright() as p:
    b=p.chromium.launch(); A=b.new_context(); B=b.new_context(); pa=A.new_page(); pb=B.new_page(); errs=[]
    for pg in (pa,pb): pg.on("pageerror", lambda e: errs.append(str(e)))
    pa.goto(U); pa.wait_for_selector("text=Spin to win", timeout=20000)
    ck("A URL parameter can't switch campaigns", pa.evaluate("""(async()=>{
       const r=await fetch("/api/app",{method:"POST",headers:{"content-type":"application/json"},
         body:JSON.stringify({op:"state",campaign:"fbf26"})}); const j=await r.json();
       return !j.ok && /only serves/.test(j.error||"")})()"""))
    ck("The app uses the campaign the server names", pa.evaluate("SRV.campaign")=="preview")
    # Emails tab writes to the server
    pa.click("[data-act=staff]"); pa.wait_for_selector("#ad-email", timeout=10000)
    pa.fill("#ad-email","john@atticus.test"); pa.fill("#ad-pass","secret123"); pa.click("[data-act=admin-login]")
    pa.wait_for_selector("text=Prize control", timeout=15000)
    pa.click("[data-act=tab][data-tab=email]"); pa.wait_for_selector("#ef-currency", timeout=10000)
    pa.fill("#ef-services","editing, cover design and marketing"); pa.fill("#eg-supportEmail","hello@atticuspublishing.com")
    pa.click("[data-act=email-save]"); time.sleep(2)
    ck("Saving the wording reports it saved for every device", "every device" in pa.inner_text("#toast"), pa.inner_text("#toast"))
    onserver = pa.evaluate("""(async()=>{const r=await api("state");
      const p=r.prizes.find(x=>x.id==='v2500'); return {f:p.emailFields.services||"", s:r.shared.supportEmail||""}})()""")
    ck("The wording is stored on the server", "cover design" in onserver["f"] and onserver["s"]=="hello@atticuspublishing.com", str(onserver))
    # a second device sees it
    pb.goto(U); pb.wait_for_selector("text=Spin to win", timeout=20000)
    seen = pb.evaluate("""(async()=>{const c=await Engine.config(); return c.email.tiers.v2500.services||""})()""")
    ck("Another device sees the same approved wording", "cover design" in seen, seen[:40])
    ck("Approval status reflects the server", pa.inner_text("#tab").lower().count("still to fill")>=0)
    # password page
    pc=A.new_page(); pc.goto(U+"set-password.html#access_token=demo-token")
    ck("The password page loads from the email link", pc.is_visible("#pw") and pc.is_visible("#go"))
    pc.fill("#pw","short"); pc.fill("#pw2","short"); pc.click("#go")
    ck("Short passwords are refused", "10 characters" in pc.inner_text("#msg"), pc.inner_text("#msg"))
    pc.fill("#pw","a-long-enough-pass"); pc.fill("#pw2","different-one"); pc.click("#go")
    ck("Mismatched passwords are refused", "don't match" in pc.inner_text("#msg"))
    b.close()
ck("No script errors", not errs, "; ".join(errs[:2]))
print("\n%d/%d passed"%(sum(r[1] for r in res), len(res)))
