import { useCallback, useEffect, useState } from "react";

export type Palette = "mint" | "sage" | "plum" | "indigo";
export type Voice   = "editorial" | "modern" | "classical";
export type Density = "compact" | "comfortable" | "spacious";

interface Tweaks { palette: Palette; voice: Voice; density: Density; }

const DEFAULTS: Tweaks = { palette: "mint", voice: "editorial", density: "comfortable" };

function read(): Tweaks {
  if (typeof localStorage === "undefined") return DEFAULTS;
  return {
    palette: (localStorage.getItem("clinic.palette") as Palette) ?? DEFAULTS.palette,
    voice:   (localStorage.getItem("clinic.voice")   as Voice)   ?? DEFAULTS.voice,
    density: (localStorage.getItem("clinic.density") as Density) ?? DEFAULTS.density,
  };
}

function apply(t: Tweaks) {
  const root = document.documentElement;
  // palette — "mint" is the default (no data-palette attr); others set the attr
  if (t.palette === "mint") root.removeAttribute("data-palette");
  else root.setAttribute("data-palette", t.palette);
  // voice — "editorial" is default
  if (t.voice === "editorial") root.removeAttribute("data-voice");
  else root.setAttribute("data-voice", t.voice);
  // density — "comfortable" is default
  if (t.density === "comfortable") root.removeAttribute("data-density");
  else root.setAttribute("data-density", t.density);
}

/** Manages palette / voice / density; persists in localStorage and applies
 *  data-* attributes to <html>. Namespaced separately from the light/dark theme. */
export function useTweaks() {
  const [tweaks, setTweaksState] = useState<Tweaks>(read);

  useEffect(() => { apply(tweaks); }, [tweaks]);

  const setTweaks = useCallback((patch: Partial<Tweaks>) => {
    setTweaksState(prev => {
      const next = { ...prev, ...patch };
      localStorage.setItem("clinic.palette", next.palette);
      localStorage.setItem("clinic.voice",   next.voice);
      localStorage.setItem("clinic.density", next.density);
      return next;
    });
  }, []);

  return { tweaks, setTweaks };
}
