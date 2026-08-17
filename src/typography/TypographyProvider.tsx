import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { importFont, readFont, removeFont } from "./api";
import {
  DEFAULT_TYPOGRAPHY,
  type ImportedFontAsset,
  type TypographyConfig,
  type TypographyController,
  type TypographyRuntime,
  importedFontFamily,
} from "./contracts";
import { typographySizeTokens } from "./sizing";
import {
  findActiveImportedFont,
  loadTypography,
  resolveTypographyFontFamily,
  saveTypography,
  typographyFontStacks,
} from "./storage";

const TypographyContext = createContext<TypographyController | null>(null);

export function TypographyProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState(loadTypography);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const imported = useImportedFont(findActiveImportedFont(config));
  const runtime = useMemo<TypographyRuntime>(() => ({
    fontFamily: resolveTypographyFontFamily(config, imported.ready),
    fontSize: config.fontSize,
  }), [config, imported.ready, imported.revision]);

  useEffect(() => applyTypographyCss(runtime), [runtime]);
  useEffect(() => saveTypography(config), [config]);

  const update = useCallback((patch: Partial<TypographyConfig>) => {
    setConfig((previous) => ({ ...previous, ...patch }));
  }, []);
  const pick = useCallback(
    () => pickImportedFont({ setConfig, setBusy, setError: setActionError }),
    [],
  );
  const clearImported = useCallback(
    (fileName: string) => clearImportedFont(fileName, {
      setConfig,
      setBusy,
      setError: setActionError,
    }),
    [],
  );
  const reset = useCallback(async () => {
    setActionError(null);
    setConfig((previous) => ({
      ...DEFAULT_TYPOGRAPHY,
      importedFonts: previous.importedFonts,
    }));
  }, []);

  const controller = useMemo<TypographyController>(() => ({
    config,
    runtime,
    busy,
    error: actionError ?? imported.error,
    update,
    pick,
    clearImported,
    reset,
  }), [config, runtime, busy, actionError, imported.error, update, pick, clearImported, reset]);

  return <TypographyContext value={controller}>{children}</TypographyContext>;
}

type ConfigSetter = Dispatch<SetStateAction<TypographyConfig>>;
type BooleanSetter = Dispatch<SetStateAction<boolean>>;
type ErrorSetter = Dispatch<SetStateAction<string | null>>;

interface TypographyActionSetters {
  setConfig: ConfigSetter;
  setBusy: BooleanSetter;
  setError: ErrorSetter;
}

async function pickImportedFont(setters: TypographyActionSetters) {
  const { setConfig, setBusy, setError } = setters;
  setError(null);
  const selected = await pickFontPath().catch((error) => {
    setError(errorMessage(error));
    return null;
  });
  if (!selected) return;
  setBusy(true);
  try {
    const asset = await importFont(selected);
    setConfig((previous) => ({
      ...previous,
      activeImportedFont: asset.fileName,
      importedFonts: [
        ...previous.importedFonts.filter((font) => font.fileName !== asset.fileName),
        asset,
      ],
    }));
  } catch (error) {
    setError(errorMessage(error));
  } finally {
    setBusy(false);
  }
}

async function clearImportedFont(fileName: string, setters: TypographyActionSetters) {
  const { setConfig, setBusy, setError } = setters;
  setBusy(true);
  setError(null);
  try {
    await removeFont(fileName);
    setConfig((previous) => ({
      ...previous,
      activeImportedFont: previous.activeImportedFont === fileName
        ? null
        : previous.activeImportedFont,
      importedFonts: previous.importedFonts.filter((font) => font.fileName !== fileName),
    }));
  } catch (error) {
    setError(errorMessage(error));
  } finally {
    setBusy(false);
  }
}

export function useTypography() {
  const controller = useContext(TypographyContext);
  if (!controller) throw new Error("useTypography 必须在 TypographyProvider 内使用");
  return controller;
}

function useImportedFont(asset: ImportedFontAsset | null) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const faceRef = useRef<FontFace | null>(null);

  useEffect(() => {
    if (!asset) {
      releaseFontFace(faceRef);
      setReady(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setError(null);
    void loadFontFace(asset).then((face) => {
      if (cancelled) return;
      releaseFontFace(faceRef);
      document.fonts.add(face);
      faceRef.current = face;
      setReady(true);
      setRevision((value) => value + 1);
    }).catch((cause) => {
      if (cancelled) return;
      releaseFontFace(faceRef);
      setReady(false);
      setError(`字体文件无法加载：${errorMessage(cause)}`);
    });
    return () => {
      cancelled = true;
    };
  }, [asset]);

  useEffect(() => () => releaseFontFace(faceRef), []);
  return { ready, error, revision };
}

async function loadFontFace(asset: ImportedFontAsset) {
  const bytes = await readFont(asset.fileName);
  return new FontFace(importedFontFamily(asset.fileName), bytes).load();
}

function releaseFontFace(ref: { current: FontFace | null }) {
  if (ref.current) document.fonts.delete(ref.current);
  ref.current = null;
}

function applyTypographyCss(runtime: TypographyRuntime) {
  const root = document.documentElement;
  const stacks = typographyFontStacks(runtime.fontFamily);
  const sizes = typographySizeTokens(runtime.fontSize);
  root.style.setProperty("--font-sans", stacks.ui);
  root.style.setProperty("--font-mono", stacks.mono);
  root.style.setProperty("--font-terminal", stacks.mono);
  root.style.setProperty("--app-font-size", `${runtime.fontSize}px`);
  root.style.setProperty("--fs-xs", `${sizes.xs}px`);
  root.style.setProperty("--fs-sm", `${sizes.sm}px`);
  root.style.setProperty("--fs-md", `${sizes.md}px`);
  root.style.setProperty("--fs-display", `${sizes.display}px`);
}

function pickFontPath() {
  return openDialog({
    directory: false,
    multiple: false,
    title: "导入字体",
    filters: [{ name: "字体", extensions: ["ttf", "otf", "woff", "woff2"] }],
  }).then((selected) => typeof selected === "string" ? selected : null);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
