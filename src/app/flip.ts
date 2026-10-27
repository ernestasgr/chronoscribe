import { useLayoutEffect, useRef, type RefObject } from "react";

/** How long a row takes to slide to its new place. */
const SLIDE_MS = 260;

const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Slides each child of `list` from where it was to where it now is after every render (FLIP),
 * so reordered rows glide to their new places on the compositor instead of jumping. Children are
 * told apart by their `data-flip` attribute. A row moved mid-slide carries on from where it is.
 */
export function useFlip(list: RefObject<HTMLElement | null>): void {
    const tops = useRef(new Map<string, number>());

    useLayoutEffect(() => {
        const element = list.current;
        if (!element) return;
        const items = [...element.children].filter((item) => item instanceof HTMLElement);
        // Tops within the list, so scrolling the panel doesn't count as a move.
        const topOf = (item: HTMLElement) =>
            item.getBoundingClientRect().top - element.getBoundingClientRect().top;
        // Each row's offset from any slide still running, read before that slide is cancelled.
        const sliding = items.map(topOf);
        items.forEach((item) => item.getAnimations().forEach((animation) => animation.cancel()));
        const now = items.map(topOf);
        const reduced = prefersReducedMotion();

        items.forEach((item, i) => {
            const before = tops.current.get(item.dataset.flip ?? "");
            if (before === undefined || reduced) return;
            const from = before + (sliding[i]! - now[i]!) - now[i]!;
            if (Math.abs(from) < 0.5) return;
            item.animate([{ transform: `translateY(${from}px)` }, { transform: "translateY(0)" }], {
                duration: SLIDE_MS,
                easing: "ease-in-out",
            });
        });
        tops.current = new Map(items.map((item, i) => [item.dataset.flip ?? "", now[i]!]));
    });
}
