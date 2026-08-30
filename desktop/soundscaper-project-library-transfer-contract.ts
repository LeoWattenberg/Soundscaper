/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import { normalizeAudioTrackFreezeV1 } from '../src/common/editor/audio-track-freeze-v21.ts';
import { parseScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { scapeAudioSourceLayout, type ScapeAudioSource } from '../src/common/editor/scape-archive-media.ts';
import {
	validateSoundscaperDesktopCurrentProject,
} from './soundscaper-project-library-current-project.ts';
import {
	createSoundscaperDesktopLibraryFreezeMediaBinding,
	createLegacySoundscaperDesktopLibraryFreezeMediaBinding,
	isSoundscaperDesktopLibraryFreezeMediaBindingId,
	SOUNDSCAPER_DESKTOP_LIBRARY_FREEZE_MEDIA_ENCODING,
	SOUNDSCAPER_DESKTOP_LIBRARY_FREEZE_MEDIA_MIME_TYPE,
} from './soundscaper-project-library-media-binding.ts';
import {
	validateSoundscaperDesktopLibraryMetadata,
	type SoundscaperDesktopLibraryMetadata,
	type SoundscaperDesktopLibraryProject,
} from './soundscaper-project-library-metadata.ts';
import {
	SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_FAMILY,
	SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
} from './soundscaper-project-library-contract.ts';

export const MAXIMUM_SOUNDSCAPER_TRANSFER_CHUNK_BYTES = 4 * 1024 * 1024;

const HOST_BUNDLE_FIELDS = ['metadata', 'document', 'bodies'] as const;
const PUBLIC_BUNDLE_FIELDS = ['metadataRevision', 'project', 'document', 'bodies'] as const;
const BODY_FIELDS = [
	'kind', 'encoding', 'bindingId', 'sourceId', 'storageKey', 'mimeType', 'byteLength', 'sha256',
] as const;
const READ_FIELDS = [
	'projectId', 'metadataRevision', 'projectRevision', 'projectSha256', 'body', 'offset', 'length',
] as const;
const READ_FIELDS_WITH_SIGNAL = [...READ_FIELDS, 'signal'] as const;
const DIGEST = /^[a-f0-9]{64}$/u;
const MAXIMUM_BODY_DESCRIPTORS = 4_094;
const MAXIMUM_PROJECT_ID_BYTES = 4 * 1024;
const MAXIMUM_BODY_IDENTITY_BYTES = 4 * 1024;

export interface SoundscaperDesktopProjectLibraryFreezeBody {
	readonly kind: 'audio-freeze';
	readonly encoding: typeof SOUNDSCAPER_DESKTOP_LIBRARY_FREEZE_MEDIA_ENCODING;
	readonly bindingId: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: typeof SOUNDSCAPER_DESKTOP_LIBRARY_FREEZE_MEDIA_MIME_TYPE;
	readonly byteLength: number;
	readonly sha256: string;
}

export type SoundscaperDesktopProjectLibraryTransferBody =
	SoundscaperDesktopProjectLibraryFreezeBody;

export interface SoundscaperDesktopProjectLibraryTransferBundle {
	readonly metadataRevision: number;
	readonly project: Readonly<SoundscaperDesktopLibraryProject>;
	readonly document: string;
	readonly bodies: readonly Readonly<SoundscaperDesktopProjectLibraryTransferBody>[];
}

export interface SoundscaperDesktopProjectLibraryBodyReadRequest {
	readonly projectId: string;
	readonly metadataRevision: number;
	readonly projectRevision: number;
	readonly projectSha256: string;
	readonly body: Readonly<SoundscaperDesktopProjectLibraryTransferBody>;
	readonly offset: number;
	readonly length: number;
	readonly signal?: AbortSignal;
}

export function validateSoundscaperDesktopProjectLibraryHostBundle(
	value: unknown,
	expectedProjectId: string,
): Readonly<SoundscaperDesktopProjectLibraryTransferBundle> {
	const projectId = validateSoundscaperDesktopProjectLibraryProjectId(expectedProjectId);
	const record = snapshotClosedRecord(value, HOST_BUNDLE_FIELDS, 'Soundscaper desktop baseline host bundle');
	const metadata = validateSoundscaperDesktopLibraryMetadata(record.metadata);
	const matches = metadata.projects.filter((project) => project.projectId === projectId);
	if (matches.length !== 1) throw new Error('Soundscaper desktop baseline metadata has no unique requested project');
	return validatedBundle(metadata.revision, matches[0]!, record.document, record.bodies, metadata);
}

export function validateSoundscaperDesktopProjectLibraryTransferBundle(
	value: unknown,
	expectedProjectId?: string,
): Readonly<SoundscaperDesktopProjectLibraryTransferBundle> {
	const record = snapshotClosedRecord(value, PUBLIC_BUNDLE_FIELDS, 'Soundscaper desktop baseline transfer bundle');
	const project = validateProjectRow(record.project);
	if (expectedProjectId !== undefined
		&& project.projectId !== validateSoundscaperDesktopProjectLibraryProjectId(expectedProjectId)) {
		throw new Error('Soundscaper desktop baseline transfer bundle returned another project');
	}
	return validatedBundle(
		nonNegativeInteger(record.metadataRevision, 'metadata revision'),
		project,
		record.document,
		record.bodies,
		null,
	);
}

export function validateSoundscaperDesktopProjectLibraryBodyReadRequest(
	value: unknown,
	options: Readonly<{ allowSignal?: boolean }> = {},
): Readonly<SoundscaperDesktopProjectLibraryBodyReadRequest> {
	const hasSignal = value !== null && typeof value === 'object' && Object.hasOwn(value, 'signal');
	if (hasSignal && options.allowSignal !== true) {
		throw new TypeError('Soundscaper desktop baseline body read cannot carry a signal across IPC');
	}
	const record = snapshotClosedRecord(
		value,
		hasSignal ? READ_FIELDS_WITH_SIGNAL : READ_FIELDS,
		'Soundscaper desktop baseline body read',
	);
	const body = validateSoundscaperDesktopProjectLibraryTransferBody(record.body);
	const offset = nonNegativeInteger(record.offset, 'body offset');
	const length = positiveInteger(record.length, 'body read length');
	if (length > MAXIMUM_SOUNDSCAPER_TRANSFER_CHUNK_BYTES
		|| offset >= body.byteLength || length > body.byteLength - offset) {
		throw new RangeError('Soundscaper desktop baseline body read leaves its bounded body range');
	}
	if (record.signal !== undefined && !(record.signal instanceof AbortSignal)) {
		throw new TypeError('Soundscaper desktop baseline body read signal is invalid');
	}
	return Object.freeze({
		projectId: validateSoundscaperDesktopProjectLibraryProjectId(record.projectId),
		metadataRevision: nonNegativeInteger(record.metadataRevision, 'metadata revision'),
		projectRevision: nonNegativeInteger(record.projectRevision, 'project revision'),
		projectSha256: digest(record.projectSha256, 'project'),
		body,
		offset,
		length,
		...(record.signal === undefined ? {} : { signal: record.signal as AbortSignal }),
	});
}

export function validateSoundscaperDesktopProjectLibraryTransferBody(
	value: unknown,
): Readonly<SoundscaperDesktopProjectLibraryTransferBody> {
	const record = snapshotClosedRecord(value, BODY_FIELDS, 'Soundscaper desktop baseline freeze body descriptor');
	if (record.kind !== 'audio-freeze'
		|| record.encoding !== SOUNDSCAPER_DESKTOP_LIBRARY_FREEZE_MEDIA_ENCODING
		|| record.mimeType !== SOUNDSCAPER_DESKTOP_LIBRARY_FREEZE_MEDIA_MIME_TYPE
		|| !isSoundscaperDesktopLibraryFreezeMediaBindingId(record.bindingId)) {
		throw new TypeError('Soundscaper desktop baseline freeze body identity is invalid');
	}
	return Object.freeze({
		kind: 'audio-freeze',
		encoding: SOUNDSCAPER_DESKTOP_LIBRARY_FREEZE_MEDIA_ENCODING,
		bindingId: record.bindingId,
		sourceId: bodyIdentity(record.sourceId, 'source identity'),
		storageKey: bodyIdentity(record.storageKey, 'storage key'),
		mimeType: SOUNDSCAPER_DESKTOP_LIBRARY_FREEZE_MEDIA_MIME_TYPE,
		byteLength: positiveInteger(record.byteLength, 'body byte length'),
		sha256: digest(record.sha256, 'body'),
	});
}

export function validateSoundscaperDesktopProjectLibraryProjectId(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0 || !value.trim()
		|| new TextEncoder().encode(value).byteLength > MAXIMUM_PROJECT_ID_BYTES) {
		throw new TypeError('Soundscaper desktop baseline project identity is invalid');
	}
	return value;
}

export function validateSoundscaperDesktopProjectLibraryBodyChunk(
	value: unknown,
	expectedLength: number,
): Uint8Array {
	if (!(value instanceof Uint8Array)) throw new TypeError('Soundscaper desktop baseline body chunk must be binary data');
	if (value.byteLength !== expectedLength) {
		throw new RangeError('Soundscaper desktop baseline body chunk length is invalid');
	}
	return Uint8Array.from(value);
}

export function sameSoundscaperDesktopProjectLibraryTransferBody(
	left: Readonly<SoundscaperDesktopProjectLibraryTransferBody>,
	right: Readonly<SoundscaperDesktopProjectLibraryTransferBody>,
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

/** Derive the exact pathless PCM descriptors for every track-owned freeze. */
export function createSoundscaperDesktopProjectLibraryTransferBodies(
	projectValue: unknown,
	projectSha256Value: unknown,
): readonly Readonly<SoundscaperDesktopProjectLibraryTransferBody>[] {
	return createTransferBodies(projectValue, projectSha256Value, false);
}

function createTransferBodies(
	projectValue: unknown,
	projectSha256Value: unknown,
	legacy: boolean,
): readonly Readonly<SoundscaperDesktopProjectLibraryTransferBody>[] {
	const project = validateSoundscaperDesktopCurrentProject(projectValue);
	const projectSha256 = digest(projectSha256Value, 'project');
	const sources = project.sources as readonly Readonly<Record<string, unknown>>[];
	return Object.freeze(project.tracks.flatMap((trackValue) => {
		const track = trackValue as Readonly<Record<string, unknown>>;
		if (!Object.hasOwn(track, 'audioFreeze')) return [];
		const freeze = normalizeAudioTrackFreezeV1(track.audioFreeze);
		const matches = sources.filter(({ id }) => id === freeze.derivedSourceId);
		if (matches.length !== 1) throw new Error('Soundscaper freeze body source is missing or ambiguous');
		const source = matches[0]!;
		const sourceId = bodyIdentity(source.id, 'source identity');
		const storageKey = bodyIdentity(source.storageKey, 'storage key');
		const byteLength = scapeAudioSourceLayout(source as unknown as ScapeAudioSource).archiveBytes;
		const sha256 = digest(source.contentSha256, 'freeze source');
		const binding = legacy
			? createLegacySoundscaperDesktopLibraryFreezeMediaBinding(
				String(project.id),
				JSON.stringify([source.id, source.storageKey]),
				Number(project.revision),
				projectSha256,
			)
			: createSoundscaperDesktopLibraryFreezeMediaBinding(
				sourceId,
				storageKey,
				byteLength,
				sha256,
			);
		return [Object.freeze({
			kind: 'audio-freeze' as const,
			encoding: SOUNDSCAPER_DESKTOP_LIBRARY_FREEZE_MEDIA_ENCODING,
			bindingId: binding.id,
			sourceId,
			storageKey,
			mimeType: SOUNDSCAPER_DESKTOP_LIBRARY_FREEZE_MEDIA_MIME_TYPE,
			byteLength,
			sha256,
		})];
	}));
}

function validatedBundle(
	metadataRevision: number,
	project: Readonly<SoundscaperDesktopLibraryProject>,
	documentValue: unknown,
	bodiesValue: unknown,
	metadata: Readonly<SoundscaperDesktopLibraryMetadata> | null,
): Readonly<SoundscaperDesktopProjectLibraryTransferBundle> {
	if (typeof documentValue !== 'string' || documentValue.length === 0) {
		throw new TypeError('Soundscaper desktop baseline project document must be JSON text');
	}
	const documentBytes = new TextEncoder().encode(documentValue);
	if (documentBytes.byteLength !== project.byteLength
		|| createHash('sha256').update(documentBytes).digest('hex') !== project.sha256) {
		throw new Error('Soundscaper desktop baseline project document byte length or digest changed');
	}
	const current = validateSoundscaperDesktopCurrentProject(parseScapeProjectDocument(documentValue));
	if (current.id !== project.projectId || current.title !== project.name
		|| current.revision !== project.projectRevision
		|| current.schemaFamily !== SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_FAMILY
		|| project.schemaFamily !== SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_FAMILY
		|| current.schemaVersion !== SOUNDSCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION) {
		throw new Error('Soundscaper desktop baseline project document disagrees with its metadata');
	}
	const expected = createSoundscaperDesktopProjectLibraryTransferBodies(current, project.sha256);
	const legacy = createTransferBodies(current, project.sha256, true);
	const bodies = denseArray(bodiesValue, 'Soundscaper desktop baseline freeze bodies', MAXIMUM_BODY_DESCRIPTORS)
		.map(validateSoundscaperDesktopProjectLibraryTransferBody);
	if (bodies.length !== expected.length || bodies.some((body, index) => (
		!sameSoundscaperDesktopProjectLibraryTransferBody(body, expected[index]!)
			&& !sameSoundscaperDesktopProjectLibraryTransferBody(body, legacy[index]!)
	))) throw new Error('Soundscaper desktop baseline freeze body set is incomplete or conflicts with the document');
	if (metadata) {
		for (const body of bodies) {
			const matches = metadata.media.filter(({ id }) => id === body.bindingId);
			if (matches.length !== 1 || matches[0]!.byteLength !== body.byteLength
				|| matches[0]!.sha256 !== body.sha256) {
				throw new Error('Soundscaper desktop baseline freeze body is absent from exact metadata inventory');
			}
		}
	}
	return Object.freeze({ metadataRevision, project, document: documentValue, bodies: Object.freeze(bodies) });
}

function validateProjectRow(value: unknown): Readonly<SoundscaperDesktopLibraryProject> {
	return validateSoundscaperDesktopLibraryMetadata({
		schemaVersion: 1, revision: 0, projects: [value], media: [],
	}).projects[0]!;
}

function snapshotClosedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	name: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`${name} has missing or unsupported fields`);
	const snapshot = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property`);
		}
		snapshot[field] = descriptor.value;
	}
	return snapshot;
}

function denseArray(value: unknown, name: string, maximum: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
		throw new TypeError(`${name} must be a bounded dense array`);
	}
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

function bodyIdentity(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim()
		|| new TextEncoder().encode(value).byteLength > MAXIMUM_BODY_IDENTITY_BYTES) {
		throw new TypeError(`Soundscaper desktop baseline ${label} is invalid`);
	}
	return value;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !DIGEST.test(value)) {
		throw new TypeError(`Soundscaper desktop baseline ${label} digest is invalid`);
	}
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`Soundscaper desktop baseline ${label} must be a non-negative safe integer`);
	}
	return value;
}

function positiveInteger(value: unknown, label: string): number {
	const result = nonNegativeInteger(value, label);
	if (result === 0) throw new RangeError(`Soundscaper desktop baseline ${label} must be positive`);
	return result;
}
