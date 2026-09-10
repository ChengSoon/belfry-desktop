import { useEffect, useRef, useState } from "react";
import { pluginError } from "../hostClient";
import { centerApi } from "./api";

export function usePersonalMarketName() {
  const [name, setName] = useState("我的插件市场"), [saved, setSaved] = useState(name);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    let live = true;
    void centerApi.personalMarket().then((info) => {
      if (live) { setName(info.name); setSaved(info.name); }
    }).catch((reason) => { if (live) setError(pluginError(reason)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);
  const save = () => {
    if (pending.current) return pending.current;
    if (!name.trim()) { setName(saved); return Promise.resolve(true); }
    if (name.trim() === saved) return Promise.resolve(true);
    setSaving(true); setError("");
    pending.current = centerApi.nameMarket(name).then((info) => {
      setSaved(info.name); setName(info.name); return true;
    }).catch((reason) => { setError(pluginError(reason)); return false; })
      .finally(() => { pending.current = null; setSaving(false); });
    return pending.current;
  };
  return { name, setName, loading, saving, error, save };
}
