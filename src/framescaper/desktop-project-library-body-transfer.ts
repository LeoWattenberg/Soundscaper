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
	type VideoTimingAssetReference,
} from '../common/editor/video-timing-asset.ts';
import {
	FRAMESCAPER_DESKTOP_CORE_MAXIMUM_BODY_CHUNK_BYTES,
	prepareFramescaperDesktopCorePublicationBodies,
	type FramescaperDesktopCoreBodyStore,
} from './desktop-project-library-core-body-transfer.ts';
import {
	collectFramescaperDesktopExtensionBodyReferences,
	framescaperDesktopCoreBodyProject,
	validateFramescaperDesktopBodies,
	type FramescaperDesktopBodyDescriptor,
	type FramescaperDesktopExtensionBodyReference,
} from './desktop-project-library-body-contract.ts';
import {
	validateFramescaperScapeAssetReferenceBytes,
} from './editor-scape-asset-plan.ts';
import type { FramescaperProject } from './editor-project.ts';

export type { FramescaperDesktopBodyDescriptor } from './desktop-project-library-body-contract.ts';
export { validateFramescaperDesktopBodies } from './desktop-project-library-body-contract.ts';
export type FramescaperDesktopBodyStore = FramescaperDesktopCoreBodyStore;

export interface FramescaperDesktopPreparedBody {
	readonly descriptor: Readonly<FramescaperDesktopBodyDescriptor>;
	readonly blob: Blob | null;
	readonly metadataIdentity: string;
}

export type FramescaperDesktopBodySelection = (
	descriptor: Readonly<FramescaperDesktopBodyDescriptor>,
	bodyIndex: number,
) => boolean;

export interface FramescaperDesktopBodyBridge {
	readBodyChunk(request: Readonly<{
		body: Readonly<FramescaperDesktopBodyDescriptor>;
		offset: number;
		length: number;
	}>): Promise<unknown>;
	writePublicationChunk(request: Readonly<{
		publicationId: string;
		bodyIndex: number;
		offset: number;
		bytes: Uint8Array;
	}>): Promise<unknown>;
}

interface TrustedMetadata {
	readonly sourceId: string;
	readonly mimeType: string;
	readonly size: number;
	readonly sha256: string;
	readonly kind: string | null;
	readonly encoding: string | null;
}

interface TransferReference {
	readonly descriptor: Readonly<FramescaperDesktopBodyDescriptor>;
	readonly name: string;
	readonly timing: Readonly<VideoTimingAssetReference> | null;
	readonly extension: Readonly<FramescaperDesktopExtensionBodyReference> | null;
}

/** Preflight the complete selected-baseline body graph before main-process admission. */
export async function prepareFramescaperDesktopPublicationBodies(
	project: FramescaperProject,
	projectSha256: string,
	store: FramescaperDesktopCoreBodyStore,
	signal?: AbortSignal,
	selectBody: FramescaperDesktopBodySelection = () => true,
): Promise<readonly Readonly<FramescaperDesktopPreparedBody>[]> {
	const base = await prepareFramescaperDesktopCorePublicationBodies(
		framescaperDesktopCoreBodyProject(project), projectSha256, store, signal, selectBody,
	);
	const normalizedBase: FramescaperDesktopPreparedBody[] = [];
	for (const item of base) {
		throwIfScapeAborted(signal);
		const descriptor = item.descriptor as Readonly<FramescaperDesktopBodyDescriptor>;
		const metadata = trustedMetadata(descriptor, await store.getMediaAssetMetadata(descriptor.storageKey));
		normalizedBase.push(Object.freeze({
			descriptor, blob: item.blob, metadataIdentity: metadataIdentity(metadata),
		}));
	}
	const extension: FramescaperDesktopPreparedBody[] = [];
	for (const reference of collectFramescaperDesktopExtensionBodyReferences(project)) {
		throwIfScapeAborted(signal);
		const descriptor = await extensionDescriptor(reference, store, signal);
		const metadata = trustedMetadata(descriptor,
			await store.getMediaAssetMetadata(descriptor.storageKey));
		const blob = selectBody(descriptor, normalizedBase.length + extension.length)
			? await loadVerifiedBlob(store, transferReference(descriptor, project), metadata, signal) : null;
		const current = trustedMetadata(descriptor,
			await store.getMediaAssetMetadata(descriptor.storageKey));
		if (metadataIdentity(current) !== metadataIdentity(metadata)) {
			throw new Error(`Managed baseline ${descriptor.kind} metadata changed during preflight.`);
		}
		extension.push(Object.freeze({ descriptor, blob, metadataIdentity: metadataIdentity(metadata) }));
	}
	const prepared: readonly Readonly<FramescaperDesktopPreparedBody>[] = Object.freeze([
		...normalizedBase, ...extension,
	]);
	validateFramescaperDesktopBodies(project, projectSha256,
		prepared.map(({ descriptor }) => descriptor));
	assertAggregateBytes(prepared.map(({ descriptor }) => descriptor));
	return prepared;
}

/** Upload the immutable preflight snapshot with exact sequential acknowledgements. */
export async function uploadFramescaperDesktopPublicationBodies(
	publicationId: string,
	prepared: readonly Readonly<FramescaperDesktopPreparedBody>[],
	bridge: Pick<FramescaperDesktopBodyBridge, 'writePublicationChunk'>,
	store: Pick<FramescaperDesktopCoreBodyStore, 'getMediaAssetMetadata'>,
	signal?: AbortSignal,
): Promise<void> {
	for (const [bodyIndex, body] of prepared.entries()) {
		if (body.blob === null) continue;
		const digest = sha256.create();
		for (let offset = 0; offset < body.descriptor.byteLength;) {
			throwIfScapeAborted(signal);
			const nextOffset = Math.min(body.descriptor.byteLength,
				offset + FRAMESCAPER_DESKTOP_CORE_MAXIMUM_BODY_CHUNK_BYTES);
			const buffer = await body.blob.slice(offset, nextOffset).arrayBuffer();
			throwIfScapeAborted(signal);
			if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== nextOffset - offset) {
				throw new Error(`Managed baseline ${body.descriptor.kind} emitted an inexact chunk.`);
			}
			const bytes = new Uint8Array(buffer);
			digest.update(bytes);
			const acknowledgement = acknowledgementRecord(await bridge.writePublicationChunk({
				publicationId, bodyIndex, offset, bytes,
			}));
			if (acknowledgement.bodyIndex !== bodyIndex || acknowledgement.nextOffset !== nextOffset
				|| acknowledgement.complete !== (nextOffset === body.descriptor.byteLength)) {
				throw new Error('Framescaper baseline body acknowledgement changed its sequential write.');
			}
			offset = nextOffset;
		}
		if (bytesToHex(digest.digest()) !== body.descriptor.sha256) {
			throw new Error(`Managed baseline ${body.descriptor.kind} changed during upload.`);
		}
		const current = trustedMetadata(body.descriptor,
			await store.getMediaAssetMetadata(body.descriptor.storageKey));
		if (metadataIdentity(current) !== body.metadataIdentity) {
			throw new Error(`Managed baseline ${body.descriptor.kind} metadata changed during upload.`);
		}
	}
}

/** Acquire every missing body as one rollback-capable local publication set. */
export async function acquireFramescaperDesktopBodies(
	project: FramescaperProject,
	projectSha256: string,
	bodiesValue: unknown,
	bridge: Pick<FramescaperDesktopBodyBridge, 'readBodyChunk'>,
	store: FramescaperDesktopCoreBodyStore,
	signal?: AbortSignal,
): Promise<void> {
	const bodies = validateFramescaperDesktopBodies(project, projectSha256, bodiesValue);
	assertAggregateBytes(bodies);
	const references = new Map(bodies.map((body) => [bodyKey(body), transferReference(body, project)]));
	const missing = new Set<string>();
	for (const body of bodies) {
		throwIfScapeAborted(signal);
		const metadataValue = await store.getMediaAssetMetadata(body.storageKey);
		if (metadataValue == null) { missing.add(bodyKey(body)); continue; }
		const metadata = trustedMetadata(body, metadataValue);
		await loadVerifiedBlob(store, references.get(bodyKey(body))!, metadata, signal);
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
				{ kind: storageKind(body.kind), encoding: body.encoding, mimeType: body.mimeType, name: reference.name },
				{ expectedBytes: body.byteLength, expectedSha256: body.sha256, signal },
			);
			const digest = sha256.create();
			const semanticChunks: Uint8Array[] | null = requiresSemanticBytes(reference) ? [] : null;
			for (let offset = 0; offset < body.byteLength;) {
				throwIfScapeAborted(signal);
				const length = Math.min(FRAMESCAPER_DESKTOP_CORE_MAXIMUM_BODY_CHUNK_BYTES,
					body.byteLength - offset);
				const value = await bridge.readBodyChunk({ body, offset, length });
				if (!(value instanceof Uint8Array) || value.byteLength !== length) {
					throw new Error('Framescaper desktop baseline body read returned an inexact chunk.');
				}
				const bytes = value.slice();
				digest.update(bytes);
				semanticChunks?.push(bytes);
				if (activeWriter) await activeWriter.write(bytes, { signal });
				offset += length;
			}
			if (bytesToHex(digest.digest()) !== body.sha256) {
				throw new Error(`Framescaper desktop baseline ${body.kind} body failed its SHA-256 binding.`);
			}
			if (semanticChunks) validateSemanticBytes(reference, concatenate(semanticChunks, body.byteLength));
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
		if (cleanup.length) throw new AggregateError(
			[error, ...cleanup], 'baseline body acquisition rollback failed.', { cause: error });
		throw error;
	}
}

async function extensionDescriptor(
	reference: FramescaperDesktopExtensionBodyReference,
	store: Pick<FramescaperDesktopCoreBodyStore, 'getMediaAssetMetadata'>,
	signal?: AbortSignal,
): Promise<Readonly<FramescaperDesktopBodyDescriptor>> {
	const metadata = trustedMetadataCandidate(await store.getMediaAssetMetadata(reference.storageKey), reference.kind);
	throwIfScapeAborted(signal);
	if (metadata.size > reference.maximumBytes
		|| (reference.byteLength !== null && metadata.size !== reference.byteLength)
		|| metadata.sha256 !== reference.sha256 || metadata.mimeType !== reference.mimeType) {
		throw new Error(`Managed baseline ${reference.kind} body conflicts with project authority.`);
	}
	return Object.freeze({
		kind: reference.kind, encoding: reference.encoding,
		sourceId: reference.storageKey, storageKey: reference.storageKey,
		mimeType: reference.mimeType, byteLength: metadata.size, sha256: reference.sha256,
	});
}

function transferReference(
	descriptor: Readonly<FramescaperDesktopBodyDescriptor>,
	project: FramescaperProject,
): Readonly<TransferReference> {
	const extension = collectFramescaperDesktopExtensionBodyReferences(project)
		.find((candidate) => bodyKey(candidate) === bodyKey(descriptor)) ?? null;
	if (descriptor.kind.startsWith('framescaper-') && !extension) {
		throw new Error(`baseline desktop ${descriptor.kind} lost its project reference.`);
	}
	return Object.freeze({
		descriptor,
		name: extension?.name ?? descriptor.storageKey,
		timing: descriptor.kind === 'video-timing' ? timingByStorageKey(project).get(descriptor.storageKey) ?? null : null,
		extension,
	});
}

function timingByStorageKey(project: FramescaperProject): ReadonlyMap<string, Readonly<VideoTimingAssetReference>> {
	const result = new Map<string, Readonly<VideoTimingAssetReference>>();
	for (const value of project.sources as readonly Readonly<Record<string, unknown>>[]) {
		if (value.kind !== 'video') continue;
		if (value.timingAsset != null) addTiming(result, normalizeVideoTimingAssetReference(value.timingAsset));
		if (value.proxyAttachment != null) {
			addTiming(result, normalizeVideoProxyAttachmentV18(value.proxyAttachment).timingAsset);
		}
	}
	return result;
}

function addTiming(
	result: Map<string, Readonly<VideoTimingAssetReference>>,
	value: Readonly<VideoTimingAssetReference>,
): void {
	const prior = result.get(value.storageKey);
	if (prior && JSON.stringify(prior) !== JSON.stringify(value)) {
		throw new Error(`baseline desktop timing body ${value.storageKey} has conflicting references.`);
	}
	result.set(value.storageKey, value);
}

async function loadVerifiedBlob(
	store: Pick<FramescaperDesktopCoreBodyStore, 'loadMediaAsset'>,
	reference: Readonly<TransferReference>,
	metadata: TrustedMetadata,
	signal?: AbortSignal,
): Promise<Blob> {
	throwIfScapeAborted(signal);
	const blob = canonicalMediaContentBlob(await store.loadMediaAsset(reference.descriptor.storageKey, { signal }));
	if (blob.size !== metadata.size || await digestMediaContent(blob, { signal }) !== metadata.sha256) {
		throw new Error(`Managed baseline ${reference.descriptor.kind} body failed immutable verification.`);
	}
	if (requiresSemanticBytes(reference)) {
		validateSemanticBytes(reference, new Uint8Array(await blob.arrayBuffer()));
	}
	return blob;
}

function validateSemanticBytes(reference: Readonly<TransferReference>, bytes: Uint8Array): void {
	if (reference.timing) validateVideoTimingAssetBytes(reference.timing, bytes);
	if (reference.extension?.archiveReference) {
		validateFramescaperScapeAssetReferenceBytes(reference.extension.archiveReference, bytes);
	}
}

function requiresSemanticBytes(reference: Readonly<TransferReference>): boolean {
	return reference.timing !== null
		|| reference.extension?.archiveReference?.role === 'lut'
		|| reference.extension?.archiveReference?.role === 'motion';
}

function trustedMetadata(
	descriptor: Readonly<FramescaperDesktopBodyDescriptor>,
	value: unknown,
): TrustedMetadata {
	const metadata = trustedMetadataCandidate(value, descriptor.kind);
	if (metadata.sourceId !== descriptor.storageKey || metadata.mimeType !== descriptor.mimeType
		|| metadata.size !== descriptor.byteLength || metadata.sha256 !== descriptor.sha256
		|| (metadata.kind !== null && metadata.kind !== storageKind(descriptor.kind))
		|| (metadata.encoding !== null && metadata.encoding !== descriptor.encoding)) {
		throw new Error(`Managed baseline ${descriptor.kind} metadata conflicts with its project binding.`);
	}
	return metadata;
}

function trustedMetadataCandidate(value: unknown, kind: string): TrustedMetadata {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Managed baseline ${kind} metadata is missing.`);
	}
	const record = value as Record<string, unknown>;
	const metadata = Object.freeze({
		sourceId: String(record.sourceId ?? ''), mimeType: String(record.mimeType ?? ''),
		size: Number(record.size), sha256: String(record.sha256 ?? ''),
		kind: typeof record.kind === 'string' && record.kind ? record.kind : null,
		encoding: typeof record.encoding === 'string' && record.encoding ? record.encoding : null,
	});
	if (!metadata.sourceId || !metadata.mimeType || !Number.isSafeInteger(metadata.size) || metadata.size < 1
		|| !/^[a-f0-9]{64}$/u.test(metadata.sha256)) {
		throw new Error(`Managed baseline ${kind} metadata is incomplete.`);
	}
	return metadata;
}

function assertPublication(
	publication: OwnedMediaAssetPublication,
	body: Readonly<FramescaperDesktopBodyDescriptor>,
): void {
	if (!publication || typeof publication !== 'object' || typeof publication.discardIfCurrent !== 'function'
		|| publication.metadata.sourceId !== body.storageKey || publication.metadata.mimeType !== body.mimeType
		|| publication.metadata.size !== body.byteLength || publication.metadata.sha256 !== body.sha256) {
		throw new Error(`Managed baseline ${body.kind} publication changed its descriptor.`);
	}
}

function storageKind(kind: FramescaperDesktopBodyDescriptor['kind']): string {
	if (kind === 'framescaper-still') return 'still';
	if (kind === 'framescaper-freeze-render') return 'freeze-render';
	if (kind === 'framescaper-cube-lut') return 'cube-lut';
	if (kind === 'framescaper-motion-analysis') return 'motion-analysis';
	return kind;
}

function metadataIdentity(value: TrustedMetadata): string { return JSON.stringify(value); }
function bodyKey(value: Pick<FramescaperDesktopBodyDescriptor, 'kind' | 'storageKey'>): string {
	return JSON.stringify([value.kind, value.storageKey]);
}

function assertAggregateBytes(bodies: readonly Readonly<{ byteLength: number }>[]): void {
	let total = 0;
	for (const { byteLength } of bodies) {
		if (byteLength > SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes - total) {
			throw new RangeError('Framescaper desktop baseline bodies exceed their aggregate byte limit.');
		}
		total += byteLength;
	}
}

function concatenate(chunks: readonly Uint8Array[], byteLength: number): Uint8Array {
	const output = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
	if (offset !== byteLength) throw new Error('Framescaper desktop baseline semantic body ended early.');
	return output;
}

function acknowledgementRecord(value: unknown): Readonly<{
	bodyIndex: number; nextOffset: number; complete: boolean;
}> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper desktop baseline body acknowledgement is invalid.');
	}
	const record = value as Record<string, unknown>;
	if (Reflect.ownKeys(record).length !== 3 || !Number.isSafeInteger(record.bodyIndex)
		|| !Number.isSafeInteger(record.nextOffset) || typeof record.complete !== 'boolean') {
		throw new TypeError('Framescaper desktop baseline body acknowledgement changed shape.');
	}
	return record as unknown as Readonly<{ bodyIndex: number; nextOffset: number; complete: boolean }>;
}
