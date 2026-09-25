import time, json
from playwright.sync_api import sync_playwright
U="http://localhost:8770/"; res=[]
def ck(n,ok,d=""): res.append((n,bool(ok),d)); print(("PASS " if ok else "FAIL ")+n, d)
def enter(pg,email,name):
    pg.click("[data-act=start]"); pg.wait_for_selector("#entry")
    for f,v in [("#f-name",name),("#f-email",email),("#f-book","A Book"),("#f-phone","4155550100")]: pg.fill(f,v)
    pg.check("#f-consent"); pg.check("#f-rules"); pg.click("#go")
with sync_playwright() as p:
    b=p.chromium.launch(); errs=[]
    A=b.new_context(viewport={"width":1180,"height":820}); B=b.new_context(viewport={"width":390,"height":844})
    pa=A.new_page(); pb=B.new_page()
    for pg in (pa,pb): pg.on("pageerror", lambda e: errs.append(str(e)))
    pa.goto(U); pa.wait_for_selector("text=Spin to win", timeout=20000)
    # admin leaves only the single $2,500 voucher on the wheel
    pa.click("[data-act=staff]"); pa.wait_for_selector("#ad-email", timeout=10000)
    pa.fill("#ad-email","john@atticus.test"); pa.fill("#ad-pass","secret123"); pa.click("[data-act=admin-login]")
    pa.wait_for_selector("text=Prize control", timeout=15000)
    left = pa.evaluate("""(async()=>{const c=await Engine.config();
      for(const t of c.tiers) if(t.id!=='v2500') { t.active=false; }
      await Engine.saveConfig(c,'test','one prize only');
      const c2=await Engine.config(); return c2.tiers.filter(t=>t.active).map(t=>t.id+':'+t.limit)})()""")
    ck("Admin can switch prizes off through the app", left==["v2500:1"], str(left))
    pa.click("[data-act=hand-over]"); pa.wait_for_selector("text=Spin to win", timeout=10000)
    # two browsers reach the wheel, then spin at the same moment for the single prize
    pb.goto(U); pb.wait_for_selector("text=Spin to win", timeout=20000)
    enter(pa,"raceA@example.com","Racer A"); enter(pb,"raceB@example.com","Racer B")
    pa.wait_for_selector("#spin", timeout=15000); pb.wait_for_selector("#spin", timeout=15000)
    # both spin buttons pressed back to back, so the two draws hit the server together
    pa.eval_on_selector("#spin","e=>e.click()"); pb.eval_on_selector("#spin","e=>e.click()")
    out=[None,None]
    for i,pg in ((0,pa),(1,pb)):
        try:
            pg.wait_for_selector(".refbox, .screen:has-text('wrap')", timeout=30000)
            out[i]="won" if pg.query_selector(".refbox") else "closed"
        except Exception as e: out[i]="error:"+str(e)[:40]
    ck("Two browsers spin at once: exactly one wins the last prize",
       sorted(out)==["closed","won"], f"A={out[0]}, B={out[1]}")
    state=pa.evaluate("""(async()=>{const r=await api("state"); const p=r.prizes.find(x=>x.id==='v2500'); return {won:p.won,left:p.left}})()""")
    ck("The database shows one winner and no stock left", state["won"]==1 and state["left"]==0, json.dumps(state))
    # removal through the interface returns the stock
    winner = pa if out[0]=="won" else pb
    winner.click("[data-act=done]"); time.sleep(1)
    pa.click("[data-act=staff]"); pa.wait_for_selector("#ad-pin", timeout=10000)
    pa.fill("#ad-pin","2026"); pa.click("[data-act=admin-unlock]"); pa.wait_for_selector("text=Prize control", timeout=15000)
    pa.click("[data-act=tab][data-tab=leads]"); pa.wait_for_selector("[data-act=open]")
    pa.click("[data-act=open]"); pa.wait_for_selector("[data-act=remove-entry]", timeout=10000)
    pa.click("[data-act=remove-entry]"); pa.wait_for_selector("#confirmdlg[open]")
    ck("Removal asks first, naming the author and prize", "$2,500" in pa.inner_text("#confirmdlg"))
    pa.click("#c-yes"); time.sleep(2)
    after=pa.evaluate("""(async()=>{const r=await api("state"); const p=r.prizes.find(x=>x.id==='v2500'); return {won:p.won,left:p.left}})()""")
    ck("Removing the entry returns the prize to stock", after["won"]==0 and after["left"]==1, json.dumps(after))
    ck("Toast confirms what happened", "back in stock" in pa.inner_text("#toast"), pa.inner_text("#toast"))
    # test mode
    pa.check("[data-act=test-mode]"); time.sleep(.5)
    pa.click("[data-act=hand-over]"); pa.wait_for_selector("text=Spin to win", timeout=10000)
    enter(pa,"tester@atticus.test","Tester"); pa.wait_for_selector("#spin", timeout=15000); pa.click("#spin")
    pa.wait_for_selector(".refbox", timeout=25000); pa.click("[data-act=done]"); time.sleep(1.5)
    tm=pa.evaluate("""(async()=>{const r=await api("state"); const p=r.prizes.find(x=>x.id==='v2500'); return {won:p.won,left:p.left}})()""")
    ck("A test entry takes no stock", tm["won"]==0 and tm["left"]==1, json.dumps(tm))
    ck("Test entry says no email was sent", "No email" in pa.inner_text("#toast") or "Test entry" in pa.inner_text("#toast"), pa.inner_text("#toast"))
    b.close()
ck("No script errors", not errs, "; ".join(errs[:2]))
print("\n%d/%d passed"%(sum(r[1] for r in res), len(res)))
