/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	defaultVideoSourceColorInterpretationV1,
	type VideoSourceColorInterpretationV1,
} from './video-color-management-v27.ts';

type UnreportedProvenanceV1 =
	| 'default-source-assumption'
	| 'legacy-unmanaged-encoded';

export interface VideoSourceColorInterpretationDerivationOptionsV1 {
	readonly unreported?: UnreportedProvenanceV1;
}

const COLOR_FIELDS = Object.freeze(['primaries', 'transfer', 'matrix', 'range'] as const);

/**
 * Bind a selected-V27 interpretation to the tags the maintained ingest route
 * actually persisted. A partially reported tuple stays partial: `unknown`
 * prevents managed-SDR execution from silently supplying the missing identity.
 */
export function deriveVideoSourceColorInterpretationV1(
	sourceValue: unknown,
	options: VideoSourceColorInterpretationDerivationOptionsV1 = {},
): VideoSourceColorInterpretationV1 {
	const source = record(sourceValue);
	const sourceId = stringValue(source.id, 'video color source ID');
	const sourceKind = source.kind;
	if (sourceKind !== 'video' && sourceKind !== 'still') {
		throw new RangeError('A source color interpretation requires still or video media.');
	}
	const fallback = defaultVideoSourceColorInterpretationV1(sourceKind, sourceId);
	if (sourceKind === 'still') return legacyFallback(fallback, options);
	const colour = colorRecord(source.characteristics);
	if (colour === null || !COLOR_FIELDS.some((field) => colour[field] != null)) {
		return legacyFallback(fallback, options);
	}
	const derived = Object.freeze({
		schemaVersion: 1,
		sourceId,
		sourceKind: 'video',
		primaries: primaries(colour.primaries),
		transfer: transfer(colour.transfer),
		matrix: matrix(colour.matrix),
		range: range(colour.range),
		provenance: 'metadata',
	});
	return defaultCompatibleUnknownVideo(derived) ? legacyFallback(fallback, options) : derived;
}

function defaultCompatibleUnknownVideo(value: VideoSourceColorInterpretationV1): boolean {
	const unresolved = value.primaries === 'unknown' || value.transfer === 'unknown'
		|| value.matrix === 'unknown' || value.range === 'unknown';
	return unresolved
		&& (value.primaries === 'unknown' || value.primaries === 'bt709')
		&& (value.transfer === 'unknown' || value.transfer === 'bt709')
		&& (value.matrix === 'unknown' || value.matrix === 'bt709')
		&& (value.range === 'unknown' || value.range === 'limited');
}

function legacyFallback(
	fallback: VideoSourceColorInterpretationV1,
	options: VideoSourceColorInterpretationDerivationOptionsV1,
): VideoSourceColorInterpretationV1 {
	return options.unreported === 'legacy-unmanaged-encoded'
		? Object.freeze({ ...fallback, provenance: 'legacy-unmanaged-encoded' })
		: fallback;
}

function primaries(value: unknown): VideoSourceColorInterpretationV1['primaries'] {
	const tag = normalizedTag(value);
	if (['srgb'].includes(tag)) return 'srgb';
	if (['bt709', 'bt-709', 'rec709', 'rec-709'].includes(tag)) return 'bt709';
	if (['display-p3', 'p3-d65', 'smpte432', 'smpte432-1'].includes(tag)) return 'display-p3';
	if (['bt2020', 'bt-2020', 'rec2020', 'rec-2020', 'bt2020-10', 'bt2020-12'].includes(tag)) {
		return 'bt2020';
	}
	return 'unknown';
}

function transfer(value: unknown): VideoSourceColorInterpretationV1['transfer'] {
	const tag = normalizedTag(value);
	if (['srgb', 'iec61966-2-1', 'iec-61966-2-1'].includes(tag)) return 'srgb';
	if (['bt709', 'bt-709', 'rec709', 'rec-709', 'smpte170m'].includes(tag)) return 'bt709';
	if (['pq', 'smpte2084', 'smpte-st-2084'].includes(tag)) return 'pq';
	if (['hlg', 'arib-std-b67'].includes(tag)) return 'hlg';
	return 'unknown';
}

function matrix(value: unknown): VideoSourceColorInterpretationV1['matrix'] {
	const tag = normalizedTag(value);
	if (['rgb', 'gbr', 'identity'].includes(tag)) return 'rgb';
	if (['bt709', 'bt-709', 'rec709', 'rec-709'].includes(tag)) return 'bt709';
	if (['bt2020nc', 'bt2020-nc', 'bt2020-ncl', 'bt-2020-ncl'].includes(tag)) return 'bt2020-ncl';
	return 'unknown';
}

function range(value: unknown): VideoSourceColorInterpretationV1['range'] {
	return value === 'full' ? 'full' : value === 'limited' ? 'limited' : 'unknown';
}

function normalizedTag(value: unknown): string {
	return typeof value === 'string'
		? value.trim().toLowerCase().replace(/[\s._]+/gu, '-')
		: '';
}

function colorRecord(characteristicsValue: unknown): Readonly<Record<string, unknown>> | null {
	if (!characteristicsValue || typeof characteristicsValue !== 'object'
		|| Array.isArray(characteristicsValue)) return null;
	const colour = (characteristicsValue as Readonly<Record<string, unknown>>).colour;
	return colour && typeof colour === 'object' && !Array.isArray(colour)
		? colour as Readonly<Record<string, unknown>>
		: null;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A video color source must be an object.');
	}
	return value as Readonly<Record<string, unknown>>;
}

function stringValue(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`${name} must be non-empty.`);
	return value;
}
