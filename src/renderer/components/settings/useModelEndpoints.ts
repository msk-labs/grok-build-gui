import { useCallback, useEffect, useState } from "react";
import type {
  CustomEndpoint,
  CustomEndpointInput,
  EndpointPreset,
} from "../../../electron/preload";

/**
 * User-added model endpoints. The main process owns the API keys, so the form
 * only ever sends a key and reads back whether one is stored.
 */
export function useModelEndpoints() {
  const [endpoints, setEndpoints] = useState<CustomEndpoint[]>([]);
  const [presets, setPresets] = useState<EndpointPreset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!window.grok?.listModelEndpoints) return;
    setEndpoints(await window.grok.listModelEndpoints());
  }, []);

  useEffect(() => {
    void refresh();
    void window.grok?.getEndpointPresets?.().then(setPresets);
  }, [refresh]);

  const save = useCallback(
    async (input: CustomEndpointInput): Promise<boolean> => {
      if (!window.grok?.saveModelEndpoint) return false;
      setBusy(true);
      setError(null);
      try {
        const result = await window.grok.saveModelEndpoint(input);
        if (!result.ok) {
          setError(result.error);
          return false;
        }
        await refresh();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!window.grok?.removeModelEndpoint) return;
      setBusy(true);
      try {
        await window.grok.removeModelEndpoint(id);
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return { endpoints, presets, busy, error, save, remove, refresh };
}
