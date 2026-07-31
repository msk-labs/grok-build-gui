import {
  BrowserWindow,
  type DesktopCapturerSource,
} from "electron";
import { createScreenshotWorkspace } from "./screenshotTemp.js";
import { ScreenshotCancelled } from "./screenshotTypes.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pickerHtml(
  kind: "screen" | "window",
  sources: DesktopCapturerSource[],
): string {
  const cards = sources
    .map(
      (source, index) => `<button class="card" data-index="${index}">
        <img src="./preview-${index}.png" alt=""/>
        <span>${escapeHtml(source.name || `${kind} ${index + 1}`)}</span>
      </button>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;background:#f9f9f9;color:#2a2c2f;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{padding:20px}h1{font-size:16px;margin:0 0 14px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.card{min-width:0;padding:8px;border:1px solid rgba(42,44,47,.12);border-radius:10px;background:#fff;text-align:left;cursor:pointer}
.card:hover,.card:focus{border-color:#0f766e;outline:none}.card img{display:block;width:100%;height:150px;object-fit:contain;background:#eee;border-radius:6px}
.card span{display:block;padding:7px 2px 1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.hint{margin-top:14px;color:rgba(42,44,47,.6);font-size:12px}
</style></head><body><main><h1>Select a ${kind}</h1><div class="grid">${cards}</div><div class="hint">Press Esc to cancel</div></main>
<script>
document.querySelectorAll(".card").forEach((button)=>button.onclick=()=>{document.title="__pick__:"+button.dataset.index});
addEventListener("keydown",(event)=>{if(event.key==="Escape")document.title="__cancel__"});
</script></body></html>`;
}

export async function pickSource(
  parent: BrowserWindow | null,
  kind: "screen" | "window",
  sources: DesktopCapturerSource[],
): Promise<DesktopCapturerSource> {
  if (sources.length === 0) {
    throw new Error(`No capturable ${kind}s were found.`);
  }
  if (sources.length === 1) return sources[0]!;

  const workspace = await createScreenshotWorkspace("picker");
  try {
    await Promise.all(
      sources.map((source, index) =>
        workspace.writeImage(`preview-${index}.png`, source.thumbnail),
      ),
    );
    const htmlPath = await workspace.writeText(
      "picker.html",
      pickerHtml(kind, sources),
    );
    return await new Promise<DesktopCapturerSource>((resolve, reject) => {
      const win = new BrowserWindow({
        width: 760,
        height: 600,
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
      const finish = (
        error: Error | null,
        source?: DesktopCapturerSource,
      ) => {
        if (settled) return;
        settled = true;
        if (!win.isDestroyed()) win.close();
        if (error) reject(error);
        else resolve(source!);
      };
      win.on("closed", () => finish(new ScreenshotCancelled()));
      win.webContents.on("render-process-gone", (_event, details) =>
        finish(
          new Error(
            `Screenshot source picker crashed (${details.reason}, exit ${details.exitCode}).`,
          ),
        ),
      );
      win.webContents.on("will-navigate", (event) => event.preventDefault());
      win.webContents.on("page-title-updated", (event, title) => {
        event.preventDefault();
        if (title === "__cancel__") return finish(new ScreenshotCancelled());
        if (!title.startsWith("__pick__:")) return;
        const index = Number(title.slice("__pick__:".length));
        const source = sources[index];
        if (!source) return finish(new Error("The selected source disappeared."));
        finish(null, source);
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
