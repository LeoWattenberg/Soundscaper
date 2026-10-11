/* SPDX-License-Identifier: AGPL-3.0-only */
import { compileMotionCompositionLink, type MotionCompositionLinkRasterLease } from '../common/editor/motion-link-rendering.ts';
import { renderMotionCompositionLinkPicture } from '../common/editor/motion-link-picture-source.ts';
import type { MotionCompositionOffer } from '../common/editor/motion-link-protocol.ts';
import type { MotionPreviewQuality } from '../common/editor/motion-temporal-sampling.ts';
import { motionInteger, motionId } from '../common/editor/motion-values.ts';
import { motionSurfaceLength } from '../common/editor/motion-surface.ts';
import { divideRationals } from '../common/editor/timeline-time.ts';
import type { UnifiedExactRenderRgbaFrameV13 } from '../common/editor/unified-exact-render-finishing-consumers-v13.ts';
import { resolveFramescaperCompositionSource } from './editor-composition-link-source.ts';
import { normalizeFramescaperSuccessorProject } from './editor-project-successor.ts';
import { createFramescaperCompositionResources, type FramescaperCompositionAssetReader } from './editor-composition-link-resources.ts';
import type { FramescaperVideoFrameAddressFinishing } from './video-frame-address-finishing.ts';

export interface FramescaperCompositionFrameSource extends FramescaperVideoFrameAddressFinishing {
	ownsSource(sourceId: string): boolean;
	capture(entry: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<UnifiedExactRenderRgbaFrameV13 | null>;
	snapshot(): Readonly<{ cacheBytes: number; cacheFrames: number; disposed: boolean }>;
}
type Purpose = Readonly<{ purpose: 'final'; quality?: never }> | Readonly<{ purpose: 'preview'; quality?: MotionPreviewQuality }>;
type Options = Purpose & Readonly<{
	project: unknown; readAsset?: FramescaperCompositionAssetReader;
	acquire?: (offer: MotionCompositionOffer, signal?: AbortSignal) => Promise<MotionCompositionLinkRasterLease>;
	maximumCacheBytes?: number; maximumWorkingBytes?: number;
}>;
/** Frame's exact drawable ordinal selects the composition frame on its own rational frame grid. */
export function createFramescaperCompositionFrameSource(options: Options): FramescaperCompositionFrameSource {
	const project = normalizeFramescaperSuccessorProject(options.project);
	const sources = project.sources as readonly Readonly<{ id: string; [key: string]: unknown }>[];
	const plans = new Map(sources.flatMap(source => {
		const linked = resolveFramescaperCompositionSource(project, source);
		return linked ? [[source.id, compileMotionCompositionLink(linked.offer)] as const] : [];
	}));
	const acquire = options.acquire ?? createFramescaperCompositionResources(options.readAsset!).acquireRaster;
	const maximumCacheBytes = motionInteger(options.maximumCacheBytes ?? 16 * 1024 * 1024, 'composition frame cache', 1, 256 * 1024 * 1024);
	const cache = new Map<string, UnifiedExactRenderRgbaFrameV13>(); const lifetime = new AbortController();
	let cacheBytes = 0, disposed = false, pending = 0; let tail: Promise<unknown> = Promise.resolve(); let closing: Promise<void> | null = null;
	const ownsSource = (sourceId: string) => plans.has(sourceId);
	function resolve(request: Parameters<FramescaperVideoFrameAddressFinishing['resolve']>[0]): Promise<UnifiedExactRenderRgbaFrameV13> {
		if (disposed) return Promise.reject(new Error('Composition frame source is disposed.'));
		if (pending >= 8) return Promise.reject(new Error('Composition frame source queue is full.'));
		const sourceId = motionId(request.sourceId), ordinal = motionInteger(request.sourceFrame, 'composition source frame');
		const width = motionInteger(request.width, 'composition frame width', 1, 65536), height = motionInteger(request.height, 'composition frame height', 1, 65536);
		motionSurfaceLength(width, height); const signal = AbortSignal.any([request.signal, lifetime.signal]);
		const plan = plans.get(sourceId); if (!plan) return Promise.reject(new ReferenceError(`Composition source ${sourceId} is unavailable.`));
		if (ordinal >= plan.offer.output.durationFrames) return Promise.reject(new RangeError('Composition source frame exceeds its retained duration.'));
		pending++;
		const operation = tail.then(async () => {
			signal.throwIfAborted(); const key = `${sourceId}:${ordinal}`; let frame = cache.get(key);
			if (!frame) {
				const purpose = options.purpose === 'final' ? { purpose: 'final' as const } : { purpose: 'preview' as const, quality: options.quality };
				const picture = await renderMotionCompositionLinkPicture(plan, divideRationals(ordinal, plan.offer.output.frameRate), { ...purpose, acquire, signal, maximumWorkingBytes: options.maximumWorkingBytes });
				frame = Object.freeze({ width: picture.width, height: picture.height, pixels: Uint8Array.from(picture.pixels) });
				if (frame.pixels.byteLength <= maximumCacheBytes) {
					while (cache.size && cacheBytes + frame.pixels.byteLength > maximumCacheBytes) {
						const oldest = cache.keys().next().value!; cacheBytes -= cache.get(oldest)!.pixels.byteLength; cache.delete(oldest);
					}
					cache.set(key, frame); cacheBytes += frame.pixels.byteLength;
				}
			} else { cache.delete(key); cache.set(key, frame); }
			signal.throwIfAborted(); return resizedCopy(frame, width, height);
		});
		tail = operation.then(() => undefined, () => undefined).finally(() => { pending--; }); return operation;
	}
	return Object.freeze({ ownsSource, resolve,
		async capture(entry: Readonly<Record<string, unknown>>, signal: AbortSignal) {
			if (disposed) throw new Error('Composition frame source is disposed.');
			const id = motionId(entry.sourceId); const plan = plans.get(id); if (!plan) return null;
			const descriptor = entry.presentationDescriptor;
			if (!descriptor || typeof descriptor !== 'object' || !Object.hasOwn(descriptor, 'drawableSourceFrame')) throw new TypeError('Composition capture requires Frame exact source addressing.');
			return resolve({ sourceId: id, sourceFrame: motionInteger(Reflect.get(descriptor, 'drawableSourceFrame'), 'composition source frame'), width: plan.offer.output.width, height: plan.offer.output.height, signal });
		},
		snapshot: () => Object.freeze({ cacheBytes, cacheFrames: cache.size, disposed }),
		dispose() {
			if (closing) return closing; disposed = true; lifetime.abort();
			closing = (async () => { await tail; cache.clear(); cacheBytes = 0; })(); return closing;
		},
	});
}
function resizedCopy(frame: UnifiedExactRenderRgbaFrameV13, width: number, height: number): UnifiedExactRenderRgbaFrameV13 {
	if (frame.width === width && frame.height === height) return Object.freeze({ width, height, pixels: frame.pixels.slice() });
	const pixels = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const from = (Math.min(frame.height - 1, Math.floor(y * frame.height / height)) * frame.width + Math.min(frame.width - 1, Math.floor(x * frame.width / width))) * 4;
		pixels.set(frame.pixels.subarray(from, from + 4), (y * width + x) * 4);
	}
	return Object.freeze({ width, height, pixels });
}
