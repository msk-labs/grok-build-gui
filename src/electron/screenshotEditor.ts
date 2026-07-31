import { BrowserWindow, nativeImage, screen, type NativeImage } from "electron";
import { createScreenshotWorkspace } from "./screenshotTemp.js";
import { ScreenshotCancelled } from "./screenshotTypes.js";

function editorHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden;background:#f9f9f9;color:#2a2c2f;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{display:flex;flex-direction:column}.toolbar{height:58px;display:flex;align-items:center;justify-content:space-between;padding:9px 14px;border-bottom:1px solid rgba(42,44,47,.1);background:#fff}
.tools,.actions{display:flex;gap:8px;align-items:center}button{height:36px;padding:0 13px;border:1px solid rgba(42,44,47,.14);border-radius:8px;background:#fff;color:#2a2c2f;cursor:pointer}
button:hover,button.active{background:#edf8f6;border-color:#0f766e}.save{background:#0f766e;color:#fff;border-color:#0f766e}.stage{flex:1;min-height:0;padding:16px;display:grid;place-items:center;overflow:hidden}
.canvas-wrap{position:relative;max-width:100%;max-height:100%}canvas{display:block;max-width:100%;max-height:calc(100vh - 90px);box-shadow:0 8px 28px rgba(0,0,0,.18);cursor:crosshair;background:#fff}
.label{color:rgba(42,44,47,.6)}
</style></head><body><div class="toolbar"><div class="tools">
<button data-tool="pen" class="active">Pen</button><button data-tool="rect">Rectangle</button><button id="undo">Undo</button><button id="redo">Redo</button><span class="label">Red · 4 px</span>
</div><div class="actions"><button id="cancel">Cancel</button><button id="save" class="save">Attach</button></div></div>
<div class="stage"><div class="canvas-wrap"><canvas></canvas></div></div>
<script>
const canvas=document.querySelector("canvas"),ctx=canvas.getContext("2d"),image=new Image();
let tool="pen",drawing=false,start=null,snapshot=null,history=[],future=[];
function remember(){history.push(canvas.toDataURL("image/png"));if(history.length>30)history.shift();future=[]}
function restore(data){const img=new Image();img.onload=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0)};img.src=data}
image.onload=()=>{canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;ctx.drawImage(image,0,0);history=[canvas.toDataURL("image/png")]};image.src="./capture.png";
document.querySelectorAll("[data-tool]").forEach(button=>button.onclick=()=>{tool=button.dataset.tool;document.querySelectorAll("[data-tool]").forEach(x=>x.classList.toggle("active",x===button))});
function point(event){const rect=canvas.getBoundingClientRect();return{x:(event.clientX-rect.left)*canvas.width/rect.width,y:(event.clientY-rect.top)*canvas.height/rect.height}}
canvas.onpointerdown=event=>{drawing=true;start=point(event);snapshot=canvas.toDataURL("image/png");ctx.strokeStyle="#dc2626";ctx.lineWidth=4*canvas.width/canvas.getBoundingClientRect().width;ctx.lineCap="round";ctx.lineJoin="round";ctx.beginPath();ctx.moveTo(start.x,start.y);canvas.setPointerCapture(event.pointerId)};
canvas.onpointermove=event=>{if(!drawing)return;const current=point(event);if(tool==="pen"){ctx.lineTo(current.x,current.y);ctx.stroke()}else{const img=new Image();img.onload=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0);ctx.strokeStyle="#dc2626";ctx.lineWidth=4*canvas.width/canvas.getBoundingClientRect().width;ctx.strokeRect(start.x,start.y,current.x-start.x,current.y-start.y)};img.src=snapshot}};
canvas.onpointerup=event=>{if(!drawing)return;drawing=false;canvas.releasePointerCapture(event.pointerId);remember()};
document.querySelector("#undo").onclick=()=>{if(history.length<2)return;future.push(history.pop());restore(history.at(-1))};
document.querySelector("#redo").onclick=()=>{const next=future.pop();if(!next)return;history.push(next);restore(next)};
document.querySelector("#cancel").onclick=()=>document.title="__cancel__";document.querySelector("#save").onclick=()=>document.title="__save__";
addEventListener("keydown",event=>{if(event.key==="Escape")document.title="__cancel__";if((event.ctrlKey||event.metaKey)&&event.key==="z"){event.preventDefault();event.shiftKey?document.querySelector("#redo").click():document.querySelector("#undo").click()}});
window.__exportScreenshot=()=>canvas.toDataURL("image/png");
</script></body></html>`;
}

export async function editScreenshot(
  parent: BrowserWindow | null,
  image: NativeImage,
): Promise<NativeImage> {
  const workspace = await createScreenshotWorkspace("editor");
  try {
    await workspace.writeImage("capture.png", image);
    const htmlPath = await workspace.writeText("editor.html", editorHtml());
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const width = Math.min(1100, Math.floor(display.workAreaSize.width * 0.9));
    const height = Math.min(800, Math.floor(display.workAreaSize.height * 0.9));
    return await new Promise<NativeImage>((resolve, reject) => {
      const win = new BrowserWindow({
        width,
        height,
        parent: parent ?? undefined,
        modal: Boolean(parent),
        show: false,
        backgroundColor: "#f9f9f9",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      let settled = false;
      const finish = (error: Error | null, result?: NativeImage) => {
        if (settled) return;
        settled = true;
        if (!win.isDestroyed()) win.close();
        if (error) reject(error);
        else resolve(result!);
      };
      win.on("closed", () => finish(new ScreenshotCancelled()));
      win.webContents.on("render-process-gone", (_event, details) =>
        finish(
          new Error(
            `Screenshot editor crashed (${details.reason}, exit ${details.exitCode}).`,
          ),
        ),
      );
      win.webContents.on("will-navigate", (event) => event.preventDefault());
      win.webContents.on("page-title-updated", (event, title) => {
        event.preventDefault();
        if (title === "__cancel__") return finish(new ScreenshotCancelled());
        if (title !== "__save__") return;
        void win.webContents
          .executeJavaScript("window.__exportScreenshot()", true)
          .then((dataUrl: unknown) => {
            if (typeof dataUrl !== "string") {
              finish(new Error("Screenshot editor returned invalid image data."));
              return;
            }
            const result = nativeImage.createFromDataURL(dataUrl);
            if (result.isEmpty()) {
              finish(new Error("Screenshot editor returned an empty image."));
              return;
            }
            finish(null, result);
          }, (error) => finish(error));
      });
      void win.loadFile(htmlPath).then(() => {
        if (!win.isDestroyed()) {
          win.show();
          win.focus();
        }
      }, (error) => finish(error));
    });
  } finally {
    await workspace.cleanup();
  }
}
