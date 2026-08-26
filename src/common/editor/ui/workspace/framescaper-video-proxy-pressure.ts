/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, type RefObject } from 'react';

export interface FramescaperVideoProxyPressureEntry {
	readonly clipId: string;
	readonly sourceId: string;
}

/** Per-element decode counters carried between reports, so deltas can be taken. */
export type FramescaperVideoProxyPressureCounters = Map<string, {
	total: number;
	dropped: number;
}>;

export function reportFramescaperVideoProxyPreviewPressure(
	reporter: ((sourceId: string, pressure: Readonly<{
		readonly droppedFrameRatio: number;
		readonly decodeQueueDepth: number;
		readonly viewportScale: number;
	}>) => PromiseLike<unknown> | unknown) | null,
	entries: readonly Readonly<FramescaperVideoProxyPressureEntry>[],
	elements: ReadonlyMap<string, HTMLVideoElement>,
	viewport: Readonly<{
		readonly width: number;
		readonly height: number;
		readonly referenceWidth: number;
		readonly referenceHeight: number;
	}>,
	counters?: FramescaperVideoProxyPressureCounters,
): Promise<void> {
	if (!reporter || viewport.width <= 0 || viewport.height <= 0
		|| viewport.referenceWidth <= 0 || viewport.referenceHeight <= 0) return Promise.resolve();
	const viewportScale = Math.min(1,
		viewport.width / viewport.referenceWidth,
		viewport.height / viewport.referenceHeight,
	);
	// `getVideoPlaybackQuality` counts for the whole media resource, and the video
	// elements are cached per clip for the life of the preview, so the raw totals
	// are lifetime figures. Pressure is a statement about now: a long clean stretch
	// would otherwise mask a stall, and one bad stretch would keep proxies engaged
	// long after playback recovered. Report the change since the previous look.
	const bySource = new Map<string, { total: number; dropped: number }>();
	const seen = new Set<string>();
	for (const entry of entries) {
		const current = bySource.get(entry.sourceId) ?? { total: 0, dropped: 0 };
		const quality = elements.get(entry.clipId)?.getVideoPlaybackQuality?.();
		const total = Math.max(0, Number(quality?.totalVideoFrames) || 0);
		const dropped = Math.max(0, Number(quality?.droppedVideoFrames) || 0);
		const previous = counters?.get(entry.clipId);
		// A counter that moved backwards means the element took a new resource, so
		// the reading starts again rather than going negative.
		const totalDelta = previous && total >= previous.total ? total - previous.total : total;
		const droppedDelta = previous && dropped >= previous.dropped
			? dropped - previous.dropped : dropped;
		counters?.set(entry.clipId, { total, dropped });
		seen.add(entry.clipId);
		current.total += totalDelta;
		current.dropped += droppedDelta;
		bySource.set(entry.sourceId, current);
	}
	if (counters) for (const clipId of [...counters.keys()]) if (!seen.has(clipId)) counters.delete(clipId);
	return Promise.all([...bySource].map(([sourceId, quality]) => (
		Promise.resolve(reporter(sourceId, {
			droppedFrameRatio: quality.total > 0
				? Math.min(1, quality.dropped / quality.total)
				: 0,
			decodeQueueDepth: 0,
			viewportScale,
		}))
	))).then(() => undefined);
}

export function useFramescaperVideoProxyPreviewPressure(options: Readonly<{
	readonly reporter: ((sourceId: string, pressure: Readonly<{
		readonly droppedFrameRatio: number;
		readonly decodeQueueDepth: number;
		readonly viewportScale: number;
	}>) => PromiseLike<unknown> | unknown) | null;
	readonly entries: readonly Readonly<FramescaperVideoProxyPressureEntry>[];
	readonly elements: RefObject<ReadonlyMap<string, HTMLVideoElement>>;
	readonly canvas: RefObject<HTMLCanvasElement | null>;
	readonly referenceWidth: number;
	readonly referenceHeight: number;
	readonly playing: boolean;
	readonly run: (operation: () => Promise<void>) => unknown;
}>): void {
	const entriesRef = useRef(options.entries);
	entriesRef.current = options.entries;
	const countersRef = useRef<FramescaperVideoProxyPressureCounters>(new Map());
	const signature = options.entries.map(({ clipId, sourceId }) => `${clipId}:${sourceId}`).join('|');
	useEffect(() => {
		const report = (): void => {
			const canvas = options.canvas.current;
			if (!canvas) return;
			void Promise.resolve(options.run(() => reportFramescaperVideoProxyPreviewPressure(
				options.reporter,
				entriesRef.current,
				options.elements.current ?? new Map(),
				{
					width: canvas.clientWidth, height: canvas.clientHeight,
					referenceWidth: options.referenceWidth,
					referenceHeight: options.referenceHeight,
				},
				countersRef.current,
			))).catch(() => undefined);
		};
		report();
		const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(report) : null;
		if (options.canvas.current) observer?.observe(options.canvas.current);
		const interval = options.playing ? globalThis.setInterval(report, 1_000) : null;
		return () => {
			observer?.disconnect();
			if (interval !== null) globalThis.clearInterval(interval);
		};
	}, [
		options.canvas, options.elements, options.playing, options.reporter,
		options.referenceHeight, options.referenceWidth, options.run, signature,
	]);
}
