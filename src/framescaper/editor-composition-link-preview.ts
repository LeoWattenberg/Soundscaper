/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import { acquireVideoTimingIndex } from '../common/editor/video-source-time.ts';
import type { ProductVideoVisualPreviewCreateRequest, ProductVideoVisualPreviewSession } from '../common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { normalizeFramescaperSuccessorProject } from './editor-project-successor.ts';
import { framescaperSuccessorBaselineProject } from './editor-project-successor-commands.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from './editor-project-assistance-foundation.ts';
import { framescaperProjectFinishingFoundationShapeTimelineImage } from './editor-project-timeline-image-foundation.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import { framescaperTimelineImageExactFoundation } from './editor-timeline-image-exact-foundation.ts';
import { createFramescaperImagePictureExecutionTimelineImage } from './video-export-image-execution-timeline-image.ts';
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
	const finishing = project.compositionLinks.length
		? framescaperProjectFinishingFoundationShapeNativeMedia(framescaperTimelineImageExactFoundation(baseline))
		: framescaperProjectFinishingFoundationShapeTimelineImage(baseline);
	const frames = project.compositionLinks.length ? createFramescaperCompositionFrameSource({ project, purpose: 'preview', readAsset: options.readAsset, acquire: options.acquire }) : null;
	const timing = (project.sources as readonly Readonly<{ id: string }>[]).flatMap(source => { const linked = resolveFramescaperCompositionSource(project, source); return linked ? [acquireVideoTimingIndex(source, linked.timing.index)] : []; });
	let inherited: ProductVideoVisualPreviewSession | null = null;
	try {
		const createFinishing = (request: ProductVideoVisualPreviewCreateRequest) => createFramescaperSelectedVisualPreviewSessionFinishing({
			...request, project: finishing, profile: FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE, store: options.store,
			...(frames ? { compositionFrames: frames, supplementalClipIds: new Set(baseline.clips.filter(clip => clip.kind === 'image').map(clip => clip.id)), createSupplementalPictureExecution: ({ plan, signal, assertCurrent }) => createFramescaperImagePictureExecutionTimelineImage({
				profile: FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE, project: baseline, foundationPlan: plan, store: options.store, signal, assertCurrent,
			}) } satisfies Pick<FramescaperSelectedVisualPreviewOptionsFinishing, 'compositionFrames' | 'createSupplementalPictureExecution' | 'supplementalClipIds'> : {}),
			...(options.createOutput ? { createOutput: options.createOutput } : {}),
		});
		inherited = frames ? await createFinishing(options) : await createFramescaperSelectedVisualPreviewSessionTimelineImage({
			...options, project: baseline, profile: FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE,
			...(options.createDrawable ? { createImageDrawable: options.createDrawable } : {}), createInheritedSession: createFinishing,
		});
		if (!frames || !inherited) { await frames?.dispose(); for (const lease of timing) lease.release(); return inherited; }
		const resolveLayers = createFramescaperCompositionPreviewLayers(finishing, { width: options.width, height: options.height, fit: options.fit }, frames.ownsSource);
		let disposed = false;
		const retained = inherited;
		const logical = (sample: number) => { if (disposed) throw new Error('Composition preview is disposed.'); const frame = retained.resolve(sample); return Object.freeze({ ...frame, layers: mergeFramescaperCompositionLayers(frame.layers, resolveLayers(sample)) }); };
		return Object.freeze({ requiresAsyncFrames: true, resolve: logical, resolveTransitionWeight: retained.resolveTransitionWeight,
			async renderExact(request: Parameters<NonNullable<ProductVideoVisualPreviewSession['renderExact']>>[0]) {
				if (disposed) throw new Error('Composition preview is disposed.');
				const compositionLayers = resolveLayers(request.timelineSample);
				const media = mergeFramescaperCompositionLayers(request.mediaLayers, compositionLayers);
				if (!retained.renderExact) throw new Error('Composition preview has no complete exact finishing executor.');
				const result = await retained.renderExact({ ...request, mediaLayers: media });
				return Object.freeze({ ...result, frame: Object.freeze({ ...result.frame, layers: mergeFramescaperCompositionLayers(result.frame.layers, compositionLayers) }) });
			},
			dispose() { if (disposed) return; disposed = true; retained.dispose(); for (const lease of timing) lease.release(); void frames.dispose().catch(() => undefined); },
		});
	} catch (error) { inherited?.dispose(); await frames?.dispose(); for (const lease of timing) lease.release(); throw error; }
}
