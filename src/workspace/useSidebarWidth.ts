import { useCallback, useRef, useState } from "react";
import {
  SIDEBAR_WIDTH_COMPACT,
  SIDEBAR_WIDTH_DEFAULT,
  clampSidebarWidth,
  loadSidebarWidth,
  saveSidebarWidth,
} from "./sidebarWidth";

function responsiveDefaultWidth() {
  if (typeof window === "undefined") return SIDEBAR_WIDTH_DEFAULT;
  return window.innerWidth <= 900 ? SIDEBAR_WIDTH_COMPACT : SIDEBAR_WIDTH_DEFAULT;
}

export function useSidebarWidth() {
  const defaultWidth = useRef(responsiveDefaultWidth()).current;
  const [width, setWidthState] = useState(() => loadSidebarWidth(defaultWidth));
  const widthRef = useRef(width);

  const setWidth = useCallback((nextWidth: number) => {
    const clamped = clampSidebarWidth(nextWidth);
    widthRef.current = clamped;
    setWidthState(clamped);
  }, []);

  const commitWidth = useCallback(() => saveSidebarWidth(widthRef.current), []);
  const resetWidth = useCallback(() => {
    widthRef.current = defaultWidth;
    setWidthState(defaultWidth);
    saveSidebarWidth(defaultWidth);
  }, [defaultWidth]);

  return { commitWidth, resetWidth, setWidth, width };
}
