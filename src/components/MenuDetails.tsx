"use client";

import { Children, cloneElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** A disclosure with viewport-aware placement; focus changes never eat a click. */
export function MenuDetails({ children, className = "" }: { children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false });
  const [summary, content] = Children.toArray(children) as ReactElement[];
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!trigger.current || !panel.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const box = panel.current.getBoundingClientRect();
      const above = String(content.props.className).includes("bottom-full");
      const alignLeft = String(content.props.className).includes("left-0");
      let top = above ? anchor.top - box.height - 8 : anchor.bottom + 8;
      if (top + box.height > window.innerHeight - 8) top = anchor.top - box.height - 8;
      if (top < 8) top = 8;
      setPosition({ left: Math.max(8, Math.min(alignLeft ? anchor.left : anchor.right - box.width, window.innerWidth - box.width - 8)), top, ready: true });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, content.props.className]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", keydown); };
  }, [open]);
  return <div className={className} data-menu-open={open || undefined}>
    <button {...summary.props} type="button" ref={trigger} aria-expanded={open} onClick={() => setOpen(value => !value)} />
    {open && createPortal(<div ref={panel} className="menu-portal" style={{ left: position.left, top: position.top, visibility: position.ready ? "visible" : "hidden" }}
      onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== trigger.current) close(); }}
      onClick={event => { if ((event.target as HTMLElement).closest('a, [data-close-menu]')) close(true); }}>
      {cloneElement(content, { style: { ...content.props.style, position: "relative", inset: "auto", margin: 0, maxWidth: "calc(100vw - 16px)", maxHeight: "calc(100dvh - 16px)", overflowY: className.includes("message-actions") ? "visible" : "auto" } })}
    </div>, document.body)}
  </div>;
}
