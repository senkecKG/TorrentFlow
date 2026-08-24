import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getSnapshot } from "../lib/api";
import type { Snapshot } from "../lib/types";

let latest: Snapshot | null = null;

export function peekSnapshot(): Snapshot | null {
  return latest;
}

export function useSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(latest);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const snap = await getSnapshot();
      if (!alive.current) return;
      latest = snap;
      setSnapshot(snap);
    } catch {
      // backend not ready yet; event or next poll will populate
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    refresh();
    const unlistenP = listen<Snapshot>("torrents://update", (e) => {
      latest = e.payload;
      if (alive.current) setSnapshot(e.payload);
    });
    const poll = setInterval(refresh, 15000);
    return () => {
      alive.current = false;
      unlistenP.then((u) => u());
      clearInterval(poll);
    };
  }, [refresh]);

  return { snapshot, refresh };
}
