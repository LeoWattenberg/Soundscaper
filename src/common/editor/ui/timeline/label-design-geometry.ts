/* SPDX-License-Identifier: AGPL-3.0-only */

/** Geometry adapted from audacity-design-system's 2026-09 label rewrite. */
export interface TimelineLabelRange {
	readonly id: string;
	readonly title?: string;
	readonly startFrame: number;
	readonly endFrame: number;
}

export function getLabelMetrics(sizePt = 9) {
	const fontSizePx = sizePt * 4 / 3;
	const scale = fontSizePx / 12;
	const bannerHeight = Math.max(20, Math.round(fontSizePx * 1.5));
	const rowGap = Math.max(4, Math.round(2 * scale / 4) * 4);
	return {
		fontSizePx, bannerHeight, rowHeight: bannerHeight + rowGap,
		padX: fontSizePx <= 16 ? 4 : fontSizePx < 20 ? 6 : fontSizePx <= 24 ? 8 : fontSizePx <= 48 ? 12 : 16,
		earWidth: 10, earHeight: Math.min(20, bannerHeight), stalkWidth: 1,
		pointFlagGap: fontSizePx <= 16 ? 4 : fontSizePx <= 32 ? 6 : 8,
		minPointWidth: Math.round(50 * scale), maxPointWidth: Math.round(400 * scale),
	};
}

export type TimelineLabelMetrics = ReturnType<typeof getLabelMetrics>;

let measureContext: CanvasRenderingContext2D | null | undefined;
function pointLabelWidth(title: string, metrics: TimelineLabelMetrics): number {
	if (measureContext === undefined && typeof document !== 'undefined') {
		measureContext = document.createElement('canvas').getContext?.('2d') ?? null;
	}
	if (measureContext) measureContext.font = `500 ${String(metrics.fontSizePx)}px Inter, sans-serif`;
	const textWidth = measureContext?.measureText(title).width ?? title.length * metrics.fontSizePx * 0.6;
	return Math.max(metrics.minPointWidth, Math.min(metrics.maxPointWidth, Math.ceil(textWidth) + metrics.padX * 2));
}

export interface LabelLayout {
	readonly row: number;
	readonly width: number;
	leftNeighbor?: TimelineLabelRange;
	rightNeighbor?: TimelineLabelRange;
}

/** Pack only the viewport labels; frame adjacency remains exact even at extreme zoom. */
export function layoutTimelineLabels(
	labels: readonly TimelineLabelRange[], pixelsPerSecond: number, sampleRate: number, metrics: TimelineLabelMetrics,
): Map<string, LabelLayout> {
	const rows: Array<{ endX: number; label: TimelineLabelRange }> = [];
	const busy: Array<{ key: number; row: number }> = [];
	const available: Array<{ key: number; row: number }> = [];
	const layout = new Map<string, LabelLayout>();
	for (const label of [...labels].sort((left, right) => left.startFrame - right.startFrame)) {
		const point = label.startFrame === label.endFrame;
		const startX = label.startFrame / sampleRate * pixelsPerSecond;
		const width = point ? pointLabelWidth(label.title ?? '', metrics)
			: (label.endFrame - label.startFrame) / sampleRate * pixelsPerSecond;
		while (busy[0] && busy[0].key <= startX) {
			const released = heapPop(busy)!;
			heapPush(available, { key: released.row, row: released.row });
		}
		const row = heapPop(available)?.row ?? rows.length;
		const previous = rows[row]?.label;
		const item: LabelLayout = { row, width };
		if (!point && previous && previous.startFrame !== previous.endFrame && previous.endFrame === label.startFrame) {
			item.leftNeighbor = previous;
			layout.get(previous.id)!.rightNeighbor = label;
		}
		rows[row] = { endX: startX + width + (point ? metrics.earWidth + metrics.pointFlagGap : 0), label };
		heapPush(busy, { key: rows[row]!.endX, row });
		layout.set(label.id, item);
	}
	return layout;
}

export function snapLabelFrame(frame: number, targets: readonly number[], pixelsPerSecond: number, sampleRate: number): number {
	let nearest = Math.max(0, Math.round(frame));
	let distance = 8 / pixelsPerSecond * sampleRate;
	for (const target of targets) {
		const candidateDistance = Math.abs(frame - target);
		if (target >= 0 && candidateDistance < distance) { nearest = target; distance = candidateDistance; }
	}
	return nearest;
}

export function stretchLabelRange(frame: number, anchor: number, targets: readonly number[], pixelsPerSecond: number, sampleRate: number) {
	const snapped = snapLabelFrame(frame, targets, pixelsPerSecond, sampleRate);
	if (Math.abs(snapped - anchor) / sampleRate * pixelsPerSecond < 6) return { startFrame: anchor, endFrame: anchor };
	return { startFrame: Math.min(snapped, anchor), endFrame: Math.max(snapped, anchor) };
}

export function moveLabelRange(
	label: Readonly<{ startFrame: number; endFrame: number }>, deltaFrames: number,
	targets: readonly number[], pixelsPerSecond: number, sampleRate: number,
) {
	const duration = label.endFrame - label.startFrame;
	const startFrame = snapLabelFrame(Math.max(0, label.startFrame + deltaFrames),
		[...targets, ...targets.map(target => target - duration)], pixelsPerSecond, sampleRate);
	return { startFrame, endFrame: startFrame + duration };
}


/** Two small heaps keep overlap packing O(n log n), including dense cue sheets. */
function heapPush(heap: Array<{ key: number; row: number }>, value: { key: number; row: number }): void {
	let index = heap.length;
	heap.push(value);
	while (index > 0) {
		const parent = Math.floor((index - 1) / 2);
		if (heap[parent]!.key <= value.key) break;
		heap[index] = heap[parent]!;
		index = parent;
	}
	heap[index] = value;
}

function heapPop(heap: Array<{ key: number; row: number }>): { key: number; row: number } | undefined {
	const first = heap[0];
	const last = heap.pop();
	if (!last || heap.length === 0) return first;
	let index = 0;
	while (index * 2 + 1 < heap.length) {
		let child = index * 2 + 1;
		if (heap[child + 1] && heap[child + 1]!.key < heap[child]!.key) child++;
		if (heap[child]!.key >= last.key) break;
		heap[index] = heap[child]!;
		index = child;
	}
	heap[index] = last;
	return first;
}
