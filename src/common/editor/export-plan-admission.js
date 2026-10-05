/* SPDX-License-Identifier: AGPL-3.0-only */

import { findStereoLimitedMultichannelRenderEffects } from './adm-render-safety.ts';
import { planExportOfflineRenderStrategyAdmission } from './export-render-admission.ts';
import { normalizeLoudnessNormalizationTarget } from './loudness-normalization.ts';
import { createExportClipProject } from './export-clips.ts';
import { estimateExportSourceWorkingSetBytes } from './export-source-working-set.ts';
import { isSoundscaperProductionProject } from './project-schema-version.ts';

/**
 * What an export plan refuses, and what it sizes itself for.
 *
 * These decisions are made when the plan is built rather than when it runs, so a delivery
 * that cannot be made honestly fails before any bytes are written and no encoder ever
 * receives a flag that would let one format behave differently from another.
 */

export function deliversMasterMix(mode) {
	return mode !== 'stems' && mode !== 'clips';
}

export function assertSoundscaperEffectChannelSafety(project, mode, outputs = []) {
	if (!isSoundscaperProductionProject(project)) return;
	const targets = mode === 'clips' ? outputs.map((output) => ({ project: createExportClipProject(project, output), trackId: output.trackId })) : [{ project }];
	const issues = targets.flatMap((target) => findStereoLimitedMultichannelRenderEffects(target.project, Number(project.masterChannels), {
		includeMaster: deliversMasterMix(mode),
	}).filter((issue) => target.trackId == null || issue.scope !== 'track' || issue.targetId === target.trackId));
	if (!issues.length) return;
	throw new Error(`Multichannel audio export cannot use effects that change terminal channel width: ${issues
		.map(({ effectType, scope, targetId, channelCount }) => (
			`${effectType} on ${scope}${targetId ? ` ${targetId}` : ''} (${String(channelCount)} channels)`
		))
		.join(', ')}.`);
}

/**
 * Resolve the delivery's loudness target, refusing every case where a gain
 * cannot be applied honestly.
 *
 * Normalization is a **plan step**: the target is decided here, from the plan,
 * so no encoder ever receives a loudness flag and no format can normalize
 * differently from another. The failure this guards against is not a crash but
 * a file that looks normalized and is not, so each case below is a typed
 * refusal rather than a quietly un-normalized delivery.
 */
export function resolveExportLoudnessNormalization(options, { mode, admMetadata, renderStrategy }) {
	const target = normalizeLoudnessNormalizationTarget(options.loudnessNormalization);
	if (!target) return null;
	if (mode !== 'mix') {
		// Normalizing stems independently moves them relative to each other, so
		// their sum stops being the normalized mix. Applying the mix's gain to
		// every stem instead needs the mix rendered as well, which is the render
		// topology change this slice stops at. Chapters are refused for the same
		// reason read along the timeline: each one would be gained from its own
		// measurement, so the split would change the programme's own dynamics.
		throw new Error(mode === 'clips'
			? 'Loudness normalization is mix-only; clips require independent measurements.'
			: mode === 'chapters'
			? 'Loudness normalization is mix-only; chapters normalized one by one would no longer share the delivery\'s level.'
			: 'Loudness normalization is mix-only; normalized stems would no longer sum to the normalized mix.');
	}
	if (admMetadata?.mode === 'passthrough') {
		throw new Error('ADM passthrough preserves the source bytes and cannot be loudness-normalized.');
	}
	if (renderStrategy === 'realtime-stream') {
		// The gain is decided from a measurement of the whole delivery, which a
		// stream that encodes as it renders has no opportunity to take.
		throw new Error('Loudness normalization requires the offline render; a realtime stream cannot measure the delivery before writing it.');
	}
	return target;
}

export function selectExportOfflineRenderAdmission({
	project, mode, outputs, range, chapters, renderRanges = null, tailFrames, channelCount,
}) {
	const ranges = renderRanges ?? (mode === 'chapters' && chapters?.length ? chapters : [range]);
	const targets = deliversMasterMix(mode)
		? [{ trackId: null, includeMaster: true }]
		: outputs.map(({ trackId }) => ({ trackId, includeMaster: false }));
	const renders = mode === 'clips'
		? outputs.map((output) => ({ project: createExportClipProject(project, output), renderRange: output.range, target: { trackId: output.trackId, includeMaster: false } }))
		: ranges.flatMap((renderRange) => targets.map((target) => ({ project, renderRange, target })));
	return renders
		.reduce((selected, { project: renderProject, renderRange, target }) => {
			const candidate = planExportOfflineRenderStrategyAdmission({
				project: renderProject,
				rangeStartFrame: renderRange.startFrame,
				requestedRenderFrames: Math.max(1, renderRange.durationFrames + tailFrames),
				...(channelCount == null ? {} : { channelCount }),
				...target,
			});
			return selected == null || candidate.peakUsefulBinaryBytes > selected.peakUsefulBinaryBytes
				? candidate
				: selected;
		}, null);
}

export function estimateExportPlanSourceWorkingSetBytes(project, mode, outputs, ranges) {
	return mode === 'clips'
		? Math.max(...outputs.map((output) => estimateExportSourceWorkingSetBytes(createExportClipProject(project, output), [output.range])))
		: estimateExportSourceWorkingSetBytes(project, ranges);
}
