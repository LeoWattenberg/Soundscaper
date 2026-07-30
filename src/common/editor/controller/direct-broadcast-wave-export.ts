/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeBextMetadata,
	type BextMetadata,
	type BextMetadataInput,
} from '../broadcast-wave.ts';

const BEXT_FIELDS = Object.freeze([
	'description',
	'originator',
	'originatorReference',
	'originationDate',
	'originationTime',
	'timeReference',
	'version',
	'umid',
	'loudnessValue',
	'loudnessRange',
	'maxTruePeakLevel',
	'maxMomentaryLoudness',
	'maxShortTermLoudness',
	'codingHistory',
] as const satisfies readonly (keyof BextMetadata)[]);

export function isCanonicalBextV2(value: unknown): value is BextMetadata {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const candidate = value as Readonly<Record<string, unknown>>;
	if (Object.keys(candidate).length !== BEXT_FIELDS.length) return false;
	let normalized: BextMetadata;
	try {
		normalized = normalizeBextMetadata(candidate as BextMetadataInput, { version: 2 });
	} catch {
		return false;
	}
	return BEXT_FIELDS.every((field) => (
		Object.hasOwn(candidate, field)
		&& Object.is(candidate[field], normalized[field])
	));
}

export function sameCanonicalBext(left: BextMetadata, right: BextMetadata): boolean {
	return BEXT_FIELDS.every((field) => Object.is(left[field], right[field]));
}
