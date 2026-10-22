// Set this to your deployed Node backend URL, without trailing slash.
const API_BASE = "";
const $ = (id) => document.getElementById(id);
let mode = "html";
const editor = $("htmlCode");
function updateSize() {
  const bytes = new Blob([editor.value]).size;
  $("sizeLabel").textContent = `${(bytes/1024).toFixed(1)} KB / 30 KB`;
  $("sizeLabel").style.color = bytes > 30*1024 ? "#ff8b9b" : "";
}
function preview() {
  // srcdoc is sandboxed; do not remove sandbox from the iframe.
  $("preview").srcdoc = editor.value;
  $("preview").scrollIntoView({behavior:"smooth",block:"nearest"});
}
document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => {
  mode = btn.dataset.mode;
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b===btn));
  $("htmlMode").classList.toggle("hidden",mode!=="html");
  $("urlMode").classList.toggle("hidden",mode!=="url");
}));
editor.addEventListener("input", updateSize);
$("previewBtn").addEventListener("click", preview);
$("downloadHtml").addEventListener("click", () => {
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([editor.value],{type:"text/html"}));
  a.download="index.html"; a.click(); URL.revokeObjectURL(a.href);
});
$("closePreview").addEventListener("click", () => $("preview").classList.toggle("hidden"));
$("buildBtn").addEventListener("click", async () => {
  const status=$("statusBox"), link=$("downloadLink"), btn=$("buildBtn");
  status.classList.remove("hidden"); link.classList.add("hidden"); link.removeAttribute("href");
  if(!API_BASE) {
    status.textContent="Backend URL မသတ်မှတ်ရသေးပါ။ public/app.js ထဲက API_BASE ကို Backend URL နဲ့ ပြင်ပြီး ပြန်တင်ပါ။";
    return;
  }
  const appName=$("appName").value.trim() || "My Web App";
  const payload={mode,appName};
  if(mode==="html") {
    if(new Blob([editor.value]).size > 30*1024) { status.textContent="HTML ဖိုင်က 30 KB ထက်ကြီးနေပါတယ်။"; return; }
    payload.html=editor.value;
  } else {
    const url=$("websiteUrl").value.trim();
    try { const parsed=new URL(url); if(parsed.protocol!=="https:" && parsed.protocol!=="http:") throw Error(); payload.url=parsed.href; }
    catch { status.textContent="မှန်ကန်တဲ့ http:// သို့မဟုတ် https:// URL ထည့်ပါ။"; return; }
  }
  btn.disabled=true; btn.textContent="Building request…";
  try {
    const res=await fetch(`${API_BASE}/api/build`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const data=await res.json();
    if(!res.ok) throw new Error(data.error||"Build request failed");
    status.textContent=`Build တောင်းဆိုမှု ပို့ပြီးပါပြီ။ Run ID: ${data.runId}. Build ပြီးဖို့ မိနစ်အနည်းငယ် ကြာနိုင်ပါတယ်။`;
    const started=Date.now();
    async function poll(){
      try {
        const r=await fetch(`${API_BASE}/api/status/${data.runId}`); const s=await r.json();
        status.textContent=`Build status: ${s.status||"waiting"}${s.conclusion?` — ${s.conclusion}`:""}`;
        if(s.status==="completed" && s.conclusion==="success"){
          link.href=`${API_BASE}/api/download/${data.runId}`; link.classList.remove("hidden"); link.textContent="↓ Download APK";
          btn.disabled=false; btn.textContent="⚡ Build APK"; return;
        }
        if(s.status==="completed" || Date.now()-started>12*60*1000){
          if(s.status==="completed") status.textContent+=". GitHub Actions မှာ Logs ကိုစစ်ပါ။";
          else status.textContent+=". စောင့်ဆိုင်းချိန်ကျော်သွားပါပြီ။ နောက်မှပြန်စစ်ပါ။";
          btn.disabled=false; btn.textContent="⚡ Build APK"; return;
        }
        setTimeout(poll,8000);
      } catch { status.textContent="Status စစ်မရပါ။ Backend URL နဲ့ server logs ကိုစစ်ပါ။"; btn.disabled=false; btn.textContent="⚡ Build APK"; }
    }
    setTimeout(poll,5000);
  } catch(e) {
    status.textContent=`အမှား: ${e.message}`;
    btn.disabled=false; btn.textContent="⚡ Build APK";
  }
});
updateSize(); preview();
