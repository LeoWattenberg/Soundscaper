/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeBextMetadata,
	type BextMetadata,
	type BextMetadataInput,
} from './broadcast-wave.ts';

export type ProjectBextMetadata = Omit<BextMetadata, 'version'> & Readonly<{ version: 2 }>;
export type ProjectBextMetadataInput = Omit<BextMetadataInput, 'version'> & Readonly<{ version?: 2 }>;

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
] as const satisfies readonly (keyof ProjectBextMetadata)[]);

function objectValue(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

export function normalizeProjectBextMetadata(input: BextMetadataInput): ProjectBextMetadata {
	objectValue(input, 'project.metadata.bext');
	return normalizeBextMetadata(input, { version: 2 }) as ProjectBextMetadata;
}

function validateCanonicalProjectBextMetadata(value: unknown): void {
	const candidate = objectValue(value, 'project.metadata.bext');
	if (candidate.version !== 2) throw new RangeError('project.metadata.bext.version must be 2.');
	const normalized = normalizeProjectBextMetadata(candidate as BextMetadataInput);
	const keys = Object.keys(candidate).sort();
	const expectedKeys = [...BEXT_FIELDS].sort();
	if (
		keys.length !== expectedKeys.length
		|| keys.some((key, index) => key !== expectedKeys[index])
		|| BEXT_FIELDS.some((field) => !Object.is(candidate[field], normalized[field]))
	) {
		throw new TypeError('project.metadata.bext must be normalized BEXT v2 metadata.');
	}
}

export function validateProjectBextMetadata(metadata: unknown): true {
	const candidate = objectValue(metadata, 'project.metadata');
	if (!Object.hasOwn(candidate, 'bext')) {
		throw new TypeError('project.metadata.bext must be normalized BEXT v2 metadata or null.');
	}
	if (candidate.bext !== null) validateCanonicalProjectBextMetadata(candidate.bext);
	return true;
}
