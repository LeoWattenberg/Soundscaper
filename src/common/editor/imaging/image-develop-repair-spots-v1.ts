/* SPDX-License-Identifier: AGPL-3.0-only */

import { array, boolean, field, id, number, oneOf, record, unique } from './image-develop-value.ts';

export const IMAGE_DEVELOP_REPAIR_LIMITS_V1 = Object.freeze({
	maximumSpots: 64,
	maximumSourceBytes: 67_108_864,
	maximumCloneVisits: 16_777_216,
	maximumHealHaloSide: 512,
	healIterations: 64,
	maximumHealRelaxations: 16_777_216,
	maximumScratchBytes: 33_554_432,
	maximumStageWorkingBytes: 335_544_320,
	maximumOperationsBeforeYield: 16_384,
	scratchBytesPerPixel: 105,
	scratchControlBytes: 4_096,
});

export interface ImageDevelopRepairPointV1 {
	readonly x: number;
	readonly y: number;
}
export interface ImageDevelopRepairSpotV1 {
	readonly id: string;
	readonly mode: 'clone' | 'heal';
	readonly enabled: boolean;
	readonly target: Readonly<ImageDevelopRepairPointV1>;
	readonly source: Readonly<ImageDevelopRepairPointV1>;
	readonly radius: number;
	readonly feather: number;
	readonly opacity: number;
}
export interface ImageDevelopRepairSpotsV1 {
	readonly schemaVersion: 1;
	readonly spots: readonly Readonly<ImageDevelopRepairSpotV1>[];
}

export function normalizeImageDevelopRepairSpotsV1(value: unknown): Readonly<ImageDevelopRepairSpotsV1> {
	const input = record(value, 'image repair spots', ['schemaVersion', 'spots']);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported image repair spots version.');
	const spots = Object.freeze(array(field(input, 'spots'), 'image repair spots', 0, IMAGE_DEVELOP_REPAIR_LIMITS_V1.maximumSpots).map(spot));
	unique(spots.map(candidate => candidate.id), 'image repair spots');
	return Object.freeze({ schemaVersion: 1, spots });
}

function spot(value: unknown): Readonly<ImageDevelopRepairSpotV1> {
	const input = record(value, 'image repair spot', ['id', 'mode', 'enabled', 'target', 'source', 'radius', 'feather', 'opacity']);
	const radius = number(field(input, 'radius'), 0, 1, 'image repair radius');
	if (radius === 0) throw new RangeError('Image repair radius must be positive.');
	return Object.freeze({
		id: id(field(input, 'id'), 'image repair spot'),
		mode: oneOf(field(input, 'mode'), ['clone', 'heal'] as const, 'image repair mode'),
		enabled: boolean(field(input, 'enabled'), 'image repair spot'),
		target: point(field(input, 'target'), 'image repair target'),
		source: point(field(input, 'source'), 'image repair source'),
		radius,
		feather: number(field(input, 'feather'), 0, 1, 'image repair feather'),
		opacity: number(field(input, 'opacity'), 0, 1, 'image repair opacity'),
	});
}

function point(value: unknown, name: string): Readonly<ImageDevelopRepairPointV1> {
	const input = record(value, name, ['x', 'y']);
	return Object.freeze({ x: number(field(input, 'x'), 0, 1, `${name}.x`), y: number(field(input, 'y'), 0, 1, `${name}.y`) });
}
