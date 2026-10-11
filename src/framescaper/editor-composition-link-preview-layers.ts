/* SPDX-License-Identifier: AGPL-3.0-only */
import { createVideoKeyframeExportFrameSource, type VideoKeyframeExportFrameSource } from '../common/editor/video-keyframe-export-frame-source.ts';
import { bindVideoSourceTimingView, type VideoSourceTimingView } from '../common/editor/video-source-timing-view.ts';
import { registeredVideoTimingIndex } from '../common/editor/video-source-time.ts';
import { videoTimelineDurationFrames } from '../common/editor/video-timeline.js';
import { motionInteger } from '../common/editor/motion-values.ts';
import type { ProductVideoVisualPreviewCreateRequest, ProductVideoVisualPreviewFrame } from '../common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { framescaperProjectForRuntimeConsumersFinishing } from './editor-project-finishing-runtime.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import type { FramescaperProjectFinishing } from './editor-project-finishing.ts';
import { createSelectedFinishingPreviewSamplePresentation } from './selected-finishing-preview-sample-authority.ts';
type Data = Readonly<Record<string, unknown>>;
type Layer = ProductVideoVisualPreviewFrame['layers'][number];

/** Share Frame's exact clip/keyframe oracle at bounded audio-rate preview ordinals. */
export function createFramescaperCompositionPreviewLayers(project: FramescaperProjectFinishing, canvas: Omit<ProductVideoVisualPreviewCreateRequest, 'project'>, ownsSource: (id: string) => boolean) {
	const sources = project.sources as readonly Data[]; const views = new Map<string, VideoSourceTimingView>();
	for (const source of sources) {
		if (source.kind !== 'video') continue; const id = String(source.id);
		const decision = source.timingDecision as Data;
		if (decision.mode === 'conform-cfr-at-ingest') views.set(id, { kind: 'cfr', rate: source.frameRate as never, frameCount: Number(source.sourceFrameCount) });
		else { const index = registeredVideoTimingIndex(source); if (!index) throw new Error(`Composition preview has no verified timing for ${id}.`); views.set(id, { kind: 'vfr', reference: source.timingAsset as never, index: index as never }); }
	}
	const bound = new Map(sources.filter(source => source.kind === 'video').map(source => [String(source.id), bindVideoSourceTimingView(views, source)]));
	const runtimeProject = framescaperProjectForRuntimeConsumersFinishing(FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE, project);
	const presentation = createSelectedFinishingPreviewSamplePresentation({ project, runtimeProject, timingBySourceId: bound });
	const end = videoTimelineDurationFrames(runtimeProject); let start = -1, oracle: VideoKeyframeExportFrameSource | null = null;
	return (value: number): readonly Layer[] => {
		const sample = motionInteger(value, 'composition preview sample'); if (sample >= end) return Object.freeze([]);
		const next = Math.floor(sample / 1_000_000) * 1_000_000;
		if (!oracle || start !== next) {
			start = next; oracle = createVideoKeyframeExportFrameSource({ project: runtimeProject, canvas: { ...canvas, fit: canvas.fit ?? 'contain', frameRate: { num: Number(project.sampleRate), den: 1 } }, startFrame: start, endFrame: Math.min(end, start + 1_000_000),
				resolvePresentationDescriptor: request => presentation.resolvePresentationDescriptor({ ...request, outputOrdinal: start + request.outputOrdinal! }) });
		}
		return Object.freeze(oracle.frame(sample - start).layers.flatMap(value => {
			const layer = value as Data & { clips: readonly Data[] }; const entries = layer.clips.filter(entry => ownsSource(String(entry.sourceId))).map(entry => {
				const source = entry.source as Data;
				return Object.freeze({ ...entry, available: true, displayWidth: Number(source.width), displayHeight: Number(source.height), effects: entry.videoEffects ?? (entry.clip as Data).videoEffects ?? Object.freeze([]) });
			});
			return entries.length ? [Object.freeze({ trackId: String(layer.trackId), trackIndex: Number(layer.trackIndex), entries: Object.freeze(entries) })] : [];
		}));
	};
}
/** Preserve one painter-order slot when a transition shares an ordinary and virtual source. */
export function mergeFramescaperCompositionLayers(left: readonly unknown[], right: readonly Layer[]): readonly Layer[] {
	const result = left.map(value => { const layer = value as Layer; return { ...layer, entries: [...layer.entries] }; });
	for (const layer of right) {
		const existing = result.find(value => value.trackId === layer.trackId);
		if (!existing) result.push({ ...layer, entries: [...layer.entries] });
		else { if (existing.trackIndex !== layer.trackIndex) throw new Error('Composition preview track order differs.'); existing.entries.push(...layer.entries); }
	}
	return Object.freeze(result.map(layer => Object.freeze({ ...layer, entries: Object.freeze(layer.entries) })));
}
