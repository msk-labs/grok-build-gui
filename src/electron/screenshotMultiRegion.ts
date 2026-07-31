import {
  BrowserWindow,
  nativeImage,
  screen,
  type DesktopCapturerSource,
  type Display,
  type NativeImage,
} from "electron";
import { listScreenSourcesMeta } from "./screenshotCapture.js";
import {
  createScreenshotOverlayWindow,
  showScreenshotOverlayWindow,
} from "./screenshotOverlayWindow.js";
import {
  createScreenshotWorkspace,
  purgeStaleScreenshotWorkspaces,
} from "./screenshotTemp.js";
import { ScreenshotCancelled } from "./screenshotTypes.js";
import {
  EXPERIMENTAL_WINDOW_SNAP,
  listSnapWindowRectsDip,
  type SnapWindowRect,
} from "./screenshotWindowSnapWin32.js";

type DisplayCapture = {
  display: Display;
  source: DesktopCapturerSource;
};

/**
 * Overlay: getUserMedia desktop frame → device-pixel canvas (no freeze image files).
 * Window snap + drag select; solid selection border; crop via canvas export.
 */
function overlayHtml(displayId: number | string): string {
  const idLiteral = JSON.stringify(String(displayId));
  const checkSvg =
    '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l5 5L19 7"/>' +
    "</svg>";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;cursor:crosshair;user-select:none;background:#111}
#freeze{position:absolute;inset:0;width:100%;height:100%;display:block}
#shade{position:absolute;inset:0;background:rgba(0,0,0,.42);pointer-events:none}
#selection{position:absolute;display:none;border:2px solid #2dd4bf;background:transparent;box-shadow:0 0 0 9999px rgba(0,0,0,.42);pointer-events:none;border-style:solid}
#toolbar{position:absolute;display:none;gap:12px;transform:translateX(-50%);z-index:2;pointer-events:auto}
button{width:48px;height:48px;border:0;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.35);padding:0}
#accept{background:#0f766e;color:#fff}#cancel{background:#fff;color:#555;font-size:20px;line-height:1}
#hint{position:absolute;top:22px;left:50%;transform:translateX(-50%);padding:8px 14px;border-radius:999px;background:rgba(0,0,0,.7);color:#fff;font:13px "Segoe UI",-apple-system,BlinkMacSystemFont,sans-serif;pointer-events:none}
</style></head><body><canvas id="freeze"></canvas><div id="shade"></div><div id="selection"></div>
<div id="toolbar"><button type="button" id="cancel" title="Cancel">✕</button><button type="button" id="accept" title="Confirm">${checkSvg}</button></div>
<div id="hint">Hover+click a window · Drag a region · After lock: Confirm or Cancel only · Esc</div><script>
const canvas=document.querySelector("#freeze"),shade=document.querySelector("#shade"),selection=document.querySelector("#selection"),toolbar=document.querySelector("#toolbar");
let displayId=${idLiteral},frozen=false,windowRects=[];
// phase: hover | drag | locked (this display owns final pick) | blocked (another display locked)
let phase="hover",rect=null,preview=null,press=null,ownsHover=false,claimSeq=0;
const DRAG_THRESHOLD=4;
const BTN=48,BTN_GAP=12,TOOLBAR_PAD=12;
const TOOLBAR_W=BTN*2+BTN_GAP,TOOLBAR_H=BTN;

function canInteract(){
  // Once any display has locked, only Confirm/Cancel remain — no re-pick or re-drag.
  return phase==="hover"||phase==="drag";
}

function sizeCanvasToDisplay(){
  const dpr=window.devicePixelRatio||1;
  const cssW=window.innerWidth,cssH=window.innerHeight;
  const bw=Math.max(1,Math.round(cssW*dpr)),bh=Math.max(1,Math.round(cssH*dpr));
  if(canvas.width!==bw||canvas.height!==bh){canvas.width=bw;canvas.height=bh}
  canvas.style.width=cssW+"px";
  canvas.style.height=cssH+"px";
  return {dpr,cssW,cssH,bw,bh};
}

async function grabStream(sourceId,pixelW,pixelH){
  const base={chromeMediaSource:"desktop",chromeMediaSourceId:sourceId};
  const attempts=[
    {...base,minWidth:pixelW,maxWidth:pixelW,minHeight:pixelH,maxHeight:pixelH},
    {...base,minWidth:Math.floor(pixelW*0.9),maxWidth:pixelW,minHeight:Math.floor(pixelH*0.9),maxHeight:pixelH},
    base,
  ];
  let lastErr;
  for(const mandatory of attempts){
    try{
      return await navigator.mediaDevices.getUserMedia({audio:false,video:{mandatory}});
    }catch(err){lastErr=err}
  }
  throw lastErr||new Error("getUserMedia desktop capture failed");
}

/** Full-res freeze: one MediaStream frame drawn into this window's canvas. */
window.freezeFromSource=async(sourceId,pixelW,pixelH)=>{
  if(!navigator.mediaDevices||typeof navigator.mediaDevices.getUserMedia!=="function"){
    throw new Error("navigator.mediaDevices.getUserMedia is unavailable in this page context");
  }
  sizeCanvasToDisplay();
  const stream=await grabStream(String(sourceId),pixelW|0,pixelH|0);
  const video=document.createElement("video");
  video.muted=true;
  video.playsInline=true;
  video.srcObject=stream;
  await video.play();
  if(video.readyState<2){
    await new Promise((resolve,reject)=>{
      const t=setTimeout(()=>reject(new Error("video frame timeout")),5000);
      video.onloadeddata=()=>{clearTimeout(t);resolve()};
      video.onerror=()=>{clearTimeout(t);reject(new Error("video error"))};
    });
  }
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const {bw,bh,dpr,cssW,cssH}=sizeCanvasToDisplay();
  const ctx=canvas.getContext("2d",{alpha:false});
  const vw=video.videoWidth||pixelW,vh=video.videoHeight||pixelH;
  const exact=vw===bw&&vh===bh;
  ctx.imageSmoothingEnabled=!exact;
  if(!exact)ctx.imageSmoothingQuality="high";
  ctx.drawImage(video,0,0,vw,vh,0,0,bw,bh);
  stream.getTracks().forEach(t=>t.stop());
  video.srcObject=null;
  frozen=true;
  console.info("[grok-gui] freeze frame",{vw,vh,bw,bh,dpr,cssW,cssH,exact});
  return {vw,vh,bw,bh,dpr,exact};
};

window.setWindowSnapRects=(rects)=>{
  windowRects=Array.isArray(rects)?rects:[];
  console.info("[grok-gui] window snap rects",windowRects.length);
};

window.exportCrop=(x,y,w,h,viewW,viewH)=>{
  if(!frozen)throw new Error("No freeze frame");
  const scaleX=canvas.width/viewW,scaleY=canvas.height/viewH;
  const sx=Math.max(0,Math.round(x*scaleX));
  const sy=Math.max(0,Math.round(y*scaleY));
  const sw=Math.max(1,Math.min(canvas.width-sx,Math.round(w*scaleX)));
  const sh=Math.max(1,Math.min(canvas.height-sy,Math.round(h*scaleY)));
  const out=document.createElement("canvas");
  out.width=sw;out.height=sh;
  const octx=out.getContext("2d",{alpha:false});
  octx.imageSmoothingEnabled=false;
  octx.drawImage(canvas,sx,sy,sw,sh,0,0,sw,sh);
  return out.toDataURL("image/png");
};

function clampRect(next){
  if(!next)return null;
  const x=Math.max(0,Math.min(innerWidth-2,next.x));
  const y=Math.max(0,Math.min(innerHeight-2,next.y));
  const width=Math.max(2,Math.min(innerWidth-x,next.width));
  const height=Math.max(2,Math.min(innerHeight-y,next.height));
  return {x,y,width,height};
}

function screenHitToClient(screenX,screenY){
  const ox=window.screenX,oy=window.screenY;
  for(const r of windowRects){
    if(screenX>=r.x&&screenY>=r.y&&screenX<r.x+r.width&&screenY<r.y+r.height){
      return clampRect({x:r.x-ox,y:r.y-oy,width:r.width,height:r.height});
    }
  }
  return null;
}

/**
 * Prefer outside the selection (below, else above). If neither fits on screen,
 * pin to the viewport edge and allow overlapping the selection border.
 */
function placeToolbar(r){
  const half=TOOLBAR_W/2;
  let left=r.x+r.width/2;
  left=Math.max(half+TOOLBAR_PAD,Math.min(innerWidth-half-TOOLBAR_PAD,left));

  const below=r.y+r.height+TOOLBAR_PAD;
  const above=r.y-TOOLBAR_H-TOOLBAR_PAD;
  let top;
  if(below+TOOLBAR_H<=innerHeight-TOOLBAR_PAD){
    // Enough room under the box.
    top=below;
  }else if(above>=TOOLBAR_PAD){
    // Not enough below — put above the box.
    top=above;
  }else{
    // Full-height / edge cases: sit on the bottom edge, may cover the frame.
    top=Math.min(innerHeight-TOOLBAR_H-TOOLBAR_PAD,Math.max(TOOLBAR_PAD,r.y+r.height-TOOLBAR_H-TOOLBAR_PAD));
  }
  toolbar.style.left=left+"px";
  toolbar.style.top=top+"px";
}

function render(next,kind){
  rect=next&&next.width>=3&&next.height>=3?next:null;
  if(!rect){
    selection.style.display=toolbar.style.display="none";
    shade.style.display="block";
    return;
  }
  shade.style.display="none";
  selection.style.display="block";
  selection.style.left=rect.x+"px";
  selection.style.top=rect.y+"px";
  selection.style.width=rect.width+"px";
  selection.style.height=rect.height+"px";
  if(kind==="locked"){
    toolbar.style.display="flex";
    placeToolbar(rect);
  }else{
    toolbar.style.display="none";
  }
}

/**
 * Soft exclusive hover (pre-lock): only one display shows a window preview.
 * Title nonce ensures Electron emits page-title-updated every claim.
 */
function claimHoverOwnership(){
  if(ownsHover||phase==="locked"||phase==="blocked")return;
  ownsHover=true;
  claimSeq+=1;
  document.title="__selection_owner__:"+displayId+":"+claimSeq;
}

function releaseHoverOwnership(){
  ownsHover=false;
}

/** Clear hover/drag on this display (another display is hovering, or pointer left). */
window.resetSelectionState=()=>{
  if(phase==="locked"||phase==="blocked")return;
  phase="hover";
  press=null;
  preview=null;
  rect=null;
  releaseHoverOwnership();
  render(null,"none");
};

/**
 * Another display finalized a pick/region — freeze this overlay.
 * No further window pick or custom drag until the capture ends.
 */
window.blockFurtherSelection=()=>{
  if(phase==="locked")return;
  phase="blocked";
  press=null;
  preview=null;
  rect=null;
  releaseHoverOwnership();
  render(null,"none");
  document.body.style.cursor="default";
};

function clearHoverOnly(){
  if(phase!=="hover")return;
  press=null;
  preview=null;
  rect=null;
  releaseHoverOwnership();
  render(null,"none");
}

/**
 * Finalize the sole selection on this display. After this, every display
 * (including this one) only allows Confirm / Cancel — no re-select.
 */
function lockSelection(next){
  if(phase==="blocked")return;
  const r=clampRect(next);
  if(!r||r.width<3||r.height<3){
    phase="hover";
    press=null;
    preview=null;
    rect=null;
    releaseHoverOwnership();
    render(null,"none");
    return;
  }
  phase="locked";
  press=null;
  preview=null;
  ownsHover=false;
  claimSeq+=1;
  // Hard lock: main process blocks every other overlay.
  document.title="__selection_locked__:"+displayId+":"+claimSeq;
  render(r,"locked");
  document.body.style.cursor="default";
}

function updateHoverPreview(event){
  if(phase!=="hover"||!windowRects.length)return;
  preview=screenHitToClient(event.screenX,event.screenY);
  if(preview){
    claimHoverOwnership();
    render(preview,"preview");
  }else if(ownsHover){
    clearHoverOnly();
  }else{
    render(null,"none");
  }
}

/** Clear hover preview when the cursor leaves this display (multi-monitor). */
window.clearHoverPreview=()=>{
  if(phase!=="hover"||press)return;
  clearHoverOnly();
};
addEventListener("pointerleave",()=>window.clearHoverPreview());
addEventListener("mouseleave",()=>window.clearHoverPreview());
addEventListener("blur",()=>window.clearHoverPreview());

addEventListener("mousedown",event=>{
  if(event.target.closest("#toolbar"))return;
  // Locked / blocked: only toolbar Confirm/Cancel (and Esc/Enter).
  if(!canInteract())return;
  press={x:event.clientX,y:event.clientY};
});

addEventListener("mousemove",event=>{
  if(phase==="locked"||phase==="blocked")return;
  if(press){
    if(phase!=="hover"&&phase!=="drag")return;
    const w=Math.abs(event.clientX-press.x),h=Math.abs(event.clientY-press.y);
    if(w>=DRAG_THRESHOLD||h>=DRAG_THRESHOLD){
      if(phase!=="drag"){
        phase="drag";
        preview=null;
        claimHoverOwnership();
      }
      render({
        x:Math.min(press.x,event.clientX),
        y:Math.min(press.y,event.clientY),
        width:Math.max(w,1),
        height:Math.max(h,1)
      },"drag");
    }
    return;
  }
  updateHoverPreview(event);
});

addEventListener("mouseup",event=>{
  if(!press)return;
  const wasDrag=phase==="drag";
  const start=press;
  press=null;
  // If lock/block landed mid-gesture, drop the gesture.
  if(phase==="locked"||phase==="blocked")return;
  if(wasDrag){
    const w=Math.abs(event.clientX-start.x),h=Math.abs(event.clientY-start.y);
    if(w>=DRAG_THRESHOLD||h>=DRAG_THRESHOLD){
      lockSelection({
        x:Math.min(start.x,event.clientX),
        y:Math.min(start.y,event.clientY),
        width:w,
        height:h
      });
    }else{
      phase="hover";
      updateHoverPreview(event);
    }
    return;
  }
  // Click a window → lock that single pick (then Confirm/Cancel only).
  const hit=screenHitToClient(event.screenX,event.screenY);
  if(hit)lockSelection(hit);
});

function accept(){
  if(phase!=="locked"||!rect||rect.width<3||rect.height<3)return;
  document.title="__region__:"+[displayId,rect.x,rect.y,rect.width,rect.height,innerWidth,innerHeight].join(",");
}
document.querySelector("#accept").onclick=accept;
document.querySelector("#cancel").onclick=()=>document.title="__cancel__";
addEventListener("keydown",event=>{
  if(event.key==="Escape")document.title="__cancel__";
  if(event.key==="Enter")accept();
});
</script></body></html>`;
}

function pairDisplaysWithSources(
  displays: Display[],
  sources: DesktopCapturerSource[],
): DisplayCapture[] {
  const unused = new Set(sources);
  return displays.map((display, index) => {
    let source = sources.find(
      (candidate) =>
        unused.has(candidate) &&
        candidate.display_id === String(display.id),
    );
    if (!source && sources.length === displays.length) {
      source = sources[index];
    }
    if (!source) {
      throw new Error(`Could not match display ${display.id} to a screen source.`);
    }
    unused.delete(source);
    return { display, source };
  });
}

function injectSnapRects(
  win: BrowserWindow,
  rects: SnapWindowRect[],
): Promise<unknown> {
  if (win.isDestroyed()) return Promise.resolve(undefined);
  return win.webContents.executeJavaScript(
    `window.setWindowSnapRects(${JSON.stringify(rects)})`,
    true,
  );
}

export type MultiRegionOptions = {
  delayFreezeMs?: number;
};

/**
 * Windows multi-display region: getUserMedia freeze in-overlay (no freeze PNGs).
 * Pre-lock: at most one hover/drag across displays. Once locked (window pick or
 * custom region), every overlay freezes — only Confirm / Cancel remain.
 */
export async function captureMultiDisplayRegion(
  options?: MultiRegionOptions,
): Promise<NativeImage> {
  const startedAt = performance.now();
  const delayFreezeMs = Math.max(0, options?.delayFreezeMs ?? 0);
  const freezeGate =
    delayFreezeMs > 0
      ? new Promise<void>((resolve) => setTimeout(resolve, delayFreezeMs))
      : Promise.resolve();

  await purgeStaleScreenshotWorkspaces();
  // HTML shell only — no freeze image files.
  const workspace = await createScreenshotWorkspace("multi-region");
  void purgeStaleScreenshotWorkspaces({ keepDir: workspace.dir });

  // Concurrent with freeze/show: PowerShell window enum must not block the mask.
  const sourcesPromise = listScreenSourcesMeta();
  const snapRectsPromise = EXPERIMENTAL_WINDOW_SNAP
    ? listSnapWindowRectsDip()
    : Promise.resolve([] as SnapWindowRect[]);
  const displays = screen.getAllDisplays();
  const windows: BrowserWindow[] = [];

  try {
    const readyWindows = Promise.all(
      displays.map(async (display) => {
        const win = createScreenshotOverlayWindow(display);
        windows.push(win);
        const htmlPath = await workspace.writeText(
          `overlay-${display.id}.html`,
          overlayHtml(display.id),
        );
        await win.loadFile(htmlPath);
        win.setBounds({ ...display.bounds });
        return win;
      }),
    );

    // Race sources + overlays + hide grace; snap runs in parallel (not awaited here).
    const [sources] = await Promise.all([
      sourcesPromise,
      readyWindows,
      freezeGate,
    ]);

    console.info(
      `[grok-gui] screenshot sources ready: displays=${displays.length} sources=${sources.length} delayFreezeMs=${delayFreezeMs} elapsed=${Math.round(performance.now() - startedAt)}ms`,
    );
    const captures = pairDisplaysWithSources(displays, sources);

    // getUserMedia freeze in parallel across displays; still not waiting on snap.
    await Promise.all(
      captures.map(async ({ display, source }, index) => {
        const win = windows[index]!;
        const pixelW = Math.round(display.bounds.width * display.scaleFactor);
        const pixelH = Math.round(display.bounds.height * display.scaleFactor);
        const info = await win.webContents.executeJavaScript(
          `window.freezeFromSource(${JSON.stringify(source.id)}, ${pixelW}, ${pixelH})`,
          true,
        );
        console.info(
          `[grok-gui] freeze display=${display.id} scale=${display.scaleFactor} requested=${pixelW}x${pixelH} result=${JSON.stringify(info)} elapsed=${Math.round(performance.now() - startedAt)}ms`,
        );
      }),
    );
    console.info(
      `[grok-gui] screenshot freeze frames ready: elapsed=${Math.round(performance.now() - startedAt)}ms`,
    );

    return await new Promise<NativeImage>((resolve, reject) => {
      let settled = false;
      const finish = (error: Error | null, image?: NativeImage) => {
        if (settled) return;
        settled = true;
        for (const win of windows) {
          if (!win.isDestroyed()) win.close();
        }
        if (error) reject(error);
        else resolve(image!);
      };

      captures.forEach(({ display }, index) => {
        const win = windows[index]!;
        win.on("closed", () => {
          if (!settled) finish(new ScreenshotCancelled());
        });
        win.webContents.on("render-process-gone", (_event, details) =>
          finish(
            new Error(
              `Screenshot overlay crashed (${details.reason}, exit ${details.exitCode}).`,
            ),
          ),
        );
        win.webContents.on("will-navigate", (event) => event.preventDefault());
        win.webContents.on("page-title-updated", (event, title) => {
          event.preventDefault();
          if (title === "__cancel__") return finish(new ScreenshotCancelled());
          // Soft exclusive hover/drag (pre-lock): clear previews on other displays.
          if (title.startsWith("__selection_owner__:")) {
            // Format: __selection_owner__:<displayId>:<nonce>
            const ownerToken =
              title.slice("__selection_owner__:".length).split(":")[0] ?? "";
            if (!ownerToken) return;
            captures.forEach(({ display: d }, i) => {
              if (String(d.id) === ownerToken) return;
              const other = windows[i]!;
              if (other.isDestroyed()) return;
              void other.webContents
                .executeJavaScript(
                  "window.resetSelectionState&&window.resetSelectionState()",
                  true,
                )
                .catch(() => undefined);
            });
            return;
          }
          // Hard lock: one final pick/region — freeze every other display.
          if (title.startsWith("__selection_locked__:")) {
            // Format: __selection_locked__:<displayId>:<nonce>
            const ownerToken =
              title.slice("__selection_locked__:".length).split(":")[0] ?? "";
            if (!ownerToken) return;
            captures.forEach(({ display: d }, i) => {
              const other = windows[i]!;
              if (other.isDestroyed()) return;
              if (String(d.id) === ownerToken) {
                // Keep keyboard Confirm on the display that owns the selection.
                other.focus();
                return;
              }
              void other.webContents
                .executeJavaScript(
                  "window.blockFurtherSelection&&window.blockFurtherSelection()",
                  true,
                )
                .catch(() => undefined);
            });
            return;
          }
          if (!title.startsWith("__region__:")) return;
          const parts = title.slice("__region__:".length).split(",");
          const displayToken = parts[0] ?? "";
          const [x, y, width, height, viewportWidth, viewportHeight] = parts
            .slice(1)
            .map(Number);
          if (
            displayToken !== String(display.id) ||
            ![x, y, width, height, viewportWidth, viewportHeight].every(
              Number.isFinite,
            )
          ) {
            return finish(new Error("Invalid multi-display selection."));
          }
          void win.webContents
            .executeJavaScript(
              `window.exportCrop(${x},${y},${width},${height},${viewportWidth},${viewportHeight})`,
              true,
            )
            .then((dataUrl: string) => {
              const image = nativeImage.createFromDataURL(dataUrl);
              if (image.isEmpty()) {
                return finish(new Error("Cropped screenshot was empty."));
              }
              finish(null, image);
            })
            .catch((error) =>
              finish(error instanceof Error ? error : new Error(String(error))),
            );
        });
      });

      const focused = screen.getDisplayNearestPoint(
        screen.getCursorScreenPoint(),
      ).id;
      const focusIndex = captures.findIndex(
        ({ display }) => display.id === focused,
      );
      captures.forEach(({ display }, index) => {
        const win = windows[index]!;
        if (win.isDestroyed()) return;
        showScreenshotOverlayWindow(win, display, {
          focus: index === Math.max(0, focusIndex),
        });
      });
      console.info(
        `[grok-gui] screenshot overlays visible: count=${windows.length} elapsed=${Math.round(performance.now() - startedAt)}ms`,
      );

      // Multi-monitor: when the cursor is on display A, clear hover previews on
      // every other overlay (mouseleave is unreliable across HWNDs).
      const hoverSync = setInterval(() => {
        if (settled) {
          clearInterval(hoverSync);
          return;
        }
        if (captures.length < 2) return;
        const activeId = screen.getDisplayNearestPoint(
          screen.getCursorScreenPoint(),
        ).id;
        captures.forEach(({ display }, index) => {
          if (display.id === activeId) return;
          const win = windows[index]!;
          if (win.isDestroyed()) return;
          void win.webContents
            .executeJavaScript("window.clearHoverPreview&&window.clearHoverPreview()", true)
            .catch(() => undefined);
        });
      }, 32);

      void snapRectsPromise.then((snapRects) => {
        if (settled || !snapRects.length) return;
        console.info(
          `[grok-gui] window snap inject: count=${snapRects.length} elapsed=${Math.round(performance.now() - startedAt)}ms`,
        );
        for (const win of windows) {
          if (!win.isDestroyed()) void injectSnapRects(win, snapRects);
        }
      });
    });
  } finally {
    for (const win of windows) {
      if (!win.isDestroyed()) win.destroy();
    }
    await workspace.cleanup();
  }
}
