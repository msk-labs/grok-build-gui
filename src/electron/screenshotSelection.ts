import { screen, type NativeImage } from "electron";
import { scaleSelectionToImage } from "./screenshotGeometry.js";
import {
  createScreenshotOverlayWindow,
  showScreenshotOverlayWindow,
} from "./screenshotOverlayWindow.js";
import { createScreenshotWorkspace } from "./screenshotTemp.js";
import { ScreenshotCancelled } from "./screenshotTypes.js";

function selectionHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;cursor:crosshair;user-select:none}
body{background:#111 url("./capture.png") center/100% 100% no-repeat}
#shade{position:absolute;inset:0;background:rgba(0,0,0,.38)}
#selection{position:absolute;display:none;border:2px solid #2dd4bf;box-shadow:0 0 0 9999px rgba(0,0,0,.42);pointer-events:none}
#toolbar{position:absolute;display:none;gap:12px;transform:translateX(-50%);z-index:2}
button{width:48px;height:48px;border:0;border-radius:50%;font-size:20px;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.35)}
#accept{background:#0f766e;color:#fff}#cancel{background:#fff;color:#555}
#hint{position:absolute;top:22px;left:50%;transform:translateX(-50%);padding:8px 14px;border-radius:999px;background:rgba(0,0,0,.7);color:#fff;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;pointer-events:none}
</style></head><body><div id="shade"></div><div id="selection"></div><div id="toolbar"><button id="cancel">✕</button><button id="accept">✓</button></div><div id="hint">Drag to select · Enter to edit · Esc to cancel</div>
<script>
const selection=document.querySelector("#selection"),toolbar=document.querySelector("#toolbar");
let start=null,rect=null;
const BTN=48,BTN_GAP=12,PAD=12,TW=BTN*2+BTN_GAP,TH=BTN;
/** Outside the box when possible; otherwise pin to edge (may cover the frame). */
function placeToolbar(r){
  const half=TW/2;
  let left=r.x+r.width/2;
  left=Math.max(half+PAD,Math.min(innerWidth-half-PAD,left));
  const below=r.y+r.height+PAD,above=r.y-TH-PAD;
  let top;
  if(below+TH<=innerHeight-PAD)top=below;
  else if(above>=PAD)top=above;
  else top=Math.min(innerHeight-TH-PAD,Math.max(PAD,r.y+r.height-TH-PAD));
  toolbar.style.left=left+"px";toolbar.style.top=top+"px";
}
function render(next){rect=next;if(!next||next.width<3||next.height<3){selection.style.display=toolbar.style.display="none";return}
selection.style.display="block";selection.style.left=next.x+"px";selection.style.top=next.y+"px";selection.style.width=next.width+"px";selection.style.height=next.height+"px";
toolbar.style.display="flex";placeToolbar(next)}
addEventListener("mousedown",event=>{if(event.target.closest("#toolbar"))return;start={x:event.clientX,y:event.clientY};render(null)});
addEventListener("mousemove",event=>{if(!start)return;render({x:Math.min(start.x,event.clientX),y:Math.min(start.y,event.clientY),width:Math.abs(event.clientX-start.x),height:Math.abs(event.clientY-start.y)})});
addEventListener("mouseup",()=>start=null);
function accept(){if(!rect||rect.width<3||rect.height<3)return;
document.title="__region__:"+[rect.x,rect.y,rect.width,rect.height,innerWidth,innerHeight].join(",")}
document.querySelector("#accept").onclick=accept;document.querySelector("#cancel").onclick=()=>document.title="__cancel__";
addEventListener("keydown",event=>{if(event.key==="Escape")document.title="__cancel__";if(event.key==="Enter")accept()});
</script></body></html>`;
}

export async function selectRegion(
  image: NativeImage,
  displayId?: string,
): Promise<NativeImage> {
  const workspace = await createScreenshotWorkspace("selection");
  try {
    await workspace.writeImage("capture.png", image);
    const htmlPath = await workspace.writeText(
      "selection.html",
      selectionHtml(),
    );
    const display =
      screen
        .getAllDisplays()
        .find((candidate) => String(candidate.id) === displayId) ??
      screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    return await new Promise<NativeImage>((resolve, reject) => {
      const win = createScreenshotOverlayWindow(display);
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
            `Screenshot selection crashed (${details.reason}, exit ${details.exitCode}).`,
          ),
        ),
      );
      win.webContents.on("will-navigate", (event) => event.preventDefault());
      win.webContents.on("page-title-updated", (event, title) => {
        event.preventDefault();
        if (title === "__cancel__") return finish(new ScreenshotCancelled());
        if (!title.startsWith("__region__:")) return;
        const [x, y, width, height, viewportWidth, viewportHeight] = title
          .slice("__region__:".length)
          .split(",")
          .map(Number);
        if (
          ![x, y, width, height, viewportWidth, viewportHeight].every(
            Number.isFinite,
          ) ||
          width! < 2 ||
          height! < 2
        ) {
          return finish(new Error("Invalid screenshot selection."));
        }
        try {
          const crop = scaleSelectionToImage(
            { x: x!, y: y!, width: width!, height: height! },
            { width: viewportWidth!, height: viewportHeight! },
            image.getSize(),
          );
          finish(null, image.crop(crop));
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
      void win.loadFile(htmlPath).then(() => {
        if (!win.isDestroyed()) {
          showScreenshotOverlayWindow(win, display, { focus: true });
        }
      }, (error) => finish(error));
    });
  } finally {
    await workspace.cleanup();
  }
}
