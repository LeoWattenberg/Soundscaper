/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { throwIfScapeAborted } from '../common/editor/scape-abort.ts';
import { SCAPE_ARCHIVE_LIMITS } from '../common/editor/scape-archive-envelope.ts';
import {
	canonicalMediaContentBlob,
	digestMediaContent,
} from '../common/editor/storage/media-content-digest.ts';
import type {
	OwnedMediaAssetPublication,
	OwnedMediaAssetWriter,
} from '../common/editor/storage/media-asset-write-contract.ts';
import { normalizeVideoProxyAttachmentV18 } from '../common/editor/video-proxy-attachment-v18.ts';
import {
	normalizeVideoTimingAssetReference,
	validateVideoTimingAssetBytes,
	VIDEO_TIMING_ASSET_ENCODING,
	VIDEO_TIMING_ASSET_MIME_TYPE,
	type VideoTimingAssetReference,
} from '../common/editor/video-timing-asset.ts';
import type { FramescaperProject } from './editor-project.ts';

export const FRAMESCAPER_DESKTOP_CORE_MAXIMUM_BODY_CHUNK_BYTES = 4 * 1024 * 1024;

const MAXIMUM_BODIES = 4_094;
const DIGEST = /^[a-f0-9]{64}$/u;
const PROXY_BINDING = /^p[a-f0-9]{64}$/u;
const BODY_FIELDS = [
	'kind', 'encoding', 'sourceId', 'storageKey', 'mimeType', 'byteLength', 'sha256',
] as const;
const PROXY_FIELDS = [
	'kind', 'encoding', 'bindingId', 'sourceId', 'storageKey', 'mimeType', 'byteLength', 'sha256',
] as const;

export interface FramescaperDesktopCoreBodyDescriptor {
	readonly kind: 'video-original' | 'video-proxy' | 'video-timing';
	readonly encoding: 'framescaper-video-original-v1' | 'video-proxy-v1' | typeof VIDEO_TIMING_ASSET_ENCODING;
	readonly bindingId?: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface FramescaperDesktopCoreBodyStore {
	getMediaAssetMetadata(storageKey: string): PromiseLike<unknown> | unknown;
	loadMediaAsset(storageKey: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown;
	beginMediaAssetWrite(
		storageKey: string,
		metadata: Readonly<Record<string, unknown>>,
		options: Readonly<{ expectedBytes: number; expectedSha256: string; signal?: AbortSignal }>,
	): Promise<OwnedMediaAssetWriter>;
}

export interface FramescaperDesktopCoreBodyBridge {
	readBodyChunk(request: Readonly<{
		body: Readonly<FramescaperDesktopCoreBodyDescriptor>; offset: number; length: number;
	}>): Promise<unknown>;
	writePublicationChunk(request: Readonly<{
		publicationId: string; bodyIndex: number; offset: number; bytes: Uint8Array;
	}>): Promise<unknown>;
}

export interface FramescaperDesktopCorePreparedBody {
	readonly descriptor: Readonly<FramescaperDesktopCoreBodyDescriptor>;
	readonly blob: Blob;
	readonly metadataIdentity: string;
}

interface BodyReference {
	readonly kind: FramescaperDesktopCoreBodyDescriptor['kind'];
	readonly encoding: FramescaperDesktopCoreBodyDescriptor['encoding'];
	readonly storageKey: string;
	readonly mimeType: string;
	readonly byteLength: number | null;
	readonly sha256: string | null;
	readonly bindingId?: string;
	readonly name: string;
	readonly required: boolean;
	readonly timing: Readonly<VideoTimingAssetReference> | null;
}

/** Preflight every retained body and produce the only descriptors admitted to desktop core main. */
export async function prepareFramescaperDesktopCorePublicationBodies(
	project: FramescaperProject,
	projectSha256: string,
	store: FramescaperDesktopCoreBodyStore,
	signal?: AbortSignal,
): Promise<readonly Readonly<FramescaperDesktopCorePreparedBody>[]> {
	const prepared: FramescaperDesktopCorePreparedBody[] = [];
	let aggregateBytes = 0;
	for (const reference of bodyReferences(project, projectSha256)) {
		throwIfScapeAborted(signal);
		const metadataValue = await store.getMediaAssetMetadata(reference.storageKey);
		throwIfScapeAborted(signal);
		if (metadataValue == null && !reference.required) continue;
		if (metadataValue == null) throw new Error(`Managed desktop core ${reference.kind} body ${reference.storageKey} is missing.`);
		if (reference.sha256 === null) {
			throw new Error(`Managed video original ${reference.storageKey} has no project-bound content digest.`);
		}
		const metadata = trustedMetadata(reference, metadataValue);
		aggregateBytes = addBodyBytes(aggregateBytes, metadata.size);
		const blob = await loadVerifiedBlob(store, reference, metadata, signal);
		const current = trustedMetadata(reference, await store.getMediaAssetMetadata(reference.storageKey));
		if (metadataIdentity(current) !== metadataIdentity(metadata)) {
			throw new Error(`Managed desktop core ${reference.kind} body ${reference.storageKey} changed during preflight.`);
		}
		prepared.push(Object.freeze({
			descriptor: descriptorFor(reference, metadata.size),
			blob,
			metadataIdentity: metadataIdentity(metadata),
		}));
	}
	return Object.freeze(prepared);
}

/** Upload an already-preflighted inventory through exact sequential acknowledgements. */
export async function uploadFramescaperDesktopCorePublicationBodies(
	publicationId: string,
	prepared: readonly Readonly<FramescaperDesktopCorePreparedBody>[],
	bridge: Pick<FramescaperDesktopCoreBodyBridge, 'writePublicationChunk'>,
	store: Pick<FramescaperDesktopCoreBodyStore, 'getMediaAssetMetadata'>,
	signal?: AbortSignal,
): Promise<void> {
	for (const [bodyIndex, body] of prepared.entries()) {
		const digest = sha256.create();
		for (let offset = 0; offset < body.descriptor.byteLength;) {
			throwIfScapeAborted(signal);
			const nextOffset = Math.min(
				body.descriptor.byteLength,
				offset + FRAMESCAPER_DESKTOP_CORE_MAXIMUM_BODY_CHUNK_BYTES,
			);
			const buffer = await body.blob.slice(offset, nextOffset).arrayBuffer();
			throwIfScapeAborted(signal);
			if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== nextOffset - offset) {
				throw new Error(`Managed desktop core ${body.descriptor.kind} body emitted an inexact chunk.`);
			}
			const bytes = new Uint8Array(buffer);
			digest.update(bytes);
			const acknowledgement = closedRecord(
				await bridge.writePublicationChunk({ publicationId, bodyIndex, offset, bytes }),
				['bodyIndex', 'nextOffset', 'complete'] as const,
				'Framescaper desktop core body acknowledgement',
			);
			if (acknowledgement.bodyIndex !== bodyIndex || acknowledgement.nextOffset !== nextOffset
				|| acknowledgement.complete !== (nextOffset === body.descriptor.byteLength)) {
				throw new Error('Framescaper desktop core body acknowledgement changed its sequential write.');
			}
			offset = nextOffset;
		}
		if (bytesToHex(digest.digest()) !== body.descriptor.sha256) {
			throw new Error(`Managed desktop core ${body.descriptor.kind} body changed during upload.`);
		}
		const current = await store.getMediaAssetMetadata(body.descriptor.storageKey);
		if (metadataIdentity(trustedMetadata(descriptorReference(body.descriptor), current))
			!== body.metadataIdentity) {
			throw new Error(`Managed desktop core ${body.descriptor.kind} metadata changed during upload.`);
		}
	}
}

/** Validate one bundle inventory solely against its exact retime document and project digest. */
export function validateFramescaperDesktopCoreBodies(
	project: FramescaperProject,
	projectSha256: string,
	value: unknown,
): readonly Readonly<FramescaperDesktopCoreBodyDescriptor>[] {
	const supplied = denseArray(value, 'Framescaper desktop desktop core bodies').map(bodyDescriptor);
	const byKey = new Map<string, Readonly<FramescaperDesktopCoreBodyDescriptor>>();
	for (const body of supplied) {
		const key = bodyKey(body);
		if (byKey.has(key)) throw new Error(`Framescaper desktop desktop core body ${body.storageKey} is duplicated.`);
		byKey.set(key, body);
	}
	const expected: Readonly<FramescaperDesktopCoreBodyDescriptor>[] = [];
	for (const reference of bodyReferences(project, projectSha256)) {
		const body = byKey.get(bodyKey(reference));
		if (!body) {
			if (reference.required) throw new Error(`Framescaper desktop desktop core ${reference.kind} body is missing.`);
			continue;
		}
		assertDescriptorMatches(reference, body);
		expected.push(body);
		byKey.delete(bodyKey(reference));
	}
	if (byKey.size) throw new Error('Framescaper desktop desktop core body inventory contains an unbound body.');
	if (JSON.stringify(expected) !== JSON.stringify(supplied)) {
		throw new Error('Framescaper desktop desktop core body inventory order changed.');
	}
	return Object.freeze(expected);
}

/** Verify every desktop body and atomically retain only missing local media. */
export async function acquireFramescaperDesktopCoreBodies(
	project: FramescaperProject,
	projectSha256: string,
	bodiesValue: unknown,
	bridge: Pick<FramescaperDesktopCoreBodyBridge, 'readBodyChunk'>,
	store: FramescaperDesktopCoreBodyStore,
	signal?: AbortSignal,
): Promise<void> {
	const bodies = validateFramescaperDesktopCoreBodies(project, projectSha256, bodiesValue);
	const references = new Map(bodyReferences(project, projectSha256).map((reference) => [bodyKey(reference), reference]));
	const missing = new Set<string>();
	for (const body of bodies) {
		throwIfScapeAborted(signal);
		const reference = references.get(bodyKey(body))!;
		const metadata = await store.getMediaAssetMetadata(body.storageKey);
		if (metadata == null) { missing.add(bodyKey(body)); continue; }
		trustedMetadata(reference, metadata, body.byteLength);
		await loadVerifiedBlob(store, reference, trustedMetadata(reference, metadata, body.byteLength), signal);
	}
	const publications: OwnedMediaAssetPublication[] = [];
	let activeWriter: OwnedMediaAssetWriter | null = null;
	try {
		for (const body of bodies) {
			throwIfScapeAborted(signal);
			if (!missing.has(bodyKey(body))) continue;
			const reference = references.get(bodyKey(body))!;
			activeWriter = await store.beginMediaAssetWrite(
				body.storageKey,
				{ kind: body.kind, encoding: body.encoding, mimeType: body.mimeType, name: reference.name },
				{ expectedBytes: body.byteLength, expectedSha256: body.sha256, signal },
			);
			const digest = sha256.create();
			const timingChunks: Uint8Array[] | null = reference.timing ? [] : null;
			for (let offset = 0; offset < body.byteLength;) {
				throwIfScapeAborted(signal);
				const length = Math.min(FRAMESCAPER_DESKTOP_CORE_MAXIMUM_BODY_CHUNK_BYTES, body.byteLength - offset);
				const value = await bridge.readBodyChunk({ body, offset, length });
				if (!(value instanceof Uint8Array) || value.byteLength !== length) {
					throw new Error('Framescaper desktop desktop core body read returned an inexact chunk.');
				}
				const bytes = value.slice();
				digest.update(bytes);
				timingChunks?.push(bytes);
				if (activeWriter) await activeWriter.write(bytes, { signal });
				offset += length;
			}
			if (bytesToHex(digest.digest()) !== body.sha256) {
				throw new Error(`Framescaper desktop desktop core ${body.kind} body failed its SHA-256 binding.`);
			}
			if (reference.timing && timingChunks) {
				validateVideoTimingAssetBytes(reference.timing, concatenate(timingChunks, body.byteLength));
			}
			if (activeWriter) {
				const publication = await activeWriter.commitOwned({ signal });
				assertPublication(publication, body);
				publications.push(publication);
				activeWriter = null;
			}
		}
	} catch (error) {
		const cleanup: unknown[] = [];
		if (activeWriter) try { await activeWriter.abort(); } catch (cause) { cleanup.push(cause); }
		for (const publication of publications.reverse()) {
			try { await publication.discardIfCurrent(); } catch (cause) { cleanup.push(cause); }
		}
		if (cleanup.length) throw new AggregateError([error, ...cleanup], 'V12 body acquisition rollback failed.');
		throw error;
	}
}

function bodyReferences(project: FramescaperProject, projectSha256: string): readonly BodyReference[] {
	digest(projectSha256, 'project');
	const references: BodyReference[] = [];
	const identityByKey = new Map<string, string>();
	for (const raw of project.sources as readonly Readonly<Record<string, unknown>>[]) {
		if (raw.kind !== 'video') continue;
		const source = raw as Readonly<Record<string, unknown>>;
		const sourceName = text(source.name, 'video source name');
		appendReference(references, identityByKey, {
			kind: 'video-original', encoding: 'framescaper-video-original-v1',
			storageKey: text(source.storageKey, 'video source storage key'),
			mimeType: text(source.mimeType, 'video source MIME type'),
			byteLength: null,
			sha256: typeof source.contentSha256 === 'string' && DIGEST.test(source.contentSha256)
				? source.contentSha256 : null,
			name: sourceName, required: false, timing: null,
		});
		if (source.timingAsset != null) {
			appendReference(references, identityByKey, timingReference(
				normalizeVideoTimingAssetReference(source.timingAsset), `${sourceName}.scti`,
			));
		}
		if (source.proxyAttachment == null) continue;
		const attachment = normalizeVideoProxyAttachmentV18(source.proxyAttachment);
		appendReference(references, identityByKey, {
			kind: 'video-proxy', encoding: 'video-proxy-v1', storageKey: attachment.storageKey,
			mimeType: attachment.mimeType, byteLength: attachment.byteLength, sha256: attachment.sha256,
			bindingId: proxyBindingId(
				attachment.storageKey, attachment.sha256, attachment.byteLength, attachment.mimeType,
			),
			name: `${sourceName}.proxy`, required: true, timing: null,
		});
		appendReference(references, identityByKey, timingReference(
			attachment.timingAsset, `${sourceName}.proxy.scti`,
		));
	}
	return Object.freeze(references);
}

function timingReference(referenceValue: unknown, name: string): BodyReference {
	const reference = normalizeVideoTimingAssetReference(referenceValue);
	return Object.freeze({
		kind: 'video-timing', encoding: VIDEO_TIMING_ASSET_ENCODING,
		storageKey: reference.storageKey, mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
		byteLength: reference.byteLength, sha256: reference.sha256,
		name, required: true, timing: reference,
	});
}

function appendReference(
	references: BodyReference[],
	identityByKey: Map<string, string>,
	referenceValue: BodyReference,
): void {
	const reference = Object.freeze(referenceValue);
	const key = bodyKey(reference);
	const identity = JSON.stringify([
		reference.kind, reference.encoding, reference.storageKey, reference.mimeType,
		reference.byteLength, reference.sha256, reference.bindingId ?? null,
	]);
	const prior = identityByKey.get(key);
	if (prior && prior !== identity) throw new Error(`V12 managed body aliases for ${reference.storageKey} conflict.`);
	if (prior) return;
	if (references.length >= MAXIMUM_BODIES) throw new RangeError('Framescaper desktop desktop core body limit exceeded.');
	identityByKey.set(key, identity);
	references.push(reference);
}

interface TrustedMetadata { readonly sourceId: string; readonly mimeType: string; readonly size: number; readonly sha256: string }

function trustedMetadata(reference: BodyReference, value: unknown, exactBytes = reference.byteLength): TrustedMetadata {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Managed desktop core ${reference.kind} metadata is missing.`);
	}
	const record = value as Record<PropertyKey, unknown>;
	const metadata = Object.freeze({
		sourceId: own(record, 'sourceId') as string,
		mimeType: own(record, 'mimeType') as string,
		size: own(record, 'size') as number,
		sha256: own(record, 'sha256') as string,
	});
	if (metadata.sourceId !== reference.storageKey || metadata.mimeType !== reference.mimeType
		|| !Number.isSafeInteger(metadata.size) || metadata.size < 1
		|| (exactBytes !== null && metadata.size !== exactBytes)
		|| typeof metadata.sha256 !== 'string' || !DIGEST.test(metadata.sha256)
		|| metadata.sha256 !== reference.sha256) {
		throw new Error(`Managed desktop core ${reference.kind} metadata conflicts with its project binding.`);
	}
	return metadata;
}

async function loadVerifiedBlob(
	store: Pick<FramescaperDesktopCoreBodyStore, 'loadMediaAsset'>,
	reference: BodyReference,
	metadata: TrustedMetadata,
	signal?: AbortSignal,
): Promise<Blob> {
	throwIfScapeAborted(signal);
	const blob = canonicalMediaContentBlob(await store.loadMediaAsset(reference.storageKey, { signal }));
	if (blob.size !== metadata.size || await digestMediaContent(blob, { signal }) !== metadata.sha256) {
		throw new Error(`Managed desktop core ${reference.kind} body failed immutable verification.`);
	}
	if (reference.timing) {
		validateVideoTimingAssetBytes(reference.timing, new Uint8Array(await blob.arrayBuffer()));
	}
	return blob;
}

function descriptorFor(reference: BodyReference, byteLength: number): Readonly<FramescaperDesktopCoreBodyDescriptor> {
	if (reference.sha256 === null) throw new Error('A project-bound desktop core body digest is required.');
	return Object.freeze({
		kind: reference.kind, encoding: reference.encoding,
		...(reference.bindingId ? { bindingId: reference.bindingId } : {}),
		sourceId: reference.storageKey, storageKey: reference.storageKey,
		mimeType: reference.mimeType, byteLength, sha256: reference.sha256,
	});
}

function bodyDescriptor(value: unknown): Readonly<FramescaperDesktopCoreBodyDescriptor> {
	const kind = own(value as Record<PropertyKey, unknown>, 'kind');
	const record = closedRecord(value, kind === 'video-proxy' ? PROXY_FIELDS : BODY_FIELDS, 'V12 body descriptor');
	if (kind !== 'video-original' && kind !== 'video-proxy' && kind !== 'video-timing') {
		throw new TypeError('Framescaper desktop desktop core body kind is unsupported.');
	}
	const encoding = record.encoding;
	if ((kind === 'video-original' && encoding !== 'framescaper-video-original-v1')
		|| (kind === 'video-proxy' && encoding !== 'video-proxy-v1')
		|| (kind === 'video-timing' && encoding !== VIDEO_TIMING_ASSET_ENCODING)) {
		throw new TypeError('Framescaper desktop desktop core body encoding is unsupported.');
	}
	const result = {
		kind, encoding,
		...(kind === 'video-proxy' ? { bindingId: text(record.bindingId, 'proxy binding') } : {}),
		sourceId: text(record.sourceId, 'body source id'), storageKey: text(record.storageKey, 'body storage key'),
		mimeType: text(record.mimeType, 'body MIME type'), byteLength: positive(record.byteLength, 'body length'),
		sha256: digest(record.sha256, 'body'),
	} as FramescaperDesktopCoreBodyDescriptor;
	if (result.sourceId !== result.storageKey || (kind === 'video-proxy' && !PROXY_BINDING.test(result.bindingId!))) {
		throw new TypeError('Framescaper desktop desktop core body identity is invalid.');
	}
	return Object.freeze(result);
}

function assertDescriptorMatches(reference: BodyReference, body: FramescaperDesktopCoreBodyDescriptor): void {
	if (reference.sha256 === null || body.encoding !== reference.encoding || body.mimeType !== reference.mimeType
		|| body.sha256 !== reference.sha256 || (reference.byteLength !== null && body.byteLength !== reference.byteLength)
		|| body.bindingId !== reference.bindingId) {
		throw new Error(`Framescaper desktop desktop core ${reference.kind} descriptor changed its project binding.`);
	}
}

function descriptorReference(body: FramescaperDesktopCoreBodyDescriptor): BodyReference {
	return {
		...body, name: body.storageKey, required: true, timing: null,
	};
}

function assertPublication(publication: OwnedMediaAssetPublication, body: FramescaperDesktopCoreBodyDescriptor): void {
	if (!publication || typeof publication !== 'object' || typeof publication.discardIfCurrent !== 'function'
		|| publication.metadata.sourceId !== body.storageKey || publication.metadata.mimeType !== body.mimeType
		|| publication.metadata.size !== body.byteLength || publication.metadata.sha256 !== body.sha256) {
		throw new Error(`Managed desktop core ${body.kind} publication changed its descriptor.`);
	}
}

function metadataIdentity(metadata: TrustedMetadata): string {
	return JSON.stringify(metadata);
}

function proxyBindingId(storageKey: string, bodySha256: string, byteLength: number, mimeType: string): string {
	return `p${bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
		'framescaper-v12-video-proxy-v1', storageKey, bodySha256, byteLength, mimeType,
	]))))}`;
}

function concatenate(chunks: readonly Uint8Array[], byteLength: number): Uint8Array {
	const output = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
	if (offset !== byteLength) throw new Error('Framescaper desktop desktop core timing body ended early.');
	return output;
}

function bodyKey(value: Pick<BodyReference, 'kind' | 'storageKey'>): string {
	return JSON.stringify([value.kind, value.storageKey]);
}

function denseArray(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > MAXIMUM_BODIES
		|| Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError(`${label} must be a bounded dense array.`);
	return value.map((_, index) => own(value, String(index)));
}

function closedRecord<const Field extends string>(value: unknown, fields: readonly Field[], label: string) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`${label} has missing or unsupported fields.`);
	}
	const output = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) output[field] = own(value as Record<PropertyKey, unknown>, field);
	return output;
}

function own(value: object, field: PropertyKey): unknown {
	if (!value || typeof value !== 'object') throw new TypeError(`${String(field)} requires a record.`);
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${String(field)} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function text(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 4_096) throw new TypeError(`${label} is invalid.`);
	return value;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !DIGEST.test(value)) throw new TypeError(`${label} digest is invalid.`);
	return value;
}

function positive(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes) {
		throw new RangeError(`${label} is invalid.`);
	}
	return Number(value);
}

function addBodyBytes(total: number, value: number): number {
	if (value > SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes - total) {
		throw new RangeError('Framescaper desktop desktop core managed bodies exceed their aggregate byte limit.');
	}
	return total + value;
}
