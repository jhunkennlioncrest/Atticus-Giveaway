import time, json
from playwright.sync_api import sync_playwright
U="http://localhost:8770/"; res=[]
def ck(n,ok,d=""): res.append((n,bool(ok),d)); print(("PASS " if ok else "FAIL ")+n, d)
def enter(pg,email,name):
    pg.click("[data-act=start]"); pg.wait_for_selector("#entry")
    for f,v in [("#f-name",name),("#f-email",email),("#f-book","A Book"),("#f-phone","4155550100")]: pg.fill(f,v)
    pg.check("#f-consent"); pg.check("#f-rules"); pg.click("#go"); pg.wait_for_selector("#spin", timeout=15000)
    pg.click("#spin"); pg.wait_for_selector(".refbox", timeout=25000)
    return pg.inner_text(".screen")
with sync_playwright() as p:
    b=p.chromium.launch()
    A=b.new_context(viewport={"width":1180,"height":820}); B=b.new_context(viewport={"width":390,"height":844})
    pa=A.new_page(); pb=B.new_page(); errs=[]
    pa.on("pageerror", lambda e: errs.append("A:"+str(e))); pb.on("pageerror", lambda e: errs.append("B:"+str(e)))
    pa.goto(U); pa.wait_for_selector("text=Spin to win", timeout=20000)
    ck("Browser A: the app connects to the server", pa.evaluate("SRV.on")==True and pa.evaluate("SRV.campaign")=="preview")
    prize_a=enter(pa,"browserA@example.com","Author A"); ref_a=pa.inner_text(".refbox")
    ck("Browser A: an author enters and wins", "Congratulations" in prize_a and "ATC-" in ref_a,
       [l for l in prize_a.split("\n") if "Voucher" in l or "Package" in l or "Display" in l or "Video" in l or "Network" in l][:1])
    pa.click("[data-act=done]"); time.sleep(1.5)
    ck("Browser A: Done queues the email (wording unapproved)", "queued" in pa.inner_text("#toast").lower(), pa.inner_text("#toast"))
    # second browser sees the same shared data
    pb.goto(U); pb.wait_for_selector("text=Spin to win", timeout=20000)
    again=pb.evaluate("""(async()=>{const r=await api("draw",{form:{email:"browserA@example.com",name:"Author A"}});return r.state})()""")
    ck("Browser B: the same author is blocked across devices", again=="already", str(again))
    prize_b=enter(pb,"browserB@example.com","Author B"); pb.click("[data-act=done]"); time.sleep(1)
    counts=pa.evaluate("""(async()=>{const r=await api("state");return r.prizes.reduce((s,p)=>s+Number(p.won),0)})()""")
    ck("Both entries are visible to both browsers", counts==2, f"{counts} entries counted from browser A")
    # admin in browser A: sign in, then PIN
    pa.click("[data-act=staff]"); pa.wait_for_selector("#ad-email", timeout=10000)
    pa.fill("#ad-email","john@atticus.test"); pa.fill("#ad-pass","secret123"); pa.click("[data-act=admin-login]")
    pa.wait_for_selector("text=Prize control", timeout=15000)
    ck("Admin signs in and sees the shared entries", pa.is_visible("text=Prize control"))
    pa.click("[data-act=tab][data-tab=leads]"); pa.wait_for_selector("#q")
    rows=pa.inner_text("#tab")
    ck("Entries list shows both authors from both devices", "browserA@example.com" in rows and "browserB@example.com" in rows)
    ck("Email status shows as not sent / queued", "Not sent" in rows or "queued" in rows.lower(), rows[:0])
    # hand to author
    pa.click("[data-act=hand-over]"); pa.wait_for_selector("text=Spin to win", timeout=10000)
    ck("Hand to author returns to the wheel and hides everything", "browserA@example.com" not in pa.inner_text("body"))
    ck("The unlock is dead on the server", pa.evaluate("""(async()=>{try{await api("entries");return "still open"}catch(e){return e.status}})()""")==423)
    pa.click("[data-act=staff]"); pa.wait_for_selector("#ad-pin", timeout=10000)
    ck("Coming back asks for the PIN only, not the password", pa.is_visible("#ad-pin") and not pa.query_selector("#ad-pass"))
    pa.fill("#ad-pin","9999"); pa.click("[data-act=admin-unlock]"); time.sleep(1)
    ck("Wrong PIN is refused with tries remaining", "tries left" in pa.inner_text("#ad-msg"), pa.inner_text("#ad-msg"))
    pa.fill("#ad-pin","2026"); pa.click("[data-act=admin-unlock]"); pa.wait_for_selector("text=Prize control", timeout=15000)
    ck("Right PIN reopens the admin view", pa.is_visible("text=Prize control"))
    b.close()
ck("No script errors", not errs, "; ".join(errs[:2]))
print("\n%d/%d passed"%(sum(r[1] for r in res), len(res)))
