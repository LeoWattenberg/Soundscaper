/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import { acquireVideoTimingIndex } from '../common/editor/video-source-time.ts';
import type { ProductVideoVisualPreviewCreateRequest, ProductVideoVisualPreviewSession } from '../common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { composeProductVideoVisualPreviewLayers } from '../common/editor/ui/workspace/product-video-visual-preview-composition.ts';
import { collectProductVideoVisualPreviewEffectIds } from '../common/editor/ui/workspace/product-video-visual-preview-effect-ledger.ts';
import { normalizeFramescaperSuccessorProject } from './editor-project-successor.ts';
import { framescaperSuccessorBaselineProject } from './editor-project-successor-commands.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from './editor-project-assistance-foundation.ts';
import { framescaperProjectFinishingFoundationShapeTimelineImage } from './editor-project-timeline-image-foundation.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE, FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { createFramescaperSelectedVisualPreviewSessionTimelineImage, type CreateFramescaperImagePreviewDrawableTimelineImage } from './editor-selected-timeline-image-image-preview.ts';
import { createFramescaperSelectedVisualPreviewSessionFinishing, type FramescaperSelectedVisualPreviewOptionsFinishing } from './editor-selected-finishing-visual-preview.ts';
import { createFramescaperCompositionFrameSource } from './editor-composition-link-frame-source.ts';
import { resolveFramescaperCompositionSource } from './editor-composition-link-source.ts';
import { createFramescaperCompositionPreviewLayers, mergeFramescaperCompositionLayers } from './editor-composition-link-preview-layers.ts';
import type { FramescaperCompositionAssetReader } from './editor-composition-link-resources.ts';

type Options = ProductVideoVisualPreviewCreateRequest & Readonly<{
	store: AudioEditorProjectStore; readAsset?: FramescaperCompositionAssetReader;
	acquire?: Parameters<typeof createFramescaperCompositionFrameSource>[0]['acquire'];
	createOutput?: FramescaperSelectedVisualPreviewOptionsFinishing['createOutput'];
	createDrawable?: CreateFramescaperImagePreviewDrawableTimelineImage;
}>;
/** Receiver-owned snapshots enter the maintained Frame preview; no encoded body is fabricated. */
export async function createFramescaperSuccessorCompositionPreview(options: Options): Promise<ProductVideoVisualPreviewSession | null> {
	const project = normalizeFramescaperSuccessorProject(options.project);
	const baseline = framescaperProjectTimelineImageFoundationShapeAssistance(framescaperSuccessorBaselineProject(project));
	const finishing = framescaperProjectFinishingFoundationShapeTimelineImage(baseline);
	const frames = project.compositionLinks.length ? createFramescaperCompositionFrameSource({ project, purpose: 'preview', readAsset: options.readAsset, acquire: options.acquire }) : null;
	const timing = (project.sources as readonly Readonly<{ id: string }>[]).flatMap(source => { const linked = resolveFramescaperCompositionSource(project, source); return linked ? [acquireVideoTimingIndex(source, linked.timing.index)] : []; });
	let inherited: ProductVideoVisualPreviewSession | null = null;
	try {
		inherited = await createFramescaperSelectedVisualPreviewSessionTimelineImage({ ...options, project: baseline, profile: FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE,
			...(options.createDrawable ? { createImageDrawable: options.createDrawable } : {}),
			createInheritedSession: request => createFramescaperSelectedVisualPreviewSessionFinishing({ ...request, project: finishing, profile: FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE, store: options.store,
				...(frames ? { compositionFrames: frames } : {}), ...(options.createOutput ? { createOutput: options.createOutput } : {}) }),
		});
		if (!frames || !inherited) { await frames?.dispose(); for (const lease of timing) lease.release(); return inherited; }
		const resolveLayers = createFramescaperCompositionPreviewLayers(finishing, { width: options.width, height: options.height, fit: options.fit }, frames.ownsSource);
		const drawables = new Map<string, ReturnType<CreateFramescaperImagePreviewDrawableTimelineImage>>(); let disposed = false;
		const retained = inherited;
		const logical = (sample: number) => { if (disposed) throw new Error('Composition preview is disposed.'); const frame = retained.resolve(sample); return Object.freeze({ ...frame, layers: mergeFramescaperCompositionLayers(frame.layers, resolveLayers(sample)) }); };
		return Object.freeze({ requiresAsyncFrames: true, resolve: logical, resolveTransitionWeight: retained.resolveTransitionWeight,
			async renderExact(request: Parameters<NonNullable<ProductVideoVisualPreviewSession['renderExact']>>[0]) {
				if (disposed) throw new Error('Composition preview is disposed.');
				const compositionLayers = resolveLayers(request.timelineSample);
				const media = mergeFramescaperCompositionLayers(request.mediaLayers, compositionLayers);
				if (retained.renderExact) { const result = await retained.renderExact({ ...request, mediaLayers: media }); return Object.freeze({ ...result, frame: Object.freeze({ ...result.frame, layers: mergeFramescaperCompositionLayers(result.frame.layers, compositionLayers) }) }); }
				// Timeline images retain their existing layered painter order. Materialize each
				// virtual picture before the shared compositor sees its layer.
				const loaded = [] as typeof compositionLayers[number][];
				for (const layer of compositionLayers) {
					const entries = [] as Readonly<Record<string, unknown>>[];
					for (const entry of layer.entries) {
						const image = await frames.capture(entry, new AbortController().signal); if (!image) throw new Error('Composition preview source disappeared.');
						const id = String(entry.clipId); let drawable = drawables.get(id);
						if (!drawable) { drawable = (options.createDrawable ?? createDrawable)({ clipId: id, sourceId: String(entry.sourceId), width: image.width, height: image.height }); drawables.set(id, drawable); }
						drawable.present(Uint8Array.from(image.pixels)); entries.push(Object.freeze({ ...entry, video: drawable.video }));
					}
					loaded.push(Object.freeze({ ...layer, entries: Object.freeze(entries) }));
				}
				const frame = retained.resolve(request.timelineSample); const layers = composeProductVideoVisualPreviewLayers(mergeFramescaperCompositionLayers(request.mediaLayers, loaded), frame);
				return Object.freeze({ frame: Object.freeze({ ...frame, layers: mergeFramescaperCompositionLayers(frame.layers, loaded) }), layers, renderedEffectIds: collectProductVideoVisualPreviewEffectIds(layers, frame) });
			},
			dispose() { if (disposed) return; disposed = true; retained.dispose(); for (const drawable of drawables.values()) drawable.dispose(); drawables.clear(); for (const lease of timing) lease.release(); void frames.dispose().catch(() => undefined); },
		});
	} catch (error) { inherited?.dispose(); await frames?.dispose(); for (const lease of timing) lease.release(); throw error; }
}
function createDrawable(request: Parameters<CreateFramescaperImagePreviewDrawableTimelineImage>[0]): ReturnType<CreateFramescaperImagePreviewDrawableTimelineImage> {
	const canvas = document.createElement('canvas'); canvas.width = request.width; canvas.height = request.height;
	const context = canvas.getContext('2d'); if (!context) throw new Error('Composition preview canvas is unavailable.');
	return Object.freeze({ video: Object.freeze({ drawable: canvas, videoWidth: request.width, videoHeight: request.height, readyState: 4 as const, currentTime: 0 as const, pause() {} }),
		present(pixels: Uint8Array<ArrayBuffer>) { context.putImageData(new ImageData(new Uint8ClampedArray(pixels), request.width, request.height), 0, 0); },
		dispose() { canvas.width = 0; canvas.height = 0; },
	});
}
