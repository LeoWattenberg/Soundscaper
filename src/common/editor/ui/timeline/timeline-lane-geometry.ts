/* SPDX-License-Identifier: AGPL-3.0-only */

import { createTimelineLaneIndex } from './timeline-lane-index.ts';

const owners = new WeakMap<object, TimelineLaneGeometryOwner>();
const LAYOUT_NODES = '[data-track-list],[data-track-folder-row],.audio-editor-track-row,[data-track-lane],.audio-editor-timeline-inner,.audio-editor-new-track-drop-preview';

export interface TimelineLaneGeometryOwner {
	prepare(): void;
	invalidate(): void;
	dispose(): void;
	isInDropZone(clientY: number, height: number): boolean;
	trackAt(clientY: number, fallback: string, newTrack: string, dropZoneHeight: number): string;
	selection(startTrackId: string, clientY: number): string[] | null;
}

export function readTimelineLaneGeometry(root: object | null | undefined) {
	return root ? owners.get(root) ?? null : null;
}

/** Translate retained content coordinates using the current scroll and root position. */
export function acquireTimelineLaneGeometry(root: HTMLElement): TimelineLaneGeometryOwner {
	const existing = owners.get(root);
	if (existing) return existing;
	let disposed = false;
	let surfaceTop: number | null = null;
	let surfaceBottom: number | null = null;
	let previewHeight = 0;
	let lastTrackBottom: number | null = null;
	const observed = new Set<Element>();
	const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => index.invalidate()) : null;
	const index = createTimelineLaneIndex(() => {
		const origin = root.getBoundingClientRect().top - root.scrollTop;
		const rows = [...root.querySelectorAll('.audio-editor-track-row,[data-track-folder-row]')];
		const surface = root.querySelector('.audio-editor-timeline-inner');
		const preview = surface?.querySelector('.audio-editor-new-track-drop-preview');
		const surfaceRect = surface?.getBoundingClientRect();
		surfaceTop = surfaceRect ? surfaceRect.top - origin : null;
		surfaceBottom = surfaceRect ? surfaceRect.bottom - origin : null;
		previewHeight = preview?.getBoundingClientRect().height ?? 0;
		const trackRows = rows.filter(row => row.matches('.audio-editor-track-row'));
		lastTrackBottom = trackRows.length
			? trackRows.reduce((bottom, row) => Math.max(bottom, row.getBoundingClientRect().bottom - origin), -Infinity) : surfaceTop;
		const nextObserved = new Set<Element>([root, ...rows]);
		if (surface) nextObserved.add(surface);
		if (preview) nextObserved.add(preview);
		for (const element of observed) if (!nextObserved.has(element)) { resizeObserver?.unobserve(element); observed.delete(element); }
		for (const element of nextObserved) if (!observed.has(element)) { resizeObserver?.observe(element); observed.add(element); }
		return [...root.querySelectorAll<HTMLElement>('[data-track-lane]')].flatMap(lane => {
			const trackId = lane.dataset.trackId;
			if (!trackId || lane.dataset.rulerInteraction !== undefined) return [];
			const rect = lane.getBoundingClientRect();
			return [{ trackId, top: rect.top - origin, bottom: rect.bottom - origin, label: Boolean(lane.closest('[data-label-track]')) }];
		});
	});
	const layoutChanged = (records: readonly MutationRecord[]) => records.some(record => {
		if (record.target instanceof Element && record.target.matches(LAYOUT_NODES)) return true;
		return record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(node =>
			node instanceof Element && (node.matches(LAYOUT_NODES) || node.querySelector(LAYOUT_NODES)));
	});
	const mutationObserver = typeof MutationObserver === 'function' ? new MutationObserver(records => {
		if (layoutChanged(records)) index.invalidate();
	}) : null;
	mutationObserver?.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'data-track-id'] });
	const prepare = () => {
		if (disposed) return;
		if (layoutChanged(mutationObserver?.takeRecords() ?? [])) index.invalidate();
		index.prepare();
	};
	const contentY = (clientY: number) => clientY - root.getBoundingClientRect().top + root.scrollTop;
	const inDropZone = (y: number, height: number) => surfaceTop !== null && surfaceBottom !== null
		&& y >= Math.max(surfaceTop, surfaceBottom - previewHeight - height) && y < surfaceBottom - previewHeight;
	const owner: TimelineLaneGeometryOwner = {
		prepare,
		invalidate: () => index.invalidate(),
		dispose() {
			disposed = true;
			resizeObserver?.disconnect(); mutationObserver?.disconnect(); observed.clear();
			if (owners.get(root) === owner) owners.delete(root);
		},
		isInDropZone(clientY, height) { prepare(); return inDropZone(contentY(clientY), height); },
		trackAt(clientY, fallback, newTrack, dropZoneHeight) {
			prepare();
			const y = contentY(clientY);
			if (inDropZone(y, dropZoneHeight)) return newTrack;
			const track = index.trackAt(y);
			if (track) return track;
			return surfaceBottom !== null && lastTrackBottom !== null && y >= lastTrackBottom && y < surfaceBottom ? newTrack : fallback;
		},
		selection(startTrackId, clientY) { prepare(); return index.selection(startTrackId, contentY(clientY)); },
	};
	owners.set(root, owner);
	return owner;
}
