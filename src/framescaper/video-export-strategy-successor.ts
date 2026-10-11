/* SPDX-License-Identifier: AGPL-3.0-only */
import type { FfmpegOutputSink } from '../common/editor/ffmpeg-output-stream.ts';
import type { ProductVideoExportPlan, ProductVideoExportStrategy, ProductVideoExportStrategyEncodeRequest } from '../common/editor/controller/export/product-video-export-strategy.ts';
import type { VideoExportGeneratedSources } from '../common/editor/video-export-generated-sources.ts';
import type { VideoKeyframeOfflineSourcePresentation } from '../common/editor/ui/video-keyframe-offline-rgba-source.ts';
import { motionSurfaceLength } from '../common/editor/motion-surface.ts';
import { motionCompositionHasAudio } from '../common/editor/motion-composition-audio.ts';
import { planVideoPreviewCapture } from '../common/editor/video-preview-capture-admission.ts';
import { sameProjectSnapshot } from '../common/editor/storage/project-snapshot-equality.ts';
import { encodeVideoKeyframeOfflineVideo, encodeVideoKeyframeOfflineVideoToSink } from '../common/editor/ui/video-keyframe-offline-video-export.ts';
import { FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { normalizeFramescaperSuccessorProject, type FramescaperSuccessorProject } from './editor-project-successor.ts';
import { framescaperSuccessorBaselineProject } from './editor-project-successor-commands.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from './editor-project-assistance-foundation.ts';
import { createFramescaperVideoExportStrategyTimelineImage, type FramescaperVideoExportAssetStoreTimelineImage } from './video-export-strategy-timeline-image.ts';
import type { FramescaperVideoExportStrategyFinishingDependencies } from './video-export-strategy-finishing.ts';
import { createFramescaperCompositionFrameSource } from './editor-composition-link-frame-source.ts';
import { framescaperCompositionFrameAddress } from './editor-composition-link-finishing-port.ts';
import { resolveFramescaperCompositionSource } from './editor-composition-link-source.ts';
import type { FramescaperCompositionAssetReader } from './editor-composition-link-resources.ts';

interface Drawable {
	readonly drawable: TexImageSource;
	present(pixels: Uint8Array<ArrayBuffer>, width: number, height: number): void;
	dispose(): void;
}
type Options = Readonly<{
	store: FramescaperVideoExportAssetStoreTimelineImage; readAsset: FramescaperCompositionAssetReader;
	dependencies?: FramescaperVideoExportStrategyFinishingDependencies;
	acquire?: Parameters<typeof createFramescaperCompositionFrameSource>[0]['acquire'];
	createDrawable?: (width: number, height: number) => Drawable;
}>;
interface Authority {
	readonly canonical: object; readonly project: FramescaperSuccessorProject;
	readonly inherited: Readonly<Record<string, unknown>>; readonly delegate: ProductVideoExportStrategy;
}
/** The successor retains canonical scene authority while using the maintained image/finishing delivery. */
export function createFramescaperVideoExportStrategySuccessor(options: Options): ProductVideoExportStrategy {
	const exports = new WeakMap<object, Authority>();
	const plans = new WeakMap<object, Readonly<{ authority: Authority; generated: VideoExportGeneratedSources | undefined }>>();
	const strategy: ProductVideoExportStrategy = {
		createExportProject(request) {
			const project = normalizeFramescaperSuccessorProject(request.canonicalProject);
			const inherited = framescaperProjectTimelineImageFoundationShapeAssistance(framescaperSuccessorBaselineProject(project));
			const delegate = createFramescaperVideoExportStrategyTimelineImage(FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE, {
				encodeOffline: encodeVideoKeyframeOfflineVideo, encodeOfflineToSink: encodeVideoKeyframeOfflineVideoToSink,
				...options.dependencies,
				createExactSourceFrames({ encoded }) {
					const frames = createFramescaperCompositionFrameSource({ project, purpose: 'final', readAsset: options.readAsset, acquire: options.acquire });
					const combined = framescaperCompositionFrameAddress(frames, encoded);
					return Object.freeze({ resolve: combined.resolve, async dispose() { try { await combined.dispose(); } finally { await frames.dispose(); } } });
				},
			}, options.store);
			const exportProject = delegate.createExportProject({ ...request, canonicalProject: inherited });
			exports.set(exportProject, { canonical: request.canonicalProject, project, inherited, delegate }); return exportProject;
		},
		hasPicture(exportProject) { const authority = ownedExport(exportProject); return authority.delegate.hasPicture?.(exportProject) ?? false; },
		hasAudio(exportProject) {
			const project = ownedExport(exportProject).project;
			return (exportProject.clips as typeof project.clips).some(clip => {
				if (clip.kind !== 'audio') return false;
				const link = project.compositionLinks.find(link => link.audioSourceId === clip.sourceId);
				return !link || motionCompositionHasAudio(link.snapshot.project, link.compositionId);
			});
		},
		createPlan(request) {
			const authority = ownedExport(request.exportProject, request.canonicalProject);
			const plan = authority.delegate.createPlan({ ...request, canonicalProject: authority.inherited });
			if (plan) plans.set(plan, { authority, generated: generatedSources(authority.project, plan, options) }); return plan;
		},
		encode(request) { const captured = ownedRequest(request); return captured.authority.delegate.encode({ ...request, canonicalProject: captured.authority.inherited, generatedSources: captured.generated }); },
		encodeToSink<Output>(request: ProductVideoExportStrategyEncodeRequest, sink: FfmpegOutputSink<Output>) {
			const captured = ownedRequest(request); return captured.authority.delegate.encodeToSink({ ...request, canonicalProject: captured.authority.inherited, generatedSources: captured.generated }, sink);
		},
		captureTimingSourceIds(plan) { const captured = ownedPlan(plan); return captured.authority.delegate.captureTimingSourceIds?.(plan) ?? plan.activeSourceIds; },
		captureGeneratedSources: plan => ownedPlan(plan).generated,
	};
	return Object.freeze(strategy);
	function ownedExport(value: object, canonical?: object): Authority {
		const authority = exports.get(value); if (!authority || (canonical && authority.canonical !== canonical)) throw new TypeError('Successor export requires its exact canonical project.');
		if (canonical && !sameProjectSnapshot(normalizeFramescaperSuccessorProject(canonical), authority.project)) throw new Error('The successor export projection is stale.');
		return authority;
	}
	function ownedPlan(plan: ProductVideoExportPlan) { const captured = plans.get(plan); if (!captured) throw new TypeError('Successor export requires its owned plan.'); return captured; }
	function ownedRequest(request: ProductVideoExportStrategyEncodeRequest) {
		const captured = ownedPlan(request.plan); if (ownedExport(request.exportProject, request.canonicalProject) !== captured.authority) throw new TypeError('Successor export plan belongs to a different project.');
		if (request.generatedSources && (request.generatedSources.resolveSource !== captured.generated?.resolveSource
			|| JSON.stringify(request.generatedSources.sourceIds) !== JSON.stringify(captured.generated?.sourceIds))) throw new TypeError('Successor generated sources differ from the captured plan.');
		return captured;
	}
}
function generatedSources(project: FramescaperSuccessorProject, plan: ProductVideoExportPlan, options: Options): VideoExportGeneratedSources | undefined {
	const sources = project.sources as readonly Readonly<Record<string, unknown> & { id: string }>[];
	const linked = new Map(plan.activeSourceIds.flatMap(id => { const source = sources.find(source => source.id === id)!;
		const resolved = resolveFramescaperCompositionSource(project, source); return resolved ? [[id, resolved] as const] : []; }));
	if (!linked.size) return undefined;
	const occurrences = new Map<string, VideoKeyframeOfflineSourcePresentation>();
	const capability: VideoExportGeneratedSources = { sourceIds: Object.freeze([...linked.keys()]), async resolveSource(entry, request) {
		request.signal.throwIfAborted(); const sourceId = String(entry.sourceId), clipId = String(entry.clipId); const source = linked.get(sourceId)?.source;
		if (!source) throw new ReferenceError('Generated composition is not part of the captured export.');
		motionSurfaceLength(source.width, source.height); planVideoPreviewCapture({ sourceWidth: source.width, sourceHeight: source.height });
		const key = JSON.stringify([clipId, sourceId]); const current = occurrences.get(key); if (current) return current;
		const frames = createFramescaperCompositionFrameSource({ project, purpose: 'final', readAsset: options.readAsset, acquire: options.acquire, maximumCacheBytes: 1 });
		let drawable: Drawable;
		try { drawable = (options.createDrawable ?? createDrawable)(source.width, source.height); } catch (error) { await frames.dispose(); throw error; }
		let disposed = false;
		const presentation: VideoKeyframeOfflineSourcePresentation = Object.freeze({ sourceId, identity: source.contentSha256!, drawable: drawable.drawable,
			decodedWidth: source.width, decodedHeight: source.height, displayWidth: source.width, displayHeight: source.height,
			async present(value: Readonly<Record<string, unknown>>, { signal }: Readonly<{ signal: AbortSignal }>) { if (disposed) throw new Error('Composition export presentation is closed.');
				const frame = await frames.capture(value, signal); if (!frame) throw new ReferenceError('Composition export source disappeared.'); drawable.present(frame.pixels, frame.width, frame.height); },
			async dispose() { if (disposed) return; disposed = true; occurrences.delete(key); try { drawable.dispose(); } finally { await frames.dispose(); } },
		});
		occurrences.set(key, presentation); return presentation;
	} };
	return Object.freeze(capability);
}
function createDrawable(width: number, height: number): Drawable {
	const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
	const context = canvas.getContext('2d'); if (!context) throw new Error('Composition export canvas is unavailable.');
	return Object.freeze({ drawable: canvas, present(pixels: Uint8Array<ArrayBuffer>) { context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0); }, dispose() { canvas.width = 0; canvas.height = 0; } });
}
