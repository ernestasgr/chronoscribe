import { scaleLinear, type ScaleLinear } from "d3-scale";
import { useEffect, useState, type RefObject } from "react";
import type { DayWindow } from "../standings";

/** The space around the plot; the minimap shares the horizontal margins so their Days line up. */
export const MARGIN = { left: 56, right: 16, top: 16, bottom: 28 };

export interface Size {
    width: number;
    height: number;
}

export interface Plot {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

export const plotOf = ({ width, height }: Size): Plot => ({
    left: MARGIN.left,
    right: Math.max(MARGIN.left + 1, width - MARGIN.right),
    top: MARGIN.top,
    bottom: Math.max(MARGIN.top + 1, height - MARGIN.bottom),
});

/** The pixel scale of a window, widened around a single Day so it never collapses. */
export function dayScale({ start, end }: DayWindow, plot: Plot): ScaleLinear<number, number> {
    const domain = end - start < 1e-9 ? [start - 0.5, end + 0.5] : [start, end];
    return scaleLinear().domain(domain).range([plot.left, plot.right]);
}

/** The element's content size, following every resize. */
export function useSize(element: RefObject<HTMLElement | null>): Size | undefined {
    const [size, setSize] = useState<Size>();
    useEffect(() => {
        const observed = element.current;
        if (!observed) return;
        const observer = new ResizeObserver(([entry]) => {
            if (!entry) return;
            const { width, height } = entry.contentRect;
            setSize({ width, height });
        });
        observer.observe(observed);
        return () => observer.disconnect();
    }, [element]);
    return size;
}
