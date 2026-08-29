/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
	type ProjectSchemaFamily,
} from '../editor/project-schema-identity.ts';
import { isProjectFeatureAudioCapabilityId } from '../editor/project-feature-capabilities.ts';
import { createSoundscaperProjectFeatureCompatibilityService } from
	'../../soundscaper/editor-project-feature-compatibility.ts';
import { createFramescaperProjectFeatureCompatibilityService } from
	'../../framescaper/editor-project-feature-requirements.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from
	'../../framescaper/editor-project-runtime-profile.ts';

export interface CrossProductHandoffAuthorityRefusal {
	readonly root: string;
	readonly reason: string;
}

const COMPATIBILITY = Object.freeze({
	soundscaper: createSoundscaperProjectFeatureCompatibilityService(),
	framescaper: createFramescaperProjectFeatureCompatibilityService(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
	),
});

/** Refuse source semantics that the converter would otherwise discard without a materializer. */
export function crossProductHandoffSourceAuthorityRefusals(
	family: ProjectSchemaFamily,
	source: Record<string, unknown>,
): readonly Readonly<CrossProductHandoffAuthorityRefusal>[] {
	const result: CrossProductHandoffAuthorityRefusal[] = [];
	const compatibility = COMPATIBILITY[family].evaluate(source);
	if (compatibility === null) result.push({
		root: 'featureRequirements',
		reason: `The exact ${family} feature manifest could not be evaluated before editable-copy conversion.`,
	});
	else {
		const nonNativeUnmaterialized = compatibility.items.filter((item) => item.disposition !== 'native'
			&& (item.fallback?.kind === 'audio'
				|| isProjectFeatureAudioCapabilityId(item.featureId)
				|| (item.availability === 'unknown' && item.fallback?.kind !== 'video')));
		if (nonNativeUnmaterialized.length > 0) result.push({
			root: 'featureRequirements',
			reason: `The source activates ${String(nonNativeUnmaterialized.length)}`
				+ ' non-native audible or unclassified feature requirement(s)'
				+ ' through bypass or rendered-fallback authority; no authenticated repository-owned'
				+ ' materializer projected that authority, so featureRequirements cannot be dropped.',
		});
	}
	if (family === SOUNDSCAPER_PROJECT_SCHEMA_FAMILY) {
		appendSoundscaperDestinationRefusals(source, result);
	}
	return Object.freeze(result.map((item) => Object.freeze(item)));
}

/** A constructed copy is exportable only when its owning product will admit it as editable. */
export function crossProductHandoffDestinationAuthorityRefusals(
	family: ProjectSchemaFamily,
	destination: Record<string, unknown>,
): readonly Readonly<CrossProductHandoffAuthorityRefusal>[] {
	const compatibility = COMPATIBILITY[family].evaluate(destination);
	if (compatibility?.compatible === true) return Object.freeze([]);
	const count = compatibility?.items.filter(({ disposition }) => disposition !== 'native').length ?? 0;
	return Object.freeze([Object.freeze({
		root: 'featureRequirements',
		reason: compatibility === null
			? `The constructed ${family} destination feature manifest could not be evaluated as editable.`
			: `The constructed ${family} destination has ${String(count)} non-native feature requirement(s)`
				+ ' and would be intrinsically read-only; no authenticated materializer produced editable authority.',
	})]);
}

function appendSoundscaperDestinationRefusals(
	source: Record<string, unknown>,
	result: CrossProductHandoffAuthorityRefusal[],
): void {
	const timelineWarps = countAudioWarpMaps(records(source.clips, 'Soundscaper clips'));
	if (timelineWarps > 0) result.push({
		root: 'clips',
		reason: `Framescaper cannot edit Soundscaper audio-warp authority on ${String(timelineWarps)}`
			+ ' timeline audio clip(s), and no authenticated ordinary-audio materializer is available.',
	});
	const projectBin = record(source.projectBin, 'Soundscaper Project Bin');
	const binWarps = countAudioWarpMaps(records(projectBin.clips, 'Soundscaper Project Bin clips'));
	if (binWarps > 0) result.push({
		root: 'projectBin',
		reason: `Framescaper cannot edit Soundscaper audio-warp authority on ${String(binWarps)}`
			+ ' Project Bin audio clip(s), and no authenticated ordinary-audio materializer is available.',
	});
	const freezes = records(source.tracks, 'Soundscaper tracks').filter((track) => (
		track.type === 'audio' && Object.hasOwn(track, 'audioFreeze')
	)).length;
	if (freezes > 0) result.push({
		root: 'tracks',
		reason: `Framescaper cannot edit Soundscaper audio-freeze authority on ${String(freezes)}`
			+ ' audio track(s), and no authenticated ordinary-audio materializer is available.',
	});
}

function countAudioWarpMaps(clips: readonly Record<string, unknown>[]): number {
	return clips.filter((clip) => clip.kind === 'audio' && clip.warpMap != null).length;
}

function records(value: unknown, label: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
	return value.map((item, index) => record(item, `${label}[${String(index)}]`));
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be a record.`);
	}
	return value as Record<string, unknown>;
}
