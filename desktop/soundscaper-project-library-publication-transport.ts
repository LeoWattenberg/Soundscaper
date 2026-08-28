/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateSoundscaperDesktopCurrentProject,
} from './soundscaper-project-library-current-project.ts';
import {
	MAXIMUM_SOUNDSCAPER_TRANSFER_CHUNK_BYTES,
	validateSoundscaperDesktopProjectLibraryTransferBody,
	validateSoundscaperDesktopProjectLibraryTransferBundle,
	type SoundscaperDesktopProjectLibraryTransferBody,
	type SoundscaperDesktopProjectLibraryTransferBundle,
} from './soundscaper-project-library-transfer-contract.ts';

export interface SoundscaperDesktopProjectLibraryPublicationExpectedProject {
	readonly projectRevision: number;
	readonly projectSha256: string;
}

export interface SoundscaperDesktopProjectLibraryPublicationBeginRequest {
	readonly publicationId: string;
	readonly expectedMetadataRevision: number;
	readonly expectedProject: Readonly<SoundscaperDesktopProjectLibraryPublicationExpectedProject> | null;
	readonly project: unknown;
	readonly bodies: readonly Readonly<SoundscaperDesktopProjectLibraryTransferBody>[];
}

export interface SoundscaperDesktopProjectLibraryPublicationAdmission {
	readonly publicationId: string;
	readonly maximumChunkBytes: number;
	readonly bodyCount: number;
}

export interface SoundscaperDesktopProjectLibraryPublicationChunkRequest {
	readonly publicationId: string;
	readonly bodyIndex: number;
	readonly offset: number;
	readonly bytes: Uint8Array;
}

export interface SoundscaperDesktopProjectLibraryPublicationChunkAcknowledgement {
	readonly bodyIndex: number;
	readonly nextOffset: number;
	readonly complete: boolean;
}

export interface SoundscaperDesktopProjectLibraryPublicationCompletionRequest {
	readonly publicationId: string;
}

const BEGIN_FIELDS = ['publicationId', 'expectedMetadataRevision', 'expectedProject', 'project', 'bodies'] as const;
const EXPECTED_FIELDS = ['projectRevision', 'projectSha256'] as const;
const ADMISSION_FIELDS = ['publicationId', 'maximumChunkBytes', 'bodyCount'] as const;
const CHUNK_FIELDS = ['publicationId', 'bodyIndex', 'offset', 'bytes'] as const;
const ACKNOWLEDGEMENT_FIELDS = ['bodyIndex', 'nextOffset', 'complete'] as const;
const COMPLETION_FIELDS = ['publicationId'] as const;
const PUBLICATION_ID = /^[a-f0-9]{48}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const MAXIMUM_BODY_DESCRIPTORS = 4_094;

export function validateSoundscaperDesktopProjectLibraryPublicationBeginRequest(
	value: unknown,
): Readonly<SoundscaperDesktopProjectLibraryPublicationBeginRequest> {
	const record = snapshotClosedRecord(value, BEGIN_FIELDS, 'Soundscaper desktop baseline publication begin');
	const document = JSON.stringify(record.project);
	if (typeof document !== 'string' || document.length === 0) {
		throw new TypeError('Soundscaper desktop baseline publication project is not JSON serializable');
	}
	const project = JSON.parse(document) as unknown;
	validateSoundscaperDesktopCurrentProject(project);
	const expectedProject = validateExpectedProject(record.expectedProject);
	const bodies = denseArray(
		record.bodies,
		'Soundscaper desktop baseline publication body descriptors',
		MAXIMUM_BODY_DESCRIPTORS,
	).map(validateSoundscaperDesktopProjectLibraryTransferBody);
	return Object.freeze({
		publicationId: publicationId(record.publicationId),
		expectedMetadataRevision: nonNegativeInteger(
			record.expectedMetadataRevision,
			'expected metadata revision',
		),
		expectedProject,
		project,
		bodies: Object.freeze(bodies),
	});
}

export function validateSoundscaperDesktopProjectLibraryPublicationAdmission(
	value: unknown,
	expectedBodyCount: number,
): Readonly<SoundscaperDesktopProjectLibraryPublicationAdmission> {
	const record = snapshotClosedRecord(value, ADMISSION_FIELDS, 'Soundscaper desktop baseline publication admission');
	const bodyCount = nonNegativeInteger(record.bodyCount, 'publication body count');
	if (bodyCount !== expectedBodyCount || bodyCount > MAXIMUM_BODY_DESCRIPTORS) {
		throw new Error('Soundscaper desktop baseline publication admission body count changed');
	}
	if (record.maximumChunkBytes !== MAXIMUM_SOUNDSCAPER_TRANSFER_CHUNK_BYTES) {
		throw new Error('Soundscaper desktop baseline publication admission chunk bound changed');
	}
	return Object.freeze({
		publicationId: publicationId(record.publicationId),
		maximumChunkBytes: MAXIMUM_SOUNDSCAPER_TRANSFER_CHUNK_BYTES,
		bodyCount,
	});
}

export function validateSoundscaperDesktopProjectLibraryPublicationChunkRequest(
	value: unknown,
): Readonly<SoundscaperDesktopProjectLibraryPublicationChunkRequest> {
	const record = snapshotClosedRecord(value, CHUNK_FIELDS, 'Soundscaper desktop baseline publication chunk');
	const bytes = binary(record.bytes);
	if (bytes.byteLength < 1
		|| bytes.byteLength > MAXIMUM_SOUNDSCAPER_TRANSFER_CHUNK_BYTES) {
		throw new RangeError('Soundscaper desktop baseline publication chunk exceeds its byte limit');
	}
	return Object.freeze({
		publicationId: publicationId(record.publicationId),
		bodyIndex: nonNegativeInteger(record.bodyIndex, 'publication body index'),
		offset: nonNegativeInteger(record.offset, 'publication chunk offset'),
		bytes,
	});
}

export function validateSoundscaperDesktopProjectLibraryPublicationChunkAcknowledgement(
	value: unknown,
	request: Readonly<SoundscaperDesktopProjectLibraryPublicationChunkRequest>,
): Readonly<SoundscaperDesktopProjectLibraryPublicationChunkAcknowledgement> {
	const record = snapshotClosedRecord(
		value,
		ACKNOWLEDGEMENT_FIELDS,
		'Soundscaper desktop baseline publication chunk acknowledgement',
	);
	const expectedOffset = checkedAdd(request.offset, request.bytes.byteLength, 'publication offset');
	if (record.bodyIndex !== request.bodyIndex || record.nextOffset !== expectedOffset
		|| typeof record.complete !== 'boolean') {
		throw new Error('Soundscaper desktop baseline publication acknowledgement changed its sequential write');
	}
	return Object.freeze({
		bodyIndex: request.bodyIndex,
		nextOffset: expectedOffset,
		complete: record.complete,
	});
}

export function validateSoundscaperDesktopProjectLibraryPublicationCompletionRequest(
	value: unknown,
): Readonly<SoundscaperDesktopProjectLibraryPublicationCompletionRequest> {
	const record = snapshotClosedRecord(
		value,
		COMPLETION_FIELDS,
		'Soundscaper desktop baseline publication completion',
	);
	return Object.freeze({ publicationId: publicationId(record.publicationId) });
}

export function validateSoundscaperDesktopProjectLibraryPublicationResult(
	value: unknown,
	expectedProjectId: string,
): Readonly<SoundscaperDesktopProjectLibraryTransferBundle> {
	return validateSoundscaperDesktopProjectLibraryTransferBundle(value, expectedProjectId);
}

export function validateSoundscaperDesktopProjectLibraryPublicationAbortResult(
	value: unknown,
): boolean {
	if (typeof value !== 'boolean') {
		throw new TypeError('Soundscaper desktop baseline publication abort result must be a boolean');
	}
	return value;
}

function validateExpectedProject(
	value: unknown,
): Readonly<SoundscaperDesktopProjectLibraryPublicationExpectedProject> | null {
	if (value === null) return null;
	const record = snapshotClosedRecord(value, EXPECTED_FIELDS, 'Soundscaper desktop baseline expected project');
	if (typeof record.projectSha256 !== 'string' || !DIGEST.test(record.projectSha256)) {
		throw new TypeError('Soundscaper desktop baseline expected project digest is invalid');
	}
	return Object.freeze({
		projectRevision: nonNegativeInteger(record.projectRevision, 'expected project revision'),
		projectSha256: record.projectSha256,
	});
}

function publicationId(value: unknown): string {
	if (typeof value !== 'string' || !PUBLICATION_ID.test(value)) {
		throw new TypeError('Soundscaper desktop baseline publication id is invalid');
	}
	return value;
}

function binary(value: unknown): Uint8Array {
	if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
	}
	throw new TypeError('Soundscaper desktop baseline publication chunk must be binary data');
}

function denseArray(value: unknown, name: string, maximum: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| value.length > maximum) throw new TypeError(`${name} must be a bounded dense array`);
	const keys = Reflect.ownKeys(value);
	if (keys.length !== value.length + 1 || keys[keys.length - 1] !== 'length') {
		throw new TypeError(`${name} must be a bounded dense array`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		if (keys[index] !== String(index)) throw new TypeError(`${name} must be a bounded dense array`);
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} must contain data elements`);
		}
		result.push(descriptor.value);
	}
	return result;
}

function snapshotClosedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	name: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain record`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`${name} has missing or unsupported fields`);
	const result = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property`);
		}
		result[field] = descriptor.value;
	}
	return result;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`Soundscaper desktop baseline ${label} must be a non-negative safe integer`);
	}
	return value;
}

function checkedAdd(left: number, right: number, label: string): number {
	if (left > Number.MAX_SAFE_INTEGER - right) {
		throw new RangeError(`Soundscaper desktop baseline ${label} exceeds the safe integer range`);
	}
	return left + right;
}
