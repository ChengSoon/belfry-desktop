import { useCallback, useRef, useState } from "react";
import {
  clampPanelWidth,
  loadPanelWidth,
  savePanelWidth,
  type PanelWidthSpec,
} from "./panelWidth";

function responsiveDefaultWidth(spec: PanelWidthSpec) {
  if (typeof window === "undefined") return spec.defaultWidth;
  return window.innerWidth <= 1000 ? spec.compactWidth : spec.defaultWidth;
}

export function usePanelWidth(spec: PanelWidthSpec) {
  const defaultWidth = useRef(responsiveDefaultWidth(spec)).current;
  const [width, setWidthState] = useState(() => loadPanelWidth(spec, defaultWidth));
  const widthRef = useRef(width);

  const setWidth = useCallback((nextWidth: number) => {
    const clamped = clampPanelWidth(spec, nextWidth);
    widthRef.current = clamped;
    setWidthState(clamped);
  }, [spec]);

  const commitWidth = useCallback(() => savePanelWidth(spec, widthRef.current), [spec]);
  const resetWidth = useCallback(() => {
    widthRef.current = defaultWidth;
    setWidthState(defaultWidth);
    savePanelWidth(spec, defaultWidth);
  }, [defaultWidth, spec]);

  return { commitWidth, resetWidth, setWidth, width };
}
