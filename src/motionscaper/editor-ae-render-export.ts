/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeMotionRenderPlan, type MotionRenderPlan } from '../common/editor/controller/export/motion-render-pipeline.ts';
import { normalizeMotionAeExchange } from '../common/editor/motion-ae-exchange.ts';
import type { MotionAeExchange, MotionAeProperty, MotionAeReportEntry } from '../common/editor/motion-ae-exchange-types.ts';
import { admitMotionTemporalWork } from '../common/editor/motion-temporal-sampling.ts';
import { requireMotionTrackingReady } from '../common/editor/motion-tracking-admission.ts';
import { freezeMotionValue } from '../common/editor/motion-values.ts';
import { createMotionscaperRevision, type MotionscaperRevision } from './editor-project-revision.ts';
export interface PreparedMotionscaperAeRender { readonly revision: MotionscaperRevision; readonly plan: MotionRenderPlan }
export interface MotionAeRenderedFrame { readonly index: number; readonly byteLength: number; readonly sha256: string }
const preparedRenders = new WeakSet<PreparedMotionscaperAeRender>();
export function assertPreparedMotionscaperAeRender(value: PreparedMotionscaperAeRender): void {
	if (!preparedRenders.has(value)) throw new TypeError('Review a Motion rendered AE transfer before packaging it.');
}
/** Full span and authored quality are pinned before either custody or rendering reads any asset. */
export function prepareMotionscaperAeRender(input: unknown, compositionId: string): PreparedMotionscaperAeRender {
	const revision = createMotionscaperRevision(input), composition = revision.project.compositions.find(item => item.id === compositionId);
	if (!composition) throw new Error('The composition to transfer is unavailable.');
	if (composition.durationFrames > 256) throw new RangeError('Complete AE rendered transfer supports at most 256 frames. Prepare a shorter composition; no frames are skipped.');
	const rate = composition.frameRate.num / composition.frameRate.den;
	if (composition.width < 4 || composition.height < 4 || composition.width > 30000 || composition.height > 30000 || rate < 1 || rate > 99 || composition.durationFrames / rate > 10800) throw new RangeError('AE rendered transfer requires dimensions 4–30000, frame rate 1–99 and duration at most three hours.');
	requireMotionTrackingReady(revision.project); admitMotionTemporalWork(revision.project, composition.id);
	const plan = normalizeMotionRenderPlan({ identity: { projectId: revision.projectId, revisionDigest: revision.digest, compositionId }, width: composition.width, height: composition.height,
		frameRate: composition.frameRate, firstFrame: 0, frameCount: composition.durationFrames,
		...(composition.temporal ? { temporal: composition.temporal } : {}), ...(composition.depthOfFieldSamples === undefined ? {} : { depthOfFieldSamples: composition.depthOfFieldSamples }) });
	const prepared = freezeMotionValue({ revision, plan }); preparedRenders.add(prepared); return prepared;
}
function numeric(matchName: string, value: readonly number[], spatial = false): MotionAeProperty { return { kind: 'numeric', matchName, name: matchName, value, spatial, keys: [], expression: null }; }
/** One explicit still layer per frame avoids dependence on filename sequence inference or host footage rate defaults. */
export function motionAeRenderedExchange(prepared: PreparedMotionscaperAeRender, frames: readonly MotionAeRenderedFrame[]): MotionAeExchange {
	assertPreparedMotionscaperAeRender(prepared);
	const { plan, revision } = prepared, comp = revision.project.compositions.find(item => item.id === plan.identity.compositionId)!;
	if (frames.length !== plan.frameCount) throw new Error('AE rendered exchange requires the complete composition sequence.');
	const rate = plan.frameRate.num / plan.frameRate.den, transferId = `motion-render-${revision.digest}`, compositionId = 'render-composition';
	const report: MotionAeReportEntry[] = [
		{ code: 'qualification', message: 'Development transfer: PNG frames use the maintained Motion renderer. Installed After Effects import, source interpretation, color/alpha and reference-frame comparison remain unqualified.', status: 'unsupported', scopeId: transferId, propertyPath: '' },
		{ code: 'audio-policy', message: 'Image-only transfer: all imported AE layers are muted. Original audio, unused assets, all compositions and complete authored intent remain in original.mscape; no source Save was published.', status: 'unsupported', scopeId: transferId, propertyPath: '' },
		{ code: 'png-precision', message: 'Rendered PNG is straight-alpha 8-bit sRGB, matching normal Motion PNG delivery. HDR and out-of-range values are quantized/clipped; it is not a high-precision carrier or an installed-AE color equivalence claim.', status: 'unsupported', scopeId: transferId, propertyPath: '' },
		{ code: 'rendered-editability', message: 'The full selected composition is flattened at every frame using its pinned shutter and depth-of-field quality. Layers, effects and subframe motion are no longer editable in this AE composition. The exact rational frame clock and quality remain in sequence.json; AE receives floating-point seconds.', status: 'unsupported', scopeId: compositionId, propertyPath: '' },
	];
	const footage = frames.map((frame, index) => {
		if (frame.index !== index || frame.byteLength < 33 || frame.byteLength > 64 * 1024 * 1024) throw new Error('AE rendered frames must be bounded and sequential.');
		const id = `render-frame-${String(index)}`;
		report.push({ scopeId: compositionId, code: 'composition-render-frame', propertyPath: `frame/${String(index)}`, status: 'rendered', mediaId: id,
			message: `Complete composition frame ${String(index + 1)} of ${String(plan.frameCount)}; pinned source ${revision.digest}.` });
		return { id, name: `Frame ${String(index + 1)}`, path: `media/${id}.png`, byteLength: frame.byteLength, sha256: frame.sha256, width: plan.width, height: plan.height, pixelAspect: 1, frameRate: rate, duration: 0, hasVideo: true, hasAudio: false, still: true };
	});
	const transform: MotionAeProperty = { kind: 'group', matchName: 'ADBE Transform Group', name: 'Transform', children: [numeric('ADBE Anchor Point', [0, 0], true), numeric('ADBE Position', [0, 0], true), numeric('ADBE Scale', [100, 100]), numeric('ADBE Rotate Z', [0]), numeric('ADBE Opacity', [100])] };
	return normalizeMotionAeExchange({ format: 'org.motionscaper.ae-exchange', version: 1, transferId,
		producer: { application: 'motionscaper', version: '0.1.0-alpha.1', bridgeVersion: '0.1.0' }, source: { name: revision.project.title, revisionDigest: revision.digest },
		color: { workingSpace: '', linearBlending: true, bitsPerChannel: 32 }, footage, report,
		compositions: [{ id: compositionId, name: comp.name, width: plan.width, height: plan.height, pixelAspect: 1, frameRate: rate, duration: plan.frameCount / rate, displayStartTime: 0, background: [0, 0, 0],
			layers: footage.map((media, index) => ({ id: `render-layer-${String(index)}`, name: media.name, kind: 'footage', sourceId: media.id, parentId: null, matte: null, startTime: 0, inPoint: index / rate, outPoint: (index + 1) / rate, stretch: 100, enabled: true, threeD: false, adjustment: false, blendMode: 'normal', properties: [transform] })) }],
	});
}
