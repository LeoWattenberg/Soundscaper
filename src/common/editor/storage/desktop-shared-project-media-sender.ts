/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateAudioEditorProjectV10,
	type AudioEditorProjectV10,
} from '../project-v10-validation.ts';
import { throwIfScapeAborted } from '../scape-abort.ts';
import { SCAPE_ARCHIVE_LIMITS } from '../scape-archive-envelope.ts';
import {
	createScapeDigest,
	scapeAudioSourceLayout,
	scapeAudioSourceStream,
	scapeHex,
} from '../scape-archive-media.ts';
import {
	ScapeAudioChunkBudget,
	ScapeExpandedByteBudget,
} from '../scape-expanded-byte-budget.ts';
import {
	canonicalMediaContentBlob,
	digestMediaContent,
} from './media-content-digest.ts';
import {
	DESKTOP_SHARED_AUDIO_ENCODING,
	DESKTOP_SHARED_VIDEO_ENCODING,
	MAXIMUM_DESKTOP_SHARED_SOURCE_CHUNK_BYTES,
	type DesktopSharedManagedAudioSourceDescriptor,
	type DesktopSharedManagedSourceDescriptor,
	type DesktopSharedManagedVideoSourceDescriptor,
	type DesktopSharedSourceTransferBridge,
	type DesktopSharedSourceTransferStore,
} from './desktop-shared-project-media-contract.ts';
import {
	managedTimingAssetForSource,
	managedSourceBinding,
	reachableProjectSources,
	type ManagedAudioSource,
	type ManagedSource,
	type ManagedVideoSource,
} from './desktop-shared-project-media-sources.ts';
import {
	preflightDesktopSharedTimingAsset,
	publishDesktopSharedTimingAsset,
	type PreparedDesktopSharedTimingAsset,
} from './desktop-shared-project-timing-media.ts';

const DIGEST = /^[a-f0-9]{64}$/u;
const AUDIO_BINDING_ID = /^m[a-f0-9]{64}$/u;
const VIDEO_BINDING_ID = /^v[a-f0-9]{64}$/u;

type DesktopSharedMediaSenderStore = Pick<DesktopSharedSourceTransferStore, 'readSourceChunks'>
	& Partial<Pick<DesktopSharedSourceTransferStore, 'getMediaAssetMetadata' | 'loadMediaAsset'>>;

interface TrustedVideoMetadata {
	readonly committedAt: string;
	readonly mimeType: string;
	readonly path: string | null | undefined;
	readonly sha256: string;
	readonly size: number;
	readonly sourceId: string;
	readonly storage: string;
}

type PreparedSource = Readonly<{
	readonly kind: 'audio';
	readonly source: ManagedAudioSource;
}> | Readonly<{
	readonly kind: 'video';
	readonly metadata: TrustedVideoMetadata;
	readonly source: ManagedVideoSource;
}> | PreparedDesktopSharedTimingAsset;

export async function prepareDesktopSharedProjectMediaHandoff(
	projectValue: unknown,
	bridgeValue: DesktopSharedSourceTransferBridge,
	store: DesktopSharedMediaSenderStore,
	options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<readonly DesktopSharedManagedSourceDescriptor[]> {
	validateAudioEditorProjectV10(projectValue);
	const project = projectValue as AudioEditorProjectV10;
	const sources = await preflightSenderSources(project, store, options.signal);
	if (!sources.length) return Object.freeze([]);
	const bridge = transferBridge(bridgeValue);
	const results: DesktopSharedManagedSourceDescriptor[] = [];
	for (const prepared of sources) {
		throwIfScapeAborted(options.signal);
		results.push(prepared.kind === 'audio'
			? await publishAudioSource(project, prepared.source, bridge, store, options.signal)
			: prepared.kind === 'video'
				? await publishVideoSource(project, prepared, bridge, videoSenderStore(store), options.signal)
				: await publishDesktopSharedTimingAsset(
					project,
					prepared,
					bridge,
					videoSenderStore(store),
					options.signal,
				));
	}
	return Object.freeze(results);
}

export async function prepareDesktopSharedProjectAudioHandoff(
	projectValue: unknown,
	bridgeValue: DesktopSharedSourceTransferBridge,
	store: Pick<DesktopSharedSourceTransferStore, 'readSourceChunks'>,
	options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<readonly DesktopSharedManagedSourceDescriptor[]> {
	validateAudioEditorProjectV10(projectValue);
	const project = projectValue as AudioEditorProjectV10;
	for (const source of reachableProjectSources(project)) {
		if (source.kind === 'video') {
			throw new Error(`PCM-only desktop shared handoff does not support reachable video source ${source.id}.`);
		}
	}
	return prepareDesktopSharedProjectMediaHandoff(project, bridgeValue, store, options);
}

async function preflightSenderSources(
	project: AudioEditorProjectV10,
	store: DesktopSharedMediaSenderStore,
	signal?: AbortSignal,
): Promise<readonly PreparedSource[]> {
	const sources = uniquePhysicalSources(reachableProjectSources(project));
	if (sources.some(({ kind }) => kind === 'video')) videoSenderStore(store);
	const byteBudget = new ScapeExpandedByteBudget(SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes);
	const chunkBudget = new ScapeAudioChunkBudget();
	const prepared: PreparedSource[] = [];
	const timingBindingByPhysicalSource = new Map<string, string>();
	for (const source of sources) {
		throwIfScapeAborted(signal);
		if (source.kind === 'audio') {
			const layout = scapeAudioSourceLayout(source);
			byteBudget.consume(layout.archiveBytes, source.id);
			chunkBudget.consumeMany(layout.chunkCount, source.id);
			prepared.push(Object.freeze({ kind: 'audio', source }));
			continue;
		}
		const metadata = await readTrustedVideoMetadata(videoSenderStore(store), source, signal);
		byteBudget.consume(metadata.size, source.id);
		prepared.push(Object.freeze({ kind: 'video', metadata, source }));
		const timingAsset = managedTimingAssetForSource(source);
		if (timingAsset) {
			const physicalSource = JSON.stringify([timingAsset.kind, timingAsset.storageKey]);
			const binding = managedSourceBinding(timingAsset);
			const existing = timingBindingByPhysicalSource.get(physicalSource);
			if (existing && existing !== binding) {
				throw new Error(`Managed video-timing aliases for ${timingAsset.storageKey} have conflicting geometry.`);
			}
			if (existing) continue;
			timingBindingByPhysicalSource.set(physicalSource, binding);
			byteBudget.consume(timingAsset.byteLength, timingAsset.storageKey);
			prepared.push(await preflightDesktopSharedTimingAsset(
				timingAsset,
				videoSenderStore(store),
				signal,
			));
		}
	}
	return Object.freeze(prepared);
}

function uniquePhysicalSources(sources: readonly ManagedSource[]): readonly ManagedSource[] {
	const bindingByPhysicalSource = new Map<string, string>();
	const unique: ManagedSource[] = [];
	for (const source of sources) {
		const physicalSource = JSON.stringify([source.kind, source.storageKey]);
		const binding = managedSourceBinding(source);
		const existing = bindingByPhysicalSource.get(physicalSource);
		if (existing && existing !== binding) {
			throw new Error(`Managed ${source.kind} aliases for ${source.storageKey} have conflicting geometry.`);
		}
		if (existing) continue;
		bindingByPhysicalSource.set(physicalSource, binding);
		unique.push(source);
	}
	return Object.freeze(unique);
}

async function publishAudioSource(
	project: AudioEditorProjectV10,
	source: ManagedAudioSource,
	bridge: DesktopSharedSourceTransferBridge,
	store: Pick<DesktopSharedSourceTransferStore, 'readSourceChunks'>,
	signal?: AbortSignal,
): Promise<DesktopSharedManagedSourceDescriptor> {
	const layout = scapeAudioSourceLayout(source);
	const sha256 = await digestAudioSource(source, store, signal);
	const admission = await bridge.beginSharedSourceWrite({
		byteLength: layout.archiveBytes,
		encoding: DESKTOP_SHARED_AUDIO_ENCODING,
		projectId: project.id,
		projectRevision: project.revision,
		sha256,
		sourceId: source.id,
	});
	if (admission.status === 'present') {
		const descriptor = matchingAudioDescriptor(admission.source, source, layout.archiveBytes, sha256);
		if (await digestAudioSource(source, store, signal) !== sha256) {
			throw new Error(`Audio source ${source.id} changed while preparing its managed handoff.`);
		}
		return descriptor;
	}
	try {
		const chunkSize = positiveChunkSize(admission.chunkSize);
		let offset = 0;
		const digest = createScapeDigest();
		const stream = scapeAudioSourceStream(store, source, digest, () => undefined, signal);
		await readStream(stream, async (chunk) => {
			for (let start = 0; start < chunk.byteLength; start += chunkSize) {
				throwIfScapeAborted(signal);
				const bytes = chunk.slice(start, Math.min(chunk.byteLength, start + chunkSize));
				const result = await bridge.writeSharedSourceChunk({ bytes, offset, writeId: admission.writeId });
				assertWriteAcknowledgement(result, offset + bytes.byteLength);
				offset = result.nextOffset;
			}
		});
		const transferredDigest = scapeHex(digest.digest());
		if (offset !== layout.archiveBytes || transferredDigest !== sha256) {
			throw new Error(`Audio source ${source.id} changed while preparing its managed handoff.`);
		}
		const descriptor = await bridge.finishSharedSourceWrite({
			sha256: transferredDigest,
			writeId: admission.writeId,
		});
		return matchingAudioDescriptor(descriptor, source, layout.archiveBytes, sha256);
	} catch (error) {
		return abortUpload(bridge, admission.writeId, error);
	}
}

async function publishVideoSource(
	project: AudioEditorProjectV10,
	prepared: Extract<PreparedSource, { readonly kind: 'video' }>,
	bridge: DesktopSharedSourceTransferBridge,
	store: Required<Pick<DesktopSharedSourceTransferStore, 'getMediaAssetMetadata' | 'loadMediaAsset'>>,
	signal?: AbortSignal,
): Promise<DesktopSharedManagedSourceDescriptor> {
	const { metadata, source } = prepared;
	await validateVideoPass(store, source, metadata, signal);
	const admission = await bridge.beginSharedSourceWrite({
		byteLength: metadata.size,
		encoding: DESKTOP_SHARED_VIDEO_ENCODING,
		projectId: project.id,
		projectRevision: project.revision,
		sha256: metadata.sha256,
		sourceId: source.id,
	});
	if (admission.status === 'present') {
		const descriptor = matchingVideoDescriptor(admission.source, source, metadata);
		await validateVideoPass(store, source, metadata, signal);
		return descriptor;
	}
	try {
		const chunkSize = positiveChunkSize(admission.chunkSize);
		const blob = await loadVideoBlob(store, source, metadata, signal);
		const digest = createScapeDigest();
		let offset = 0;
		while (offset < metadata.size) {
			throwIfScapeAborted(signal);
			const length = Math.min(chunkSize, metadata.size - offset);
			const buffer = await blob.slice(offset, offset + length).arrayBuffer();
			throwIfScapeAborted(signal);
			if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== length) {
				throw new Error(`Video source ${source.id} emitted an unexpected byte length.`);
			}
			const bytes = new Uint8Array(buffer);
			digest.update(bytes);
			const result = await bridge.writeSharedSourceChunk({
				bytes,
				offset,
				writeId: admission.writeId,
			});
			assertWriteAcknowledgement(result, offset + bytes.byteLength);
			offset = result.nextOffset;
		}
		const transferredDigest = scapeHex(digest.digest());
		if (offset !== metadata.size || transferredDigest !== metadata.sha256) {
			throw new Error(`Video source ${source.id} changed while preparing its managed handoff.`);
		}
		await assertVideoMetadataCurrent(store, source, metadata, signal);
		const descriptor = await bridge.finishSharedSourceWrite({
			sha256: transferredDigest,
			writeId: admission.writeId,
		});
		return matchingVideoDescriptor(descriptor, source, metadata);
	} catch (error) {
		return abortUpload(bridge, admission.writeId, error);
	}
}

async function validateVideoPass(
	store: Required<Pick<DesktopSharedSourceTransferStore, 'getMediaAssetMetadata' | 'loadMediaAsset'>>,
	source: ManagedVideoSource,
	metadata: TrustedVideoMetadata,
	signal?: AbortSignal,
): Promise<void> {
	const blob = await loadVideoBlob(store, source, metadata, signal);
	const sha256 = await digestMediaContent(blob, {
		chunkBytes: MAXIMUM_DESKTOP_SHARED_SOURCE_CHUNK_BYTES,
		signal,
	});
	if (sha256 !== metadata.sha256) {
		throw new Error(`Video source ${source.id} changed while preparing its managed handoff.`);
	}
	await assertVideoMetadataCurrent(store, source, metadata, signal);
}

async function loadVideoBlob(
	store: Required<Pick<DesktopSharedSourceTransferStore, 'loadMediaAsset'>>,
	source: ManagedVideoSource,
	metadata: TrustedVideoMetadata,
	signal?: AbortSignal,
): Promise<Blob> {
	throwIfScapeAborted(signal);
	const value = await store.loadMediaAsset(source.storageKey, { signal, backfillDigest: false });
	throwIfScapeAborted(signal);
	const blob = canonicalMediaContentBlob(value);
	if (blob.size !== metadata.size) {
		throw new Error(`Video source ${source.id} changed while preparing its managed handoff.`);
	}
	return blob;
}

async function readTrustedVideoMetadata(
	store: Required<Pick<DesktopSharedSourceTransferStore, 'getMediaAssetMetadata'>>,
	source: ManagedVideoSource,
	signal?: AbortSignal,
): Promise<TrustedVideoMetadata> {
	throwIfScapeAborted(signal);
	const value = await store.getMediaAssetMetadata(source.storageKey);
	throwIfScapeAborted(signal);
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Video source ${source.id} has no trusted retained-media metadata.`);
	}
	const record = value as Record<string, unknown>;
	const sourceId = ownData(record, 'sourceId');
	const storage = ownData(record, 'storage');
	const path = ownData(record, 'path');
	const committedAt = ownData(record, 'committedAt');
	const mimeType = ownData(record, 'mimeType');
	const size = ownData(record, 'size');
	const sha256 = ownData(record, 'sha256');
	if (sourceId !== source.storageKey || typeof storage !== 'string' || !storage
		|| (path !== undefined && path !== null && typeof path !== 'string')
		|| typeof committedAt !== 'string' || !canonicalInstant(committedAt)
		|| mimeType !== source.mimeType || !Number.isSafeInteger(size) || Number(size) < 1
		|| typeof sha256 !== 'string' || !DIGEST.test(sha256)) {
		throw new Error(`Video source ${source.id} has invalid trusted retained-media metadata.`);
	}
	if (source.contentSha256 !== undefined && sha256 !== source.contentSha256) {
		throw new Error(`Video source ${source.id} does not match its source content digest.`);
	}
	return Object.freeze({
		committedAt,
		mimeType,
		path: path as string | null | undefined,
		sha256,
		size: size as number,
		sourceId,
		storage,
	});
}

async function assertVideoMetadataCurrent(
	store: Required<Pick<DesktopSharedSourceTransferStore, 'getMediaAssetMetadata'>>,
	source: ManagedVideoSource,
	expected: TrustedVideoMetadata,
	signal?: AbortSignal,
): Promise<void> {
	const current = await readTrustedVideoMetadata(store, source, signal);
	if (JSON.stringify(current) !== JSON.stringify(expected)) {
		throw new Error(`Video source ${source.id} changed while preparing its managed handoff.`);
	}
}

async function digestAudioSource(
	source: ManagedAudioSource,
	store: Pick<DesktopSharedSourceTransferStore, 'readSourceChunks'>,
	signal?: AbortSignal,
): Promise<string> {
	const digest = createScapeDigest();
	let bytes = 0;
	await readStream(
		scapeAudioSourceStream(store, source, digest, (length) => { bytes += length; }, signal),
		async () => undefined,
	);
	if (bytes !== scapeAudioSourceLayout(source).archiveBytes) {
		throw new Error(`Audio source ${source.id} emitted an unexpected canonical byte length.`);
	}
	return scapeHex(digest.digest());
}

function matchingAudioDescriptor(
	value: unknown,
	source: ManagedAudioSource,
	byteLength: number,
	sha256: string,
): DesktopSharedManagedAudioSourceDescriptor {
	const descriptor = managedAudioDescriptor(value);
	if (descriptor.sourceId !== source.id || descriptor.storageKey !== source.storageKey
		|| descriptor.byteLength !== byteLength || descriptor.sha256 !== sha256) {
		throw new Error(`Managed source descriptor does not match audio source ${source.id}.`);
	}
	return descriptor;
}

function matchingVideoDescriptor(
	value: unknown,
	source: ManagedVideoSource,
	metadata: TrustedVideoMetadata,
): DesktopSharedManagedVideoSourceDescriptor {
	const descriptor = managedVideoDescriptor(value);
	if (descriptor.sourceId !== source.id || descriptor.storageKey !== source.storageKey
		|| descriptor.byteLength !== metadata.size || descriptor.sha256 !== metadata.sha256) {
		throw new Error(`Managed source descriptor does not match video source ${source.id}.`);
	}
	return descriptor;
}

function managedAudioDescriptor(value: unknown): DesktopSharedManagedAudioSourceDescriptor {
	const record = descriptorRecord(value);
	if (record.kind !== 'audio' || record.encoding !== DESKTOP_SHARED_AUDIO_ENCODING
		|| typeof record.bindingId !== 'string' || !AUDIO_BINDING_ID.test(record.bindingId)
		|| !validCommonDescriptor(record, false)) {
		throw new TypeError('Desktop shared-source descriptor is invalid.');
	}
	return freezeDescriptor(record, DESKTOP_SHARED_AUDIO_ENCODING, 'audio');
}

function managedVideoDescriptor(value: unknown): DesktopSharedManagedVideoSourceDescriptor {
	const record = descriptorRecord(value);
	if (record.kind !== 'video' || record.encoding !== DESKTOP_SHARED_VIDEO_ENCODING
		|| typeof record.bindingId !== 'string' || !VIDEO_BINDING_ID.test(record.bindingId)
		|| !validCommonDescriptor(record, true)) {
		throw new TypeError('Desktop shared-source descriptor is invalid.');
	}
	return freezeDescriptor(record, DESKTOP_SHARED_VIDEO_ENCODING, 'video');
}

function descriptorRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared-source descriptor must be an object.');
	}
	return value as Record<string, unknown>;
}

function validCommonDescriptor(record: Record<string, unknown>, positiveBytes: boolean): boolean {
	return typeof record.sha256 === 'string' && DIGEST.test(record.sha256)
		&& typeof record.sourceId === 'string' && Boolean(record.sourceId)
		&& typeof record.storageKey === 'string' && Boolean(record.storageKey)
		&& Number.isSafeInteger(record.byteLength)
		&& Number(record.byteLength) >= (positiveBytes ? 1 : 0)
		&& Number(record.byteLength) <= SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes;
}

function freezeDescriptor<Encoding extends string, Kind extends 'audio' | 'video'>(
	record: Record<string, unknown>,
	encoding: Encoding,
	kind: Kind,
) {
	return Object.freeze({
		bindingId: record.bindingId as string,
		byteLength: record.byteLength as number,
		encoding,
		kind,
		sha256: record.sha256 as string,
		sourceId: record.sourceId as string,
		storageKey: record.storageKey as string,
	});
}

function transferBridge(value: DesktopSharedSourceTransferBridge): DesktopSharedSourceTransferBridge {
	if (!value || typeof value !== 'object') throw new TypeError('Desktop shared-source transfer bridge is required.');
	for (const method of [
		'beginSharedSourceWrite',
		'writeSharedSourceChunk',
		'finishSharedSourceWrite',
		'abortSharedSourceWrite',
		'readSharedSourceChunk',
	] as const) {
		if (typeof value[method] !== 'function') throw new TypeError(`Desktop shared-source bridge.${method} is required.`);
	}
	return value;
}

function videoSenderStore(
	value: DesktopSharedMediaSenderStore,
): Required<Pick<DesktopSharedSourceTransferStore, 'getMediaAssetMetadata' | 'loadMediaAsset'>> {
	if (typeof value.getMediaAssetMetadata !== 'function' || typeof value.loadMediaAsset !== 'function') {
		throw new TypeError('Desktop shared video handoff storage is unavailable.');
	}
	return value as Required<Pick<DesktopSharedSourceTransferStore, 'getMediaAssetMetadata' | 'loadMediaAsset'>>;
}

function positiveChunkSize(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1
		|| Number(value) > MAXIMUM_DESKTOP_SHARED_SOURCE_CHUNK_BYTES) {
		throw new RangeError('Desktop shared-source chunk size is invalid.');
	}
	return Number(value);
}

function assertWriteAcknowledgement(value: unknown, expectedOffset: number): asserts value is { nextOffset: number } {
	if (!value || typeof value !== 'object'
		|| (value as { nextOffset?: unknown }).nextOffset !== expectedOffset) {
		throw new Error('Desktop shared-source write acknowledgement is out of sequence.');
	}
}

async function abortUpload(
	bridge: DesktopSharedSourceTransferBridge,
	writeId: string,
	error: unknown,
): Promise<never> {
	try {
		await bridge.abortSharedSourceWrite(writeId);
	} catch (cleanupError) {
		throw new AggregateError([error, cleanupError], 'Managed shared-source upload and cleanup failed.');
	}
	throw error;
}

function ownData(record: Record<string, unknown>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Retained-media metadata.${key} must be an own data property.`);
	}
	return descriptor.value;
}

function canonicalInstant(value: string): boolean {
	const milliseconds = Date.parse(value);
	return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

async function readStream(
	stream: ReadableStream<Uint8Array>,
	onChunk: (chunk: Uint8Array) => Promise<void>,
): Promise<void> {
	const reader = stream.getReader();
	try {
		while (true) {
			const result = await reader.read();
			if (result.done) return;
			await onChunk(result.value);
		}
	} catch (error) {
		await reader.cancel(error).catch(() => undefined);
		throw error;
	} finally {
		reader.releaseLock();
	}
}
