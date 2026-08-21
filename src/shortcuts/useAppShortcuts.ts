import { useCallback, useEffect, useRef, useState } from "react";
import {
  appShortcutChord,
  formatShortcutChord,
  resolveAppShortcut,
  shortcutPlatform,
  type AppShortcut,
} from "./resolveShortcut";

interface AppShortcutActions {
  blocked: boolean;
  composerOpen: boolean;
  quickOpenOpen: boolean;
  recipesOpen: boolean;
  onActivateSession: (index: number) => void;
  onNewShell: () => void;
  onOpenSettings: () => void;
  onToggleHistory: () => void;
  onToggleComposer: () => void;
  onToggleQuickOpen: () => void;
  onToggleRecipes: () => void;
  onToggleSidebar: () => void;
  onToggleUsage: () => void;
}

export function useAppShortcuts(actions: AppShortcutActions) {
  const [guideOpen, setGuideOpen] = useState(false);
  const [platform] = useState(() => shortcutPlatform(document.documentElement.dataset.platform));
  const actionsRef = useRef(actions);
  const guideOpenRef = useRef(guideOpen);
  actionsRef.current = actions;
  guideOpenRef.current = guideOpen;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = resolveAppShortcut(event, platform);
      if (!shortcut) return;
      if (actionsRef.current.composerOpen && shortcut.kind !== "toggle-composer") return;
      if (actionsRef.current.quickOpenOpen && shortcut.kind !== "toggle-quick-open") return;
      // Recipe 面板里有名称、变量、步骤好几个输入框，别让组合键从底下把面板换掉。
      if (actionsRef.current.recipesOpen && shortcut.kind !== "toggle-recipes") return;
      if (actionsRef.current.blocked) return;
      if (guideOpenRef.current && shortcut.kind !== "toggle-shortcuts") return;
      event.preventDefault();
      event.stopPropagation();
      runShortcut(shortcut, actionsRef.current, setGuideOpen);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [platform]);

  const openGuide = useCallback(() => setGuideOpen(true), []);
  const closeGuide = useCallback(() => setGuideOpen(false), []);
  return {
    closeGuide,
    guideOpen,
    guideTitle: formatShortcutChord(appShortcutChord(platform, "/")),
    openGuide,
    platform,
  };
}

function runShortcut(
  shortcut: AppShortcut,
  actions: AppShortcutActions,
  setGuideOpen: (update: (open: boolean) => boolean) => void,
) {
  if (shortcut.kind === "toggle-sidebar") actions.onToggleSidebar();
  else if (shortcut.kind === "toggle-usage") actions.onToggleUsage();
  else if (shortcut.kind === "toggle-history") actions.onToggleHistory();
  else if (shortcut.kind === "toggle-composer") actions.onToggleComposer();
  else if (shortcut.kind === "toggle-quick-open") actions.onToggleQuickOpen();
  else if (shortcut.kind === "toggle-recipes") actions.onToggleRecipes();
  else if (shortcut.kind === "open-settings") actions.onOpenSettings();
  else if (shortcut.kind === "new-shell") actions.onNewShell();
  else if (shortcut.kind === "activate-session") actions.onActivateSession(shortcut.index);
  else setGuideOpen((open) => !open);
}
