import express from "express";
import cors from "cors";
import unzipper from "unzipper";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "45kb" }));

const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;
const WORKFLOW = process.env.GITHUB_WORKFLOW || "build-apk.yml";
const BRANCH = process.env.GITHUB_BRANCH || "main";
const PORT = process.env.PORT || 3000;
const API = "https://api.github.com";

function configOk() { return !!(GITHUB_TOKEN && GITHUB_OWNER && GITHUB_REPO); }
async function gh(path, options={}) {
  const r = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`GitHub API ${r.status}: ${body.slice(0,300)}`);
  }
  return r;
}
app.get("/api/health", (_req,res)=>res.json({ok:true,service:"web2apk-studio"}));
app.post("/api/build", async (req,res) => {
  try {
    if (!configOk()) return res.status(503).json({error:"Backend configuration missing. Set GitHub environment variables."});
    const {mode, appName="My Web App", html="", url=""} = req.body || {};
    if (!["html","url"].includes(mode)) return res.status(400).json({error:"mode must be html or url"});
    if (typeof appName !== "string" || appName.length > 35) return res.status(400).json({error:"App name must be 1-35 characters"});
    let htmlBase64="", websiteUrl="";
    if (mode === "html") {
      if (typeof html !== "string" || !html.trim()) return res.status(400).json({error:"HTML is required"});
      if (Buffer.byteLength(html,"utf8") > 30*1024) return res.status(413).json({error:"HTML must be 30 KB or less"});
      htmlBase64 = Buffer.from(html,"utf8").toString("base64");
    } else {
      let parsed;
      try { parsed = new URL(url); } catch { return res.status(400).json({error:"Valid URL required"}); }
      if (!["http:","https:"].includes(parsed.protocol)) return res.status(400).json({error:"Only HTTP/HTTPS URLs are allowed"});
      websiteUrl = parsed.href;
    }
    const inputs = { mode, app_name: appName, html_base64: htmlBase64, website_url: websiteUrl };
    await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ref:BRANCH,inputs})
    });
    // GitHub dispatch endpoint returns 204. Find the most recent run shortly after dispatch.
    await new Promise(r=>setTimeout(r,1500));
    const runRes = await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW}/runs?branch=${encodeURIComponent(BRANCH)}&per_page=5`);
    const runs = (await runRes.json()).workflow_runs || [];
    const run = runs.find(x => x.event === "workflow_dispatch");
    if (!run) return res.status(202).json({accepted:true,message:"Workflow dispatched. Check GitHub Actions for the run."});
    res.json({accepted:true,runId:run.id});
  } catch(e) {
    console.error(e);
    res.status(502).json({error:"Could not trigger GitHub Actions. Check backend logs and GitHub token permissions."});
  }
});
app.get("/api/status/:runId", async (req,res) => {
  try {
    if (!configOk()) return res.status(503).json({error:"Backend configuration missing"});
    if (!/^\d+$/.test(req.params.runId)) return res.status(400).json({error:"Invalid run id"});
    const r=await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${req.params.runId}`);
    const run=await r.json();
    res.json({runId:run.id,status:run.status,conclusion:run.conclusion,htmlUrl:run.html_url});
  } catch(e) { console.error(e); res.status(502).json({error:"Unable to fetch build status"}); }
});
app.get("/api/download/:runId", async (req,res) => {
  try {
    if (!configOk()) return res.status(503).json({error:"Backend configuration missing"});
    if (!/^\d+$/.test(req.params.runId)) return res.status(400).json({error:"Invalid run id"});
    const r=await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${req.params.runId}/artifacts`);
    const data=await r.json();
    const artifact=(data.artifacts||[]).find(a=>a.name==="web2apk-debug-apk" && !a.expired);
    if (!artifact) return res.status(404).json({error:"APK artifact not ready or expired"});
    const ar=await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/artifacts/${artifact.id}/zip`,{redirect:"follow"});
    const zip=await ar.arrayBuffer();
    const directory=await unzipper.Open.buffer(Buffer.from(zip));
    const apk=directory.files.find(f=>f.path.endsWith(".apk"));
    if (!apk) return res.status(404).json({error:"APK not found in artifact"});
    res.setHeader("Content-Type","application/vnd.android.package-archive");
    res.setHeader("Content-Disposition",'attachment; filename="web2apk-debug.apk"');
    res.setHeader("Cache-Control","no-store");
    apk.stream().pipe(res);
  } catch(e) { console.error(e); res.status(502).json({error:"Could not download artifact. Check GitHub Actions permissions and run status."}); }
});
app.listen(PORT,()=>console.log(`Web2APK backend listening on ${PORT}`));
