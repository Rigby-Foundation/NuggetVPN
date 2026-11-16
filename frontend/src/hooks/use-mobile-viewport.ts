import { useEffect, useLayoutEffect } from "react";
import { isAndroid, isIOS } from "@/lib/platform";

export function useMobileViewport(compact: boolean) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute("data-compact", compact);
    return () => root.removeAttribute("data-compact");
  }, [compact]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!(isAndroid || isIOS) || !viewport) return;

    // The keyboard can resize the visible viewport without resizing the page.
    const style = document.documentElement.style;
    const height = "--app-viewport-height";
    const top = "--app-viewport-top";
    const bottom = "--app-viewport-bottom";
    const update = () => {
      if (viewport.scale !== 1) return;
      style.setProperty(height, `${viewport.height}px`);
      style.setProperty(top, `${viewport.offsetTop}px`);
      const layoutHeight = document.documentElement.clientHeight;
      style.setProperty(bottom, `${Math.max(0, layoutHeight - viewport.height - viewport.offsetTop)}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      style.removeProperty(height);
      style.removeProperty(top);
      style.removeProperty(bottom);
    };
  }, []);
}
