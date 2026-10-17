/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import { digestMediaContent } from '../common/editor/storage/media-content-digest.ts';
import type { UnifiedExactRenderPlanV13 } from '../common/editor/unified-exact-render-plan.ts';
import type { createUnifiedExactRenderVisualPreviewConsumerV13 } from '../common/editor/unified-exact-render-visual-consumers-v13.ts';
import { materializeUnifiedExactRenderVisualEntryV13, type UnifiedExactRenderVisualRgbaV13 } from '../common/editor/unified-exact-render-visual-materializer-v13.ts';
import { resolveFramescaperVisualPlacementFinishing } from './visual-placement-finishing.ts';

export interface DrawableVideo {
	readonly drawable: HTMLCanvasElement;
	readonly videoWidth: number;
	readonly videoHeight: number;
	readonly readyState: 4;
	readonly currentTime: 0;
	pause(): void;
}

export async function materializeDrawables(
	plan: UnifiedExactRenderPlanV13,
	consumer: ReturnType<typeof createUnifiedExactRenderVisualPreviewConsumerV13>,
	store: AudioEditorProjectStore,
	canvas: Readonly<{ width: number; height: number }>,
	signal: AbortSignal,
	supplementalClipIds?: ReadonlySet<string>,
): Promise<Map<string, DrawableVideo>> {
	const drawables = new Map<string, DrawableVideo>();
	try {
		for (const node of plan.nodes) {
			if (node.kind !== 'visual' || node.placement === null || !('source' in node.authoredState)) continue;
			const track = plan.tracks.find(({ trackId }) => trackId === node.placement?.trackId);
			const soloed = plan.tracks.some(({ solo }) => solo);
			if (!track || (soloed ? !track.solo : track.hidden)) continue;
			const entry = consumer.resolveFrame({ sequencePosition: node.authoredState.clip.sequenceStartFrame })
				.layers.flatMap(({ entries }) => entries).find(({ modelId }) => modelId === node.modelId);
			if (!entry) throw new ReferenceError(`Active V13 visual ${node.modelId} was not resolved.`);
			const size = resolveFramescaperVisualPlacementFinishing(entry, canvas);
			if (supplementalClipIds?.has(node.modelId)) {
				// Exact supplemental execution owns the real pixels and its admission.
				// Logical diagnostics need only the declared geometry, never another
				// full-size canvas per image occurrence before that admission succeeds.
				const placeholder = rgbaDrawable({ width: 1, height: 1, pixels: new Uint8Array(4) });
				drawables.set(node.modelId, Object.freeze({ ...placeholder, videoWidth: size.width, videoHeight: size.height }));
				continue;
			}
			const frame = entry.modelKind === 'external-generator' ? Object.freeze({
				width: size.width, height: size.height, pixels: new Uint8Array(size.width * size.height * 4),
			}) : await materializeUnifiedExactRenderVisualEntryV13(entry, {
				targetWidth: size.width,
				targetHeight: size.height,
				decodeStill: (source) => decodeStill(store, source.storageKey, source.contentSha256, signal),
				signal,
			});
			drawables.set(node.modelId, rgbaDrawable(frame));
		}
		return drawables;
	} catch (error) { disposeDrawables(drawables); throw error; }
}

export async function decodeStill(
	store: AudioEditorProjectStore,
	storageKey: string,
	expectedSha256: string,
	signal: AbortSignal,
): Promise<UnifiedExactRenderVisualRgbaV13> {
	if (typeof globalThis.createImageBitmap !== 'function' || !globalThis.document?.createElement) {
		throw new Error('Selected finishing still preview requires browser image decode.');
	}
	const blob = await store.loadMediaAsset(storageKey, { signal });
	if (!(blob instanceof Blob)) throw new Error(`Selected finishing still ${storageKey} is unavailable.`);
	if (await digestMediaContent(blob) !== expectedSha256) {
		throw new RangeError(`Selected finishing still ${storageKey} failed content authentication.`);
	}
	const bitmap = await globalThis.createImageBitmap(blob);
	try {
		const canvas = globalThis.document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (!context) throw new Error('Selected finishing still decode has no 2D context.');
		context.drawImage(bitmap, 0, 0);
		const image = context.getImageData(0, 0, canvas.width, canvas.height);
		return Object.freeze({
			width: canvas.width,
			height: canvas.height,
			pixels: new Uint8Array(image.data) as Uint8Array<ArrayBuffer>,
		});
	} finally { bitmap.close(); }
}

function rgbaDrawable(frame: UnifiedExactRenderVisualRgbaV13): DrawableVideo {
	if (!globalThis.document?.createElement) throw new Error('V13 preview drawable requires a document.');
	const canvas = globalThis.document.createElement('canvas');
	canvas.width = frame.width;
	canvas.height = frame.height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('V13 preview drawable has no 2D context.');
	context.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
	return Object.freeze({
		drawable: canvas,
		videoWidth: frame.width,
		videoHeight: frame.height,
		readyState: 4 as const,
		currentTime: 0 as const,
		pause() {},
	});
}

export function disposeDrawables(drawables: Map<string, DrawableVideo>): void {
	for (const value of drawables.values()) { value.drawable.width = 0; value.drawable.height = 0; }
	drawables.clear();
}
