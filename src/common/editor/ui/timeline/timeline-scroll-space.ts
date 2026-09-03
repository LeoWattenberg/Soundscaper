/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Browsers cap how wide a laid-out box may be, so the timeline cannot make its
 * scroll surface as wide as the project at Audacity-depth zoom: one minute at
 * six million pixels per second is already twenty-two thousand times this
 * ceiling. The surface is therefore capped and the browser's scroll offset is
 * scaled onto the far larger content space the timeline actually draws in.
 *
 * Content coordinates are the honest ones — a position is `seconds *
 * pixelsPerSecond` — and every element drawn inside the scrolled box is offset
 * by `renderOriginX` so it lands under the scaled scroll position. While the
 * project fits under the cap the scale is exactly one and the origin exactly
 * zero, so ordinary zoom levels behave as they always did.
 */
export const TIMELINE_MAX_SCROLL_PIXELS = 16_000_000;

export interface TimelineScrollSpaceOptions {
	readonly contentWidth: number;
	readonly viewportWidth: number;
	readonly maximumScrollWidth?: number;
}

export interface TimelineScrollSpace {
	/** Width of the timeline in content pixels, unbounded by browser limits. */
	readonly contentWidth: number;
	/** Width the scroll surface is actually laid out at. */
	readonly scrollWidth: number;
	readonly viewportWidth: number;
	/** Content pixels travelled per pixel of browser scroll offset. */
	readonly scale: number;
}

/** Describe how a project's content width maps onto a laid-out scroll surface. */
export function createTimelineScrollSpace({
	contentWidth,
	viewportWidth,
	maximumScrollWidth = TIMELINE_MAX_SCROLL_PIXELS,
}: TimelineScrollSpaceOptions): TimelineScrollSpace {
	const content = positiveFinite(contentWidth, 'contentWidth');
	const viewport = positiveFinite(viewportWidth, 'viewportWidth');
	const maximum = positiveFinite(maximumScrollWidth, 'maximumScrollWidth');
	const scrollWidth = Math.max(viewport, Math.min(content, maximum));
	const domTravel = scrollWidth - viewport;
	const contentTravel = Math.max(0, content - viewport);
	return Object.freeze({
		contentWidth: Math.max(content, viewport),
		scrollWidth,
		viewportWidth: viewport,
		scale: domTravel > 0 && contentTravel > domTravel ? contentTravel / domTravel : 1,
	});
}

/** Convert a browser scroll offset into the content position it represents. */
export function timelineContentScrollX(space: TimelineScrollSpace, domScrollLeft: number): number {
	const dom = clampScroll(domScrollLeft, space.scrollWidth - space.viewportWidth);
	return space.scale === 1 ? dom : dom * space.scale;
}

/** Convert a content position into the browser scroll offset that reveals it. */
export function timelineDomScrollX(space: TimelineScrollSpace, contentScrollX: number): number {
	const content = clampScroll(contentScrollX, space.contentWidth - space.viewportWidth);
	return space.scale === 1 ? content : content / space.scale;
}

/**
 * The offset added to a content coordinate to place it inside the scrolled box.
 * It is zero whenever the surface is drawn at its true width.
 */
export function timelineRenderOriginX(space: TimelineScrollSpace, domScrollLeft: number): number {
	if (space.scale === 1) return 0;
	const dom = clampScroll(domScrollLeft, space.scrollWidth - space.viewportWidth);
	return dom - timelineContentScrollX(space, dom);
}

/** Read the scale a rendered timeline published on its scroll element. */
export function readTimelineScrollScale(element: { readonly dataset?: DOMStringMap } | null): number {
	const raw = Number(element?.dataset?.timelineScrollScale);
	return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/** Read a live scroll element's position in content pixels. */
export function readTimelineContentScrollX(element: { readonly scrollLeft?: number; readonly dataset?: DOMStringMap } | null): number {
	const dom = Number(element?.scrollLeft);
	return (Number.isFinite(dom) ? Math.max(0, dom) : 0) * readTimelineScrollScale(element);
}

/**
 * Scroll a live element to a content position, clamped to its scroll range.
 * Returns the browser scroll offset that was applied.
 */
export function timelineDomScrollForElement(
	element: { readonly scrollWidth?: number; readonly clientWidth?: number; readonly dataset?: DOMStringMap } | null,
	contentScrollX: number,
): number {
	const maximum = Math.max(0, (Number(element?.scrollWidth) || 0) - (Number(element?.clientWidth) || 0));
	const requested = Number(contentScrollX);
	const dom = (Number.isFinite(requested) ? requested : 0) / readTimelineScrollScale(element);
	return Math.max(0, Math.min(maximum, dom));
}

/**
 * Express a content coordinate as a CSS length inside the scrolled surface.
 * The origin is published as a custom property so scrolling can move drawn
 * content without a React render, and so it stays zero at ordinary zoom.
 */
export function timelineContentLeft(contentX: number): string {
	const numeric = Number(contentX);
	return `calc(${Number.isFinite(numeric) ? numeric : 0}px + var(--timeline-render-origin-x, 0px))`;
}

function clampScroll(value: number, maximum: number): number {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return 0;
	return Math.max(0, Math.min(Math.max(0, maximum), numeric));
}

function positiveFinite(value: number, name: string): number {
	const numeric = Number(value);
	if (!Number.isFinite(numeric) || numeric <= 0) throw new RangeError(`${name} must be a positive number.`);
	return numeric;
}
