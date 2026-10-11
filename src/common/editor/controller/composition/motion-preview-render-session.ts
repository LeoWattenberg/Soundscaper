/* SPDX-License-Identifier: AGPL-3.0-only */

import { createMotionSceneEvaluator, type MotionSceneEvaluator } from '../../motion-composition-evaluation.ts';
import { renderMotionCompositionFrame, motionCpuCompositor } from '../../motion-composition-renderer.ts';
import { createCanvasKitMotionRasterizer } from '../../motion-canvaskit-rasterizer.ts';
import type { MotionRasterRuntime } from '../../motion-canvaskit-browser.ts';
import { normalizeMotionscaperProject } from '../../motion-project-validation.ts';
import type { MotionscaperProject } from '../../motion-project-types.ts';
import { verifyMotionAssetBody, type MotionAsset } from '../../motion-asset.ts';
import { motionSurfaceToRgba8 } from '../../motion-surface.ts';
import { createMotionWebGlCompositor, type MotionWebGlCompositor } from '../../motion-webgl-compositor.ts';
import { loadMotionRasterRuntime } from './motion-raster-runtime.ts';
import { requireMotionTrackingReady } from '../../motion-tracking-admission.ts';
import type { MotionPreviewAssetLoader, MotionPreviewBackend, MotionPreviewBackendName, MotionPreviewFootageDecoder } from './motion-preview-types.ts';

export interface MotionPreviewSessionOptions {
	readonly backend: 'worker-cpu' | 'host-cpu';
	readonly maximumAssetBytes: number; readonly maximumWorkingBytes: number;
	readonly createCanvas?: () => OffscreenCanvas | HTMLCanvasElement;
	readonly loadRuntime?: () => Promise<MotionRasterRuntime>;
}

/** A persistent renderer in either the worker or the host fallback; never owns a second evaluator. */
export function createMotionPreviewRenderSession(options: MotionPreviewSessionOptions): MotionPreviewBackend {
	if (!Number.isSafeInteger(options.maximumAssetBytes) || options.maximumAssetBytes < 1 || options.maximumAssetBytes > 256 * 1024 * 1024) throw new RangeError('Motion preview asset budget must be between one byte and 256 MiB.');
	let project: MotionscaperProject | null = null; let evaluator: MotionSceneEvaluator | null = null;
	let loadAsset: MotionPreviewAssetLoader | null = null; let decodeFootage: MotionPreviewFootageDecoder | undefined;
	let gpu: MotionWebGlCompositor | null = null; let name: MotionPreviewBackendName = options.backend;
	let disposed = false; const disposal = new AbortController(); const cache = new Map<string, Uint8Array>(); let cacheBytes = 0;
	return {
		setProject(value, provider, signal, decoder) {
			assertActive(signal); const normalized = normalizeMotionscaperProject(value);
			requireMotionTrackingReady(normalized);
			project = normalized; evaluator = createMotionSceneEvaluator(normalized); loadAsset = provider; decodeFootage = decoder;
			cache.clear(); cacheBytes = 0; gpu?.dispose(); gpu = null; name = options.backend;
			if (options.createCanvas) {
				try { gpu = createMotionWebGlCompositor(options.createCanvas()).compositor; } catch { gpu = null; }
				if (gpu) name = 'worker-webgl2';
			}
			return Promise.resolve(name);
		},
		async render(request, externalSignal) {
			const signal = AbortSignal.any([externalSignal, disposal.signal]); assertActive(signal);
			if (!project || !evaluator) throw new Error('Load a motion project before rendering preview.');
			const retained = project; const frame = evaluator.evaluate(request);
			const runtime = await (options.loadRuntime ? options.loadRuntime() : loadMotionRasterRuntime(signal)); assertActive(signal);
			const rasterizer = createCanvasKitMotionRasterizer(runtime.kit, { assets: retained.assets, fallbackFonts: runtime.fallbackFonts, loadAsset: bytesFor,
				...(decodeFootage ? { decodeFootage } : {}) });
			let rendered;
			try { rendered = await renderMotionCompositionFrame(frame, { rasterizer, compositor: gpu ?? motionCpuCompositor, signal, maximumWorkingBytes: options.maximumWorkingBytes }); }
			catch (error) {
				if (!gpu || !(error instanceof Error) || !/^Motion (?:WebGL2|working surfaces)/u.test(error.message)) throw error;
				gpu.dispose(); gpu = null; name = options.backend; assertActive(signal);
				rendered = await renderMotionCompositionFrame(frame, { rasterizer, compositor: motionCpuCompositor, signal, maximumWorkingBytes: options.maximumWorkingBytes });
			}
			assertActive(signal);
			return { width: frame.width, height: frame.height, rgba: motionSurfaceToRgba8(rendered, 'srgb'),
				time: frame.time, compositionId: frame.compositionId, revision: retained.revision, generation: request.generation, backend: name };
		},
		dispose() { if (!disposed) { disposed = true; disposal.abort(); gpu?.dispose(); gpu = null; cache.clear(); cacheBytes = 0; project = null; evaluator = null; loadAsset = null; decodeFootage = undefined; } },
	};

	function assertActive(signal: AbortSignal): void { signal.throwIfAborted(); if (disposed) throw new Error('Motion preview renderer is disposed.'); }
	async function bytesFor(asset: MotionAsset, signal?: AbortSignal): Promise<Uint8Array> {
		signal?.throwIfAborted();
		if (asset.byteLength > options.maximumAssetBytes) throw new RangeError(`Motion asset ${asset.name} exceeds the ${options.maximumAssetBytes}-byte preview decode budget.`);
		const prior = cache.get(asset.sha256);
		if (prior) { cache.delete(asset.sha256); cache.set(asset.sha256, prior); return prior; }
		if (!loadAsset || disposed) throw new Error('Motion preview asset provider is unavailable.');
		const bytes = await loadAsset(asset, signal); signal?.throwIfAborted(); verifyMotionAssetBody(asset, bytes);
		while (cacheBytes + bytes.byteLength > options.maximumAssetBytes) {
			const oldest = cache.entries().next().value; if (!oldest) break;
			cache.delete(oldest[0]); cacheBytes -= oldest[1].byteLength;
		}
		cache.set(asset.sha256, bytes); cacheBytes += bytes.byteLength; return bytes;
	}
}
