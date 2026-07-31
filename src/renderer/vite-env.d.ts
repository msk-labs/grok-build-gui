/// <reference types="vite/client" />

import type { GrokApi } from "../electron/preload";

declare global {
  interface Window {
    grok?: GrokApi;
  }
}

export {};
