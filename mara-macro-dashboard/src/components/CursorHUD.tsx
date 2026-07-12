/**
 * CursorHUD — the reticle. A phosphor dot rides the pointer exactly; a
 * crosshair ring chases it with lerp lag and reacts to interactive targets
 * (locks wider) and mousedown (contracts, ember). Fine pointers only —
 * touch devices never see it and keep native behavior.
 */
import { useEffect, useRef } from "react";

const INTERACTIVE = "a, button, [role='button'], input, select, textarea, label, .mc-btn, .mc-tab, .duel-side, [data-cursor='active']";

export default function CursorHUD() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    document.body.classList.add("mara-cursor-on");

    const dot = dotRef.current!;
    const ring = ringRef.current!;
    let x = -100, y = -100;      // pointer truth
    let rx = -100, ry = -100;    // ring chase
    let raf = 0;
    let visible = false;

    const onMove = (e: PointerEvent) => {
      x = e.clientX; y = e.clientY;
      if (!visible) {
        visible = true;
        rx = x; ry = y;
        document.body.classList.remove("mara-cursor-hidden");
      }
      const target = e.target as Element | null;
      ring.classList.toggle("is-active", !!target?.closest?.(INTERACTIVE));
    };
    const onDown = () => ring.classList.add("is-down");
    const onUp = () => ring.classList.remove("is-down");
    const onLeave = () => {
      visible = false;
      document.body.classList.add("mara-cursor-hidden");
    };

    const tick = () => {
      rx += (x - rx) * 0.18;
      ry += (y - ry) * 0.18;
      dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    document.body.classList.add("mara-cursor-hidden");
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    document.documentElement.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.body.classList.remove("mara-cursor-on", "mara-cursor-hidden");
    };
  }, []);

  return (
    <>
      <div ref={dotRef} className="mara-cursor-dot" aria-hidden />
      <div ref={ringRef} className="mara-cursor-ring" aria-hidden />
    </>
  );
}
