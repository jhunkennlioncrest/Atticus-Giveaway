/* Atticus kiosk offline worker. Version changes whenever any file changes. */
const CACHE="atticus-kiosk-1.3.1-4c08861f";
const ASSETS=["./", "index.html", "manifest.webmanifest", "icons/apple-touch-icon.png", "icons/favicon-32.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "fonts/AtkinsonHyperlegible-400-latin-ext.woff2", "fonts/AtkinsonHyperlegible-400-latin.woff2", "fonts/AtkinsonHyperlegible-400i-latin-ext.woff2", "fonts/AtkinsonHyperlegible-400i-latin.woff2", "fonts/AtkinsonHyperlegible-700-latin-ext.woff2", "fonts/AtkinsonHyperlegible-700-latin.woff2", "fonts/Saira-500-latin-ext.woff2", "fonts/Saira-500-latin.woff2", "fonts/Saira-600-latin-ext.woff2", "fonts/Saira-600-latin.woff2", "fonts/Saira-700-latin-ext.woff2", "fonts/Saira-700-latin.woff2"];
self.addEventListener("install",e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())); });
self.addEventListener("activate",e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith("atticus-kiosk-")&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener("fetch",e=>{
  const r=e.request; if(r.method!=="GET") return;
  const u=new URL(r.url); if(u.origin!==location.origin) return;          // never touch other sites
  if(u.pathname.startsWith("/api/")) return;                              // sending always goes live
  if(r.mode==="navigate"){                                               // page: newest when online, cached when not
    e.respondWith((async()=>{ try{ const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),3500);
        const res=await fetch(r,{signal:ctl.signal}); clearTimeout(t);
        if(res.ok){ const c=await caches.open(CACHE); c.put("index.html",res.clone()); } return res; }
      catch{ return (await caches.match("index.html"))||(await caches.match("./")); } })());
    return;
  }
  e.respondWith(caches.match(r).then(hit=>hit||fetch(r).then(res=>{ if(res.ok){ const cp=res.clone(); caches.open(CACHE).then(c=>c.put(r,cp)); } return res; })));
});
