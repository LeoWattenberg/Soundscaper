/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import { parseScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import {
	VIDEO_TIMING_ASSET_ENCODING,
	VIDEO_TIMING_ASSET_MIME_TYPE,
} from '../src/common/editor/video-timing-asset-reference.ts';
import {
	validateFramescaperDesktopCurrentProjectV18,
} from './project-library-v10-current-project.ts';
import {
	createFramescaperDesktopLibraryProxyMediaBinding,
	isFramescaperDesktopLibraryProxyMediaBindingId,
	FRAMESCAPER_DESKTOP_LIBRARY_PROXY_MEDIA_ENCODING,
} from './project-library-v10-media-binding.ts';
import {
	validateFramescaperDesktopLibraryV10Metadata,
	type FramescaperDesktopLibraryV10Metadata,
	type FramescaperDesktopLibraryV10Project,
} from './project-library-v10-metadata.ts';

export const MAXIMUM_FRAMESCAPER_V10_TRANSFER_CHUNK_BYTES = 4 * 1024 * 1024;

const HOST_BUNDLE_FIELDS = ['metadata', 'document', 'bodies'] as const;
const PUBLIC_BUNDLE_FIELDS = ['metadataRevision', 'project', 'document', 'bodies'] as const;
const PROXY_FIELDS = [
	'kind', 'encoding', 'bindingId', 'sourceId', 'storageKey', 'mimeType', 'byteLength', 'sha256',
] as const;
const TIMING_FIELDS = [
	'kind', 'encoding', 'sourceId', 'storageKey', 'mimeType', 'byteLength', 'sha256',
] as const;
const READ_FIELDS = [
	'projectId', 'metadataRevision', 'projectRevision', 'projectSha256', 'body', 'offset', 'length',
] as const;
const READ_FIELDS_WITH_SIGNAL = [...READ_FIELDS, 'signal'] as const;
const DIGEST = /^[a-f0-9]{64}$/u;
const MAXIMUM_BODY_DESCRIPTORS = 4_094;
const MAXIMUM_PROJECT_ID_BYTES = 4 * 1024;

interface BodyBase {
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface FramescaperDesktopProjectLibraryV10ProxyBody extends BodyBase {
	readonly kind: 'video-proxy';
	readonly encoding: typeof FRAMESCAPER_DESKTOP_LIBRARY_PROXY_MEDIA_ENCODING;
	readonly bindingId: string;
}

export interface FramescaperDesktopProjectLibraryV10TimingBody extends BodyBase {
	readonly kind: 'video-timing';
	readonly encoding: typeof VIDEO_TIMING_ASSET_ENCODING;
}

export type FramescaperDesktopProjectLibraryV10TransferBody =
	| FramescaperDesktopProjectLibraryV10ProxyBody
	| FramescaperDesktopProjectLibraryV10TimingBody;

export interface FramescaperDesktopProjectLibraryV10TransferBundle {
	readonly metadataRevision: number;
	readonly project: Readonly<FramescaperDesktopLibraryV10Project>;
	readonly document: string;
	readonly bodies: readonly Readonly<FramescaperDesktopProjectLibraryV10TransferBody>[];
}

export interface FramescaperDesktopProjectLibraryV10BodyReadRequest {
	readonly projectId: string;
	readonly metadataRevision: number;
	readonly projectRevision: number;
	readonly projectSha256: string;
	readonly body: Readonly<FramescaperDesktopProjectLibraryV10TransferBody>;
	readonly offset: number;
	readonly length: number;
	readonly signal?: AbortSignal;
}

export function validateFramescaperDesktopProjectLibraryV10HostBundle(
	value: unknown,
	expectedProjectId: string,
): Readonly<FramescaperDesktopProjectLibraryV10TransferBundle> {
	const projectId = validateFramescaperDesktopProjectLibraryV10ProjectId(expectedProjectId);
	const record = snapshotClosedRecord(value, HOST_BUNDLE_FIELDS, 'Framescaper V10 host bundle');
	const metadata = validateFramescaperDesktopLibraryV10Metadata(record.metadata);
	const matches = metadata.projects.filter((project) => project.projectId === projectId);
	if (matches.length !== 1) {
		throw new Error('Framescaper V10 metadata has no unique requested project');
	}
	return validatedBundle(metadata.revision, matches[0]!, record.document, record.bodies, metadata);
}

export function validateFramescaperDesktopProjectLibraryV10TransferBundle(
	value: unknown,
	expectedProjectId?: string,
): Readonly<FramescaperDesktopProjectLibraryV10TransferBundle> {
	const record = snapshotClosedRecord(value, PUBLIC_BUNDLE_FIELDS, 'Framescaper V10 transfer bundle');
	const project = validateProjectRow(record.project);
	if (expectedProjectId !== undefined
		&& project.projectId !== validateFramescaperDesktopProjectLibraryV10ProjectId(expectedProjectId)) {
		throw new Error('Framescaper V10 transfer bundle returned another project');
	}
	return validatedBundle(
		nonNegativeInteger(record.metadataRevision, 'metadata revision'),
		project,
		record.document,
		record.bodies,
		null,
	);
}

export function validateFramescaperDesktopProjectLibraryV10BodyReadRequest(
	value: unknown,
	options: Readonly<{ allowSignal?: boolean }> = {},
): Readonly<FramescaperDesktopProjectLibraryV10BodyReadRequest> {
	const hasSignal = value !== null && typeof value === 'object'
		&& Object.hasOwn(value, 'signal');
	if (hasSignal && options.allowSignal !== true) {
		throw new TypeError('Framescaper V10 body read cannot carry a signal across IPC');
	}
	const fields = hasSignal ? READ_FIELDS_WITH_SIGNAL : READ_FIELDS;
	const record = snapshotClosedRecord(value, fields, 'Framescaper V10 body read');
	const body = validateFramescaperDesktopProjectLibraryV10TransferBody(record.body);
	const offset = nonNegativeInteger(record.offset, 'body offset');
	const length = positiveInteger(record.length, 'body read length');
	if (length > MAXIMUM_FRAMESCAPER_V10_TRANSFER_CHUNK_BYTES) {
		throw new RangeError('Framescaper V10 body read exceeds its chunk limit');
	}
	if (offset >= body.byteLength || length > body.byteLength - offset) {
		throw new RangeError('Framescaper V10 body read leaves its declared body range');
	}
	const signal = record.signal;
	if (signal !== undefined && !(signal instanceof AbortSignal)) {
		throw new TypeError('Framescaper V10 body read signal is invalid');
	}
	return Object.freeze({
		projectId: validateFramescaperDesktopProjectLibraryV10ProjectId(record.projectId),
		metadataRevision: nonNegativeInteger(record.metadataRevision, 'metadata revision'),
		projectRevision: nonNegativeInteger(record.projectRevision, 'project revision'),
		projectSha256: digest(record.projectSha256, 'project'),
		body,
		offset,
		length,
		...(signal === undefined ? {} : { signal }),
	});
}

export function validateFramescaperDesktopProjectLibraryV10TransferBody(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV10TransferBody> {
	const kind = dataProperty(value, 'kind', 'Framescaper V10 body descriptor');
	const fields = kind === 'video-proxy' ? PROXY_FIELDS : TIMING_FIELDS;
	const record = snapshotClosedRecord(value, fields, 'Framescaper V10 body descriptor');
	const sourceId = bodyIdentity(record.sourceId, 'source identity');
	const storageKey = bodyIdentity(record.storageKey, 'storage key');
	if (sourceId !== storageKey) {
		throw new TypeError('Framescaper V10 derived body source identity must equal its storage key');
	}
	const byteLength = positiveInteger(record.byteLength, 'body byte length');
	const sha256 = digest(record.sha256, 'body');
	if (kind === 'video-proxy') {
		if (record.encoding !== FRAMESCAPER_DESKTOP_LIBRARY_PROXY_MEDIA_ENCODING
			|| !isFramescaperDesktopLibraryProxyMediaBindingId(record.bindingId)
			|| storageKey !== `video-proxy-sha256:${sha256}`
			|| typeof record.mimeType !== 'string'
			|| !/^video\/[a-z0-9][a-z0-9!#$&^_.+\-]*$/u.test(record.mimeType)) {
			throw new TypeError('Framescaper V10 proxy body descriptor is invalid');
		}
		return Object.freeze({
			kind,
			encoding: FRAMESCAPER_DESKTOP_LIBRARY_PROXY_MEDIA_ENCODING,
			bindingId: record.bindingId,
			sourceId,
			storageKey,
			mimeType: record.mimeType,
			byteLength,
			sha256,
		});
	}
	if (kind !== 'video-timing' || record.encoding !== VIDEO_TIMING_ASSET_ENCODING
		|| storageKey !== `video-timing-sha256:${sha256}`
		|| record.mimeType !== VIDEO_TIMING_ASSET_MIME_TYPE) {
		throw new TypeError('Framescaper V10 timing body descriptor is invalid');
	}
	return Object.freeze({
		kind,
		encoding: VIDEO_TIMING_ASSET_ENCODING,
		sourceId,
		storageKey,
		mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
		byteLength,
		sha256,
	});
}

export function validateFramescaperDesktopProjectLibraryV10ProjectId(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0 || !value.trim()
		|| new TextEncoder().encode(value).byteLength > MAXIMUM_PROJECT_ID_BYTES) {
		throw new TypeError('Framescaper V10 project identity is invalid');
	}
	return value;
}

export function validateFramescaperDesktopProjectLibraryV10BodyChunk(
	value: unknown,
	expectedLength: number,
): Uint8Array {
	if (!(value instanceof Uint8Array)) {
		throw new TypeError('Framescaper V10 body chunk must be binary data');
	}
	if (value.byteLength !== expectedLength) {
		throw new RangeError('Framescaper V10 body chunk length is invalid');
	}
	return Uint8Array.from(value);
}

export function sameFramescaperDesktopProjectLibraryV10TransferBody(
	left: Readonly<FramescaperDesktopProjectLibraryV10TransferBody>,
	right: Readonly<FramescaperDesktopProjectLibraryV10TransferBody>,
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

/** Derive the exact pathless body descriptors for one canonical V18 document digest. */
export function createFramescaperDesktopProjectLibraryV10TransferBodies(
	projectValue: unknown,
	projectSha256Value: unknown,
): readonly Readonly<FramescaperDesktopProjectLibraryV10TransferBody>[] {
	const project = validateFramescaperDesktopCurrentProjectV18(projectValue);
	const projectSha256 = digest(projectSha256Value, 'project');
	return expectedBodies(project, {
		projectId: String(project.id),
		projectRevision: Number(project.revision),
		sha256: projectSha256,
	});
}

function validatedBundle(
	metadataRevision: number,
	project: Readonly<FramescaperDesktopLibraryV10Project>,
	documentValue: unknown,
	bodiesValue: unknown,
	metadata: Readonly<FramescaperDesktopLibraryV10Metadata> | null,
): Readonly<FramescaperDesktopProjectLibraryV10TransferBundle> {
	if (typeof documentValue !== 'string' || documentValue.length === 0) {
		throw new TypeError('Framescaper V10 project document must be JSON text');
	}
	const documentBytes = new TextEncoder().encode(documentValue);
	if (documentBytes.byteLength !== project.byteLength
		|| createHash('sha256').update(documentBytes).digest('hex') !== project.sha256) {
		throw new Error('Framescaper V10 project document byte length or digest changed');
	}
	const parsed = parseScapeProjectDocument(documentValue);
	const current = validateFramescaperDesktopCurrentProjectV18(parsed);
	if (current.id !== project.projectId || current.title !== project.name
		|| current.revision !== project.projectRevision || current.schemaVersion !== 18) {
		throw new Error('Framescaper V10 project document disagrees with its metadata');
	}
	const expected = expectedBodies(current, project);
	const bodies = denseArray(bodiesValue, 'Framescaper V10 transfer bodies', MAXIMUM_BODY_DESCRIPTORS)
		.map(validateFramescaperDesktopProjectLibraryV10TransferBody);
	if (bodies.length !== expected.length
		|| bodies.some((body, index) => !sameFramescaperDesktopProjectLibraryV10TransferBody(
			body,
			expected[index]!,
		))) throw new Error('Framescaper V10 transfer body pair is incomplete or conflicts with V18');
	if (metadata) {
		for (const body of bodies) {
			if (body.kind !== 'video-proxy') continue;
			const matches = metadata.media.filter((media) => media.id === body.bindingId);
			if (matches.length !== 1 || matches[0]!.byteLength !== body.byteLength
				|| matches[0]!.sha256 !== body.sha256) {
				throw new Error('Framescaper V10 proxy body is absent from exact metadata inventory');
			}
		}
	}
	return Object.freeze({
		metadataRevision,
		project,
		document: documentValue,
		bodies: Object.freeze(bodies),
	});
}

function expectedBodies(
	project: ReturnType<typeof validateFramescaperDesktopCurrentProjectV18>,
	catalog: Readonly<Pick<FramescaperDesktopLibraryV10Project, 'projectId' | 'projectRevision' | 'sha256'>>,
): readonly Readonly<FramescaperDesktopProjectLibraryV10TransferBody>[] {
	const bodies: Readonly<FramescaperDesktopProjectLibraryV10TransferBody>[] = [];
	const byStorageKey = new Map<string, Readonly<FramescaperDesktopProjectLibraryV10TransferBody>>();
	for (const source of project.sources) {
		if (source.kind !== 'video' || source.proxyAttachment === null) continue;
		const attachment = source.proxyAttachment;
		const binding = createFramescaperDesktopLibraryProxyMediaBinding(
			String(project.id), attachment.storageKey, Number(project.revision), catalog.sha256,
		);
		addExpectedBody(Object.freeze({
			kind: 'video-proxy',
			encoding: FRAMESCAPER_DESKTOP_LIBRARY_PROXY_MEDIA_ENCODING,
			bindingId: binding.id,
			sourceId: attachment.storageKey,
			storageKey: attachment.storageKey,
			mimeType: attachment.mimeType,
			byteLength: attachment.byteLength,
			sha256: attachment.sha256,
		}), bodies, byStorageKey);
		addExpectedBody(Object.freeze({
			kind: 'video-timing',
			encoding: VIDEO_TIMING_ASSET_ENCODING,
			sourceId: attachment.timingAsset.storageKey,
			storageKey: attachment.timingAsset.storageKey,
			mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
			byteLength: attachment.timingAsset.byteLength,
			sha256: attachment.timingAsset.sha256,
		}), bodies, byStorageKey);
	}
	return bodies;
}

function addExpectedBody(
	body: Readonly<FramescaperDesktopProjectLibraryV10TransferBody>,
	bodies: Readonly<FramescaperDesktopProjectLibraryV10TransferBody>[],
	byStorageKey: Map<string, Readonly<FramescaperDesktopProjectLibraryV10TransferBody>>,
): void {
	const prior = byStorageKey.get(body.storageKey);
	if (prior) {
		if (!sameFramescaperDesktopProjectLibraryV10TransferBody(prior, body)) {
			throw new Error('Framescaper V10 V18 body references conflict');
		}
		return;
	}
	byStorageKey.set(body.storageKey, body);
	bodies.push(body);
}

function validateProjectRow(value: unknown): Readonly<FramescaperDesktopLibraryV10Project> {
	return validateFramescaperDesktopLibraryV10Metadata({
		schemaVersion: 10,
		revision: 0,
		projects: [value],
		media: [],
	}).projects[0]!;
}

function dataProperty(value: unknown, key: string, name: string): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain record`);
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property`);
	}
	return descriptor.value;
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

function bodyIdentity(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0 || !value.trim()
		|| new TextEncoder().encode(value).byteLength > MAXIMUM_PROJECT_ID_BYTES) {
		throw new TypeError(`Framescaper V10 body ${label} is invalid`);
	}
	return value;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !DIGEST.test(value)) {
		throw new TypeError(`Framescaper V10 ${label} digest is invalid`);
	}
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`Framescaper V10 ${label} must be a non-negative safe integer`);
	}
	return value;
}

function positiveInteger(value: unknown, label: string): number {
	const result = nonNegativeInteger(value, label);
	if (result === 0) throw new RangeError(`Framescaper V10 ${label} must be positive`);
	return result;
}
