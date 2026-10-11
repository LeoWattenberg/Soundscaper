/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionComposition, MotionLayer } from './motion-composition.ts';
import type { MotionAsset } from './motion-asset.ts';
import type { MotionscaperProject } from './motion-project-types.ts';
import { createMotionscaperRevision } from './motion-project-revision.ts';
import { normalizeMotionscaperProject } from './motion-project-validation.ts';
import { addRationals, compareRationals, divideRationals, multiplyRationals, subtractRationals, type Rational } from './timeline-time.ts';
import { motionTrackingDigest, normalizeMotionTrackingBinding, normalizeMotionTrackingResult, normalizeMotionTrackingSettings, type MotionTrackingBinding, type MotionTrackingResult, type MotionTrackingSettings } from './motion-tracking-contract.ts';
export interface MotionTrackingSource {
	readonly composition: MotionComposition; readonly layer: Extract<MotionLayer, { kind: 'footage' }>;
	readonly asset: Extract<MotionAsset, { kind: 'footage' }>;
}
export function resolveMotionTrackingSource(projectValue: unknown, compositionId: string, layerId: string): MotionTrackingSource {
	return resolveSource(normalizeMotionscaperProject(projectValue), compositionId, layerId);
}
function resolveSource(project: MotionscaperProject, compositionId: string, layerId: string): MotionTrackingSource {
	const composition = project.compositions.find(item => item.id === compositionId); const layer = composition?.layers.find(item => item.id === layerId);
	if (!composition || !layer || layer.kind !== 'footage') throw new Error('Tracking needs a retained footage layer; select footage or render the composition to retained footage first.');
	const asset = project.assets.find(item => item.id === layer.assetId);
	if (!asset || asset.kind !== 'footage') throw new Error('Tracking source footage is missing; restore the retained asset and reanalyze.');
	if (layer.timeRemap !== null) throw new Error('Tracking raw footage currently requires direct source timing; bake the time-remapped layer to retained footage first.');
	return { composition, layer, asset };
}
/** Exact static layer timing. Unsupported remapping is refused, never approximated by a frame-rate guess. */
export function motionTrackingSourceTime(composition: MotionComposition, layer: MotionLayer, frame: number): Rational {
	if (layer.timeRemap !== null) throw new Error('Bake time remapping to retained footage before tracking.');
	return addRationals(layer.sourceStart, multiplyRationals(divideRationals(subtractRationals(frame, layer.startFrame), composition.frameRate), layer.timeScale));
}
export function createMotionTrackingBinding(projectValue: unknown, compositionId: string, layerId: string, settingsValue: MotionTrackingSettings): MotionTrackingBinding {
	const revision = createMotionscaperRevision(projectValue); const settings = normalizeMotionTrackingSettings(settingsValue);
	return normalizeMotionTrackingBinding({ ...sourceAuthority(revision.project, compositionId, layerId, settings), originRevision: revision.revision, originRevisionDigest: revision.digest });
}
function sourceAuthority(project: MotionscaperProject, compositionId: string, layerId: string, settings: MotionTrackingSettings): Omit<MotionTrackingBinding, 'originRevision' | 'originRevisionDigest'> {
	const { composition, layer, asset } = resolveSource(project, compositionId, layerId);
	if (settings.points.some(([x, y]) => x < 0 || y < 0 || x >= asset.width || y >= asset.height)) throw new RangeError('Tracking seed points must be inside the retained raw source.');
	const last = settings.firstFrame + settings.frameCount - 1;
	if (last >= composition.durationFrames || compareRationals(settings.firstFrame, layer.inFrame) < 0 || compareRationals(last, layer.outFrame) >= 0) throw new RangeError('Tracking range must fit the selected layer; trim the analysis range.');
	for (const frame of [settings.firstFrame, last]) { const time = motionTrackingSourceTime(composition, layer, frame); if (time.num < 0 || compareRationals(time, asset.duration) >= 0) throw new RangeError('Tracking range reaches missing source frames; trim the range or restore the footage.'); }
	const source = { coordinateSpace: 'raw-source-pixels', projectId: project.id, compositionId, layerId, assetId: asset.id,
		asset: { sha256: asset.sha256, byteLength: asset.byteLength, mimeType: asset.mimeType, width: asset.width, height: asset.height, frameRate: asset.frameRate, duration: asset.duration, hasAlpha: asset.hasAlpha },
		frameRate: composition.frameRate, durationFrames: composition.durationFrames,
		timing: { startFrame: layer.startFrame, inFrame: layer.inFrame, outFrame: layer.outFrame, sourceStart: layer.sourceStart, timeScale: layer.timeScale, timeRemap: null } };
	return { coordinateSpace: 'raw-source-pixels', projectId: project.id, compositionId, layerId, assetId: asset.id,
		inputSha256: asset.sha256, sourceDigest: motionTrackingDigest(source), settingsDigest: motionTrackingDigest(settings),
		width: asset.width, height: asset.height };
}
export type MotionTrackingFreshness = { readonly status: 'fresh' } | { readonly status: 'stale'; readonly reason: string };
export function motionTrackingFreshness(project: unknown, resultValue: unknown): MotionTrackingFreshness {
	return freshness(() => normalizeMotionscaperProject(project), resultValue);
}
/** Pin normalization once at revision admission; source checks do not rehash every stored analysis. */
export function createMotionTrackingFreshnessChecker(projectValue: unknown): (result: unknown) => MotionTrackingFreshness {
	const project = normalizeMotionscaperProject(projectValue);
	return result => freshness(() => project, result);
}
function freshness(project: () => MotionscaperProject, resultValue: unknown): MotionTrackingFreshness {
	const result = normalizeMotionTrackingResult(resultValue);
	try {
		const expected = sourceAuthority(project(), result.binding.compositionId, result.binding.layerId, result.settings);
		if (expected.projectId !== result.binding.projectId || expected.assetId !== result.binding.assetId || expected.inputSha256 !== result.binding.inputSha256
			|| expected.sourceDigest !== result.binding.sourceDigest || expected.settingsDigest !== result.binding.settingsDigest || expected.width !== result.binding.width || expected.height !== result.binding.height) return { status: 'stale', reason: 'Tracking source pixels or timing changed; reanalyze before applying or exporting this track.' };
		return { status: 'fresh' };
	} catch (error) { return { status: 'stale', reason: error instanceof Error ? `${error.message} Reanalyze before applying or exporting this track.` : 'Tracking source is unavailable; restore it and reanalyze.' }; }
}
export function admitMotionTrackingResult(project: unknown, resultValue: unknown, mode: 'new' | 'persisted'): MotionTrackingResult {
	const result = normalizeMotionTrackingResult(resultValue); const freshness = motionTrackingFreshness(project, result);
	if (freshness.status === 'stale') throw new Error(freshness.reason);
	if (mode === 'new') {
		const revision = createMotionscaperRevision(project);
		if (revision.revision !== result.binding.originRevision || revision.digest !== result.binding.originRevisionDigest) throw new Error('Tracking finished against a different project revision; reanalyze or explicitly review the result against current source settings.');
	}
	return result;
}
