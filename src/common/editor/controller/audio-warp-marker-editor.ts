/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeAudioWarpMap,
	type AudioWarpMap,
} from '../audio-warp-domain.ts';
import { normalizeAudioWarpRational } from '../audio-groove-template.ts';
import {
	readClosedDomainField,
	readClosedDomainRecord,
} from '../closed-domain-value.ts';
import { compareRationals, type RationalInput } from '../timeline-time.ts';

export interface AudioWarpMarkerInput {
	readonly outer: RationalInput;
	readonly source: RationalInput;
}

/** Add one exact interior marker; canonical map validation owns both monotonic axes. */
export function addAudioWarpMarker(
	mapValue: unknown,
	markerValue: AudioWarpMarkerInput,
): Readonly<AudioWarpMap> {
	const map = normalizeAudioWarpMap(mapValue);
	const marker = normalizeMarker(markerValue);
	const points = [...map.points, marker].sort((left, right) => compareRationals(left.outer, right.outer));
	return normalizeAudioWarpMap({ feature: 'audio-warp', points });
}

/** Move one interior marker without changing its stable ordered position. */
export function moveAudioWarpMarker(
	mapValue: unknown,
	pointIndex: number,
	markerValue: AudioWarpMarkerInput,
): Readonly<AudioWarpMap> {
	const map = normalizeAudioWarpMap(mapValue);
	const index = interiorIndex(pointIndex, map.points.length);
	const points = map.points.map((point, candidate) => (
		candidate === index ? normalizeMarker(markerValue) : point
	));
	return normalizeAudioWarpMap({ feature: 'audio-warp', points });
}

/** Delete one interior marker while retaining the protected clip endpoints. */
export function deleteAudioWarpMarker(
	mapValue: unknown,
	pointIndex: number,
): Readonly<AudioWarpMap> {
	const map = normalizeAudioWarpMap(mapValue);
	const index = interiorIndex(pointIndex, map.points.length);
	return normalizeAudioWarpMap({
		feature: 'audio-warp',
		points: map.points.filter((_point, candidate) => candidate !== index),
	});
}

function normalizeMarker(value: AudioWarpMarkerInput) {
	const name = 'audio warp marker';
	const record = readClosedDomainRecord(value, name, ['outer', 'source']);
	return Object.freeze({
		outer: normalizeAudioWarpRational(readClosedDomainField(record, 'outer', name), `${name} outer`),
		source: normalizeAudioWarpRational(readClosedDomainField(record, 'source', name), `${name} source`),
		mode: 'forward' as const,
	});
}

function interiorIndex(value: number, pointCount: number): number {
	if (!Number.isSafeInteger(value) || value < 1 || value >= pointCount - 1) {
		throw new RangeError('Audio warp marker edits require an interior point index.');
	}
	return value;
}
