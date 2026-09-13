import { useEffect, useState } from "react";
import { loadShortcutSettings, subscribeShortcutSettings } from "./storage";

export function useShortcutSettings() {
  const [loaded, setLoaded] = useState(loadShortcutSettings);
  useEffect(() => {
    const reload = () => setLoaded(loadShortcutSettings());
    const unsubscribe = subscribeShortcutSettings(reload);
    reload();
    return unsubscribe;
  }, []);
  return loaded;
}
