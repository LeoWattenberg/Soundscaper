/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import { motionInteger, motionString } from '../common/editor/motion-values.ts';
import { acquireVideoTimingIndex } from '../common/editor/video-source-time.ts';
import { bindVideoSourceTimingView } from '../common/editor/video-source-timing-view.ts';
import { createVideoRetimeFrameBinding } from '../common/editor/video-retime-frame-binding.ts';
import type { ProductVideoGeneratedSourceRuntime, ProductVideoTimelineFilmstripRequest, ProductVideoTimelineFilmstripFrame, ProductVideoVisualProjectBinThumbnailRequest, ProductVideoVisualProjectBinThumbnail } from '../common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { createFramescaperCompositionFrameSource } from './editor-composition-link-frame-source.ts';
import { resolveFramescaperCompositionSource } from './editor-composition-link-source.ts';
import { framescaperCompositionPreviewProject } from './editor-composition-link-preview-project.ts';
import { framescaperSuccessorBaselineProject } from './editor-project-successor-commands.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from './editor-project-assistance-foundation.ts';
import { framescaperProjectFinishingFoundationShapeTimelineImage } from './editor-project-timeline-image-foundation.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE, FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { createFramescaperSelectedProjectBinThumbnailTimelineImage } from './editor-selected-timeline-image-image-preview.ts';
import { createFramescaperSelectedTimelineFilmstripTimelineImage } from './editor-selected-timeline-image-image-filmstrip.ts';
import { createFramescaperSelectedTimelineFilmstripFinishing, type FramescaperSelectedTimelineFilmstripOptionsFinishing } from './editor-selected-finishing-timeline-filmstrip.ts';

type Options = Readonly<{
	store: AudioEditorProjectStore;
	readAsset?: Parameters<typeof createFramescaperCompositionFrameSource>[0]['readAsset'];
	acquire?: Parameters<typeof createFramescaperCompositionFrameSource>[0]['acquire'];
}>;
function projectOf(value: unknown) {
	const project = framescaperCompositionPreviewProject(value);
	if (!project) throw new TypeError('Generated picture requests require exact successor project authority.');
	return project;
}
function admit(width: number, height: number, count = 1): void {
	motionInteger(width, 'generated thumbnail width', 1, 4096); motionInteger(height, 'generated thumbnail height', 1, 4096); motionInteger(count, 'generated thumbnail count', 0, 256);
	if (width * height * 4 * count > 64 * 1024 * 1024) throw new RangeError('Generated thumbnails exceed their aggregate output budget.');
}
/** Source monitor uses the controller's exact source ordinal, retaining straight display-sRGB alpha. */
export async function createFramescaperSuccessorSourceFrame(options: Parameters<ProductVideoGeneratedSourceRuntime['createFrame']>[0] & Options) {
	const project = projectOf(options.project); admit(options.width, options.height); options.signal?.throwIfAborted();
	const baseline = framescaperSuccessorBaselineProject(project); const source = baseline.sources.find(source => source.id === options.sourceId);
	const linked = source && resolveFramescaperCompositionSource(project, source); if (!linked) return null;
	const scale = Math.min(1, options.width / linked.offer.output.width, options.height / linked.offer.output.height);
	const width = Math.max(1, Math.round(linked.offer.output.width * scale)), height = Math.max(1, Math.round(linked.offer.output.height * scale));
	const frames = createFramescaperCompositionFrameSource({ ...options, project, purpose: 'preview' });
	try { return await frames.resolve({ sourceId: options.sourceId, sourceFrame: options.sourceFrame, width, height, signal: options.signal ?? new AbortController().signal }); }
	finally { await frames.dispose(); }
}
/** Bin source-start honors trim and reverse/ramp binding before materializing a retained source ordinal. */
export async function createFramescaperSuccessorProjectBinThumbnail(options: ProductVideoVisualProjectBinThumbnailRequest & Options): Promise<ProductVideoVisualProjectBinThumbnail | null> {
	const project = projectOf(options.project); const baseline = framescaperSuccessorBaselineProject(project); admit(options.width, options.height); options.signal?.throwIfAborted();
	const clip = baseline.projectBin.clips.find(clip => clip.id === options.clipId); const source = baseline.sources.find(source => source.id === clip?.sourceId);
	const linked = source && resolveFramescaperCompositionSource(project, source);
	if (!linked || !source || !clip) return createFramescaperSelectedProjectBinThumbnailTimelineImage({ ...options, profile: FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE, project: framescaperProjectTimelineImageFoundationShapeAssistance(baseline) });
	const timing = bindVideoSourceTimingView(new Map([[source.id, { kind: 'vfr' as const, reference: linked.timing.reference, index: linked.timing.index }]]), source);
	const sourceFrame = clip.retimeMap == null ? Number(clip.sourceInFrame) : createVideoRetimeFrameBinding(clip, timing).ownedFrameAt(0).drawableSourceFrame;
	const frame = await createFramescaperSuccessorSourceFrame({ ...options, project, sourceId: source.id, sourceFrame });
	return frame && Object.freeze({ ...frame, clipId: options.clipId, sourceId: source.id, opacity: 1, blendMode: 'normal', presentationIds: Object.freeze([]), maskIds: Object.freeze([]) });
}
/** Generated requests skip URL decode; all cells retain their inherited image/Frame finishing routes and order. */
export async function createFramescaperSuccessorTimelineFilmstrip(options: ProductVideoTimelineFilmstripRequest & Options & Pick<FramescaperSelectedTimelineFilmstripOptionsFinishing, 'createOutput' | 'decodeSource'>): Promise<readonly ProductVideoTimelineFilmstripFrame[] | null> {
	const project = projectOf(options.project); admit(options.width, options.height, options.frames.length); options.signal?.throwIfAborted();
	const keys = new Set<string>(); for (const frame of options.frames) { const key = motionString(frame.key, 'filmstrip frame key', 1024); if (keys.has(key)) throw new RangeError('Filmstrip frame keys must be unique.'); keys.add(key); }
	const baseline = framescaperProjectTimelineImageFoundationShapeAssistance(framescaperSuccessorBaselineProject(project));
	const finishing = framescaperProjectFinishingFoundationShapeTimelineImage(baseline);
	const leases: ReturnType<typeof acquireVideoTimingIndex>[] = [];
	const frames = project.compositionLinks.length ? createFramescaperCompositionFrameSource({ ...options, project, purpose: 'preview' }) : null;
	const output = new Array<ProductVideoTimelineFilmstripFrame>(options.frames.length);
	try {
		for (const source of baseline.sources) { const linked = resolveFramescaperCompositionSource(project, source); if (linked) leases.push(acquireVideoTimingIndex(source, linked.timing.index)); }
		const generated = options.frames.filter(frame => frame.sourceAuthority === 'product-generated');
		const ordinary = options.frames.filter(frame => frame.sourceAuthority !== 'product-generated');
		const render = (request: ProductVideoTimelineFilmstripRequest) => createFramescaperSelectedTimelineFilmstripFinishing({ ...options, ...request, project: finishing, profile: FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE, ...(frames ? { compositionFrames: frames } : {}) });
		const results = [...(generated.length ? await render({ ...options, frames: generated }) ?? [] : []), ...(ordinary.length ? await createFramescaperSelectedTimelineFilmstripTimelineImage({ ...options, project: baseline, profile: FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE, frames: ordinary, createInheritedFilmstrip: render }) ?? [] : [])];
		for (const [index, request] of options.frames.entries()) {
			const result = results.find(frame => frame.key === request.key); if (!result) throw new Error('Successor filmstrip did not produce every admitted cell.'); output[index] = result;
		}
		options.signal?.throwIfAborted(); return Object.freeze(output);
	} catch (error) { for (const frame of output) frame?.pixels.fill(0); throw error; }
	finally { for (const lease of leases) lease.release(); await frames?.dispose(); }
}
