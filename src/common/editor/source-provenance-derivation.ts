/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	copySourceProvenance,
	mergeSourceProvenance,
	normalizeSourceProvenance,
	type SourceProvenanceV1,
} from './source-provenance.ts';
import {
	findControllerSource,
	type ControllerClip,
	type ControllerProject,
	type ControllerSource,
} from './controller/track-audio/track-domain-types.ts';

export const INCOMPLETE_DERIVED_ATTRIBUTION_WARNING =
	'This derived source also contains one or more inputs whose attribution is unavailable because they predate provenance tracking.';

export interface SourceProvenanceCarrier {
	readonly provenance?: SourceProvenanceV1;
}

interface IdentifiedSourceProvenanceCarrier extends SourceProvenanceCarrier {
	readonly id?: unknown;
}

interface EffectProvenanceProject {
	readonly sources?: readonly IdentifiedSourceProvenanceCarrier[];
	readonly clips?: readonly Readonly<{
		readonly id?: unknown;
		readonly sourceId?: unknown;
		readonly timelineStartFrame?: unknown;
		readonly durationFrames?: unknown;
	}>[];
	readonly tracks?: readonly Readonly<{ readonly id?: unknown; readonly clipIds?: readonly string[] }>[];
}

interface EffectProvenanceTarget {
	readonly track: Readonly<{ readonly id: string }>;
	readonly clipId?: string;
	readonly clipIds?: readonly string[];
	readonly startFrame: number;
	readonly endFrame: number;
}

/**
 * Carry every known import contribution into a newly rendered source.
 *
 * An absent value means the inputs predate provenance tracking. A present
 * value, including a generated or recorded root with no contributions, marks
 * the output as a deliberate derived-media result.
 */
export function deriveSourceProvenance(
	inputs: readonly SourceProvenanceCarrier[],
): SourceProvenanceV1 | undefined {
	let hasUntrackedInput = false;
	const values = inputs.flatMap(({ provenance }) => {
		const copy = copySourceProvenance(provenance);
		if (!copy) hasUntrackedInput = true;
		return copy ? [copy] : [];
	});
	if (!values.length) return undefined;
	const merged = mergeSourceProvenance(values);
	const contribution = merged.contributions[0];
	if (!hasUntrackedInput || !contribution
		|| contribution.warnings.includes(INCOMPLETE_DERIVED_ATTRIBUTION_WARNING)) return merged;
	return normalizeSourceProvenance({
		...merged,
		contributions: [{
			...contribution,
			warnings: [...contribution.warnings, INCOMPLETE_DERIVED_ATTRIBUTION_WARNING],
		}, ...merged.contributions.slice(1)],
	});
}

/** Derive from the selected source ids while retaining project source order. */
export function deriveSourceProvenanceForIds(
	sources: readonly IdentifiedSourceProvenanceCarrier[],
	sourceIds: readonly unknown[],
): SourceProvenanceV1 | undefined {
	const selectedIds = new Set(sourceIds.map(String));
	return deriveSourceProvenance(sources.filter(({ id }) => selectedIds.has(String(id))));
}

/** Resolve the exact source set that materially contributed to an effect result. */
export function deriveEffectResultProvenance(
	project: EffectProvenanceProject,
	target: EffectProvenanceTarget,
): SourceProvenanceV1 | undefined {
	const track = project.tracks?.find(({ id }) => String(id) === target.track.id);
	const clipIds = target.clipId
		? [target.clipId]
		: target.clipIds?.length
			? target.clipIds
			: track?.clipIds ?? [];
	const sourceIds = (project.clips ?? []).flatMap((clip) => (
		clipIds.includes(String(clip.id))
			&& Number(clip.timelineStartFrame) < target.endFrame
			&& Number(clip.timelineStartFrame) + Number(clip.durationFrames) > target.startFrame
			? [clip.sourceId]
			: []
	));
	return deriveSourceProvenanceForIds(project.sources ?? [], sourceIds);
}

/** Resolve unique PCM inputs in clip order for a combined rendered source. */
export function deriveClipSourceTemplate(
	project: Pick<ControllerProject, 'sources'>,
	clips: readonly Pick<ControllerClip, 'sourceId'>[],
	name: string,
	frameCount: number,
	sampleRate: number,
): Readonly<{ template: ControllerSource; provenance?: SourceProvenanceV1 }> {
	const sources = [...new Map(clips.flatMap((clip) => {
		const source = findControllerSource(project, clip.sourceId);
		return source ? [[source.id, source] as const] : [];
	})).values()];
	const provenance = deriveSourceProvenance(sources);
	return {
		template: sources[0] ?? {
			id: 'stereo-template',
			storageKey: 'stereo-template',
			name,
			mimeType: 'audio/wav',
			frameCount,
			channelCount: 1,
			sampleRate,
			originalSampleRate: sampleRate,
			sampleFormat: 'float32',
		},
		...(provenance ? { provenance } : {}),
	};
}

/** Decorate a joined paste source with every input that materially contributed to it. */
export function deriveJoinedPasteSourceTemplate(
	existingSource: ControllerSource,
	pastedSource: ControllerSource,
	sampleRate: number,
): ControllerSource {
	const provenance = deriveSourceProvenance([existingSource, pastedSource]);
	return {
		...existingSource,
		sampleRate,
		...(provenance ? { provenance } : {}),
	};
}
