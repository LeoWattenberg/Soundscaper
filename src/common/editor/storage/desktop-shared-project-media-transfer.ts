/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateAudioEditorProjectV9,
	type AudioEditorProjectV9,
} from '../project-v9.ts';
import { collectProjectSourceIds } from '../retention.js';
import { SCAPE_ARCHIVE_LIMITS, type ScapeArchiveEntry } from '../scape-archive-envelope.ts';
import {
	createScapeDigest,
	extractScapeAudio,
	scapeAudioSourceLayout,
	scapeAudioSourceStream,
	scapeHex,
	verifyScapeExtractedAsset,
	type ScapeAudioSource,
} from '../scape-archive-media.ts';
import { throwIfScapeAborted } from '../scape-abort.ts';
import {
	ScapeAudioChunkBudget,
	ScapeExpandedByteBudget,
} from '../scape-expanded-byte-budget.ts';
import type { StorageRecord } from './media-records.ts';
import type { AudioSourceWriter } from './source-write-repository.ts';

export const DESKTOP_SHARED_AUDIO_ENCODING = 'audio-f32le-chunks-v1' as const;
export const MAXIMUM_DESKTOP_SHARED_SOURCE_CHUNK_BYTES = 4 * 1024 * 1024;

const DIGEST = /^[a-f0-9]{64}$/u;
const BINDING_ID = /^m[a-f0-9]{64}$/u;
const MAXIMUM_REACHABLE_SOURCE_COUNT = SCAPE_ARCHIVE_LIMITS.maximumEntryCount - 2;

interface ManagedAudioSource extends ScapeAudioSource, Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly kind: 'audio';
	readonly storageKey: string;
	readonly name: string;
	readonly mimeType: string;
	readonly sampleRate: number;
}

export interface DesktopSharedManagedSourceDescriptor {
	readonly bindingId: string;
	readonly byteLength: number;
	readonly encoding: typeof DESKTOP_SHARED_AUDIO_ENCODING;
	readonly kind: 'audio';
	readonly sha256: string;
	readonly sourceId: string;
	readonly storageKey: string;
}

export interface DesktopSharedSourceTransferBridge {
	beginSharedSourceWrite(declaration: Readonly<{
		byteLength: number;
		encoding: typeof DESKTOP_SHARED_AUDIO_ENCODING;
		projectId: string;
		projectRevision: number;
		sha256: string;
		sourceId: string;
	}>): Promise<Readonly<{
		status: 'present';
		source: DesktopSharedManagedSourceDescriptor;
	}> | Readonly<{
		status: 'ready';
		chunkSize: number;
		writeId: string;
	}>>;
	writeSharedSourceChunk(value: Readonly<{
		bytes: Uint8Array;
		offset: number;
		writeId: string;
	}>): Promise<Readonly<{ nextOffset: number }>>;
	finishSharedSourceWrite(value: Readonly<{
		sha256: string;
		writeId: string;
	}>): Promise<DesktopSharedManagedSourceDescriptor>;
	abortSharedSourceWrite(writeId: string): Promise<boolean>;
	readSharedSourceChunk(value: Readonly<{
		bindingId: string;
		length: number;
		offset: number;
	}>): Promise<Uint8Array>;
}

export interface DesktopSharedSourceTransferStore {
	getSourceMetadata(sourceId: string): PromiseLike<unknown> | unknown;
	readSourceChunks(
		sourceId: string,
		options?: Readonly<{ signal?: AbortSignal; migrateLegacyPcmOnAccess?: boolean }>,
	): AsyncIterable<readonly Float32Array[] | Readonly<{ channels?: readonly Float32Array[] }>>;
	beginSourceWrite(sourceId: string, metadata?: Record<string, unknown>): Promise<AudioSourceWriter>;
	discardSourceIfCurrent(source: StorageRecord): PromiseLike<boolean> | boolean;
}

export interface DesktopSharedAudioAcquisition {
	readonly trustedSourceIds: ReadonlySet<string>;
	commit(): void;
	rollback(): Promise<void>;
}

export async function prepareDesktopSharedProjectAudioHandoff(
	projectValue: unknown,
	bridgeValue: DesktopSharedSourceTransferBridge,
	store: Pick<DesktopSharedSourceTransferStore, 'readSourceChunks'>,
	options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<readonly DesktopSharedManagedSourceDescriptor[]> {
	validateAudioEditorProjectV9(projectValue);
	const project = projectValue as AudioEditorProjectV9;
	const sources = preflightSenderAudioSources(project);
	if (!sources.length) return Object.freeze([]);
	const bridge = transferBridge(bridgeValue);
	const results: DesktopSharedManagedSourceDescriptor[] = [];
	for (const source of sources) {
		throwIfScapeAborted(options.signal);
		results.push(await publishAudioSource(
			project.id,
			project.revision,
			source,
			bridge,
			store,
			options.signal,
		));
	}
	return Object.freeze(results);
}

export async function acquireDesktopSharedProjectAudio(
	projectValue: unknown,
	priorProjectValue: unknown,
	descriptorValues: readonly unknown[],
	bridgeValue: Pick<DesktopSharedSourceTransferBridge, 'readSharedSourceChunk'>,
	store: Pick<DesktopSharedSourceTransferStore, 'beginSourceWrite' | 'discardSourceIfCurrent' | 'getSourceMetadata'>,
	options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<DesktopSharedAudioAcquisition> {
	validateAudioEditorProjectV9(projectValue);
	const project = projectValue as AudioEditorProjectV9;
	const sources = reachableAudioSources(project);
	preflightAudioTransfer(sources);
	const descriptorBySourceId = indexManagedDescriptors(descriptorValues, project, sources);
	const prior = validPriorProject(priorProjectValue, project.id);
	const trustedSourceIds = new Set<string>();
	const acquiredSources: StorageRecord[] = [];
	let committed = false;
	const rollback = async (): Promise<void> => {
		if (committed) return;
		committed = true;
		const failures: unknown[] = [];
		for (let index = acquiredSources.length - 1; index >= 0; index -= 1) {
			try { await store.discardSourceIfCurrent(acquiredSources[index] as StorageRecord); }
			catch (error) { failures.push(error); }
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, 'Managed shared-source rollback failed.');
	};
	try {
		const acquiredBindings = new Map<string, string>();
		for (const source of sources) {
			throwIfScapeAborted(options.signal);
			if (priorSourceMatches(prior, source) && await store.getSourceMetadata(source.storageKey) != null) continue;
			const sourceBinding = canonicalSourceBinding(source);
			const priorStorageKey = acquiredBindings.get(sourceBinding);
			if (priorStorageKey) {
				trustedSourceIds.add(source.id);
				continue;
			}
			if (await store.getSourceMetadata(source.storageKey) != null) {
				throw new Error(`Recipient-local audio source ${source.id} conflicts with a managed shared source.`);
			}
			const descriptor = descriptorBySourceId.get(source.id);
			if (!descriptor) continue;
			const acquired = await acquireAudioSource(source, descriptor, bridgeValue, store, options.signal);
			acquiredSources.push(acquired);
			acquiredBindings.set(sourceBinding, source.storageKey);
			trustedSourceIds.add(source.id);
		}
		return Object.freeze({
			trustedSourceIds,
			commit() { committed = true; },
			rollback,
		});
	} catch (error) {
		try {
			await rollback();
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'Managed shared-source acquisition and rollback failed.');
		}
		throw error;
	}
}

async function publishAudioSource(
	projectId: string,
	projectRevision: number,
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
		projectId,
		projectRevision,
		sha256,
		sourceId: source.id,
	});
	if (admission.status === 'present') {
		const descriptor = matchingDescriptor(admission.source, source, layout.archiveBytes, sha256);
		if (await digestAudioSource(source, store, signal) !== sha256) {
			throw new Error(`Audio source ${source.id} changed while preparing its managed handoff.`);
		}
		return descriptor;
	}
	const chunkSize = positiveChunkSize(admission.chunkSize);
	let offset = 0;
	const digest = createScapeDigest();
	const stream = scapeAudioSourceStream(store, source, digest, () => undefined, signal);
	try {
		await readStream(stream, async (chunk) => {
			for (let start = 0; start < chunk.byteLength; start += chunkSize) {
				throwIfScapeAborted(signal);
				const bytes = chunk.slice(start, Math.min(chunk.byteLength, start + chunkSize));
				const result = await bridge.writeSharedSourceChunk({ bytes, offset, writeId: admission.writeId });
				if (result?.nextOffset !== offset + bytes.byteLength) {
					throw new Error('Desktop shared-source write acknowledgement is out of sequence.');
				}
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
		return matchingDescriptor(descriptor, source, layout.archiveBytes, sha256);
	} catch (error) {
		try {
			await bridge.abortSharedSourceWrite(admission.writeId);
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'Managed shared-source upload and cleanup failed.');
		}
		throw error;
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

async function acquireAudioSource(
	source: ManagedAudioSource,
	descriptor: DesktopSharedManagedSourceDescriptor,
	bridge: Pick<DesktopSharedSourceTransferBridge, 'readSharedSourceChunk'>,
	store: Pick<DesktopSharedSourceTransferStore, 'beginSourceWrite'>,
	signal?: AbortSignal,
): Promise<StorageRecord> {
	const writer = await store.beginSourceWrite(source.storageKey, {
		name: source.name,
		mimeType: source.mimeType,
		sampleRate: source.sampleRate,
		channelCount: source.channelCount,
		chunkFrames: source.chunkFrames,
	});
	try {
		const extracted = await extractScapeAudio(
			managedAudioEntry(descriptor, bridge),
			writer,
			source,
			signal,
		);
		verifyScapeExtractedAsset(
			{ entry: descriptor.bindingId, size: descriptor.byteLength, sha256: descriptor.sha256 },
			extracted.digest,
			extracted.size,
			`Managed audio source ${source.id}`,
		);
		return await writer.commit({
			sampleRate: source.sampleRate,
			channelCount: source.channelCount,
			chunkFrames: source.chunkFrames,
		}, { signal, ifAbsent: true });
	} catch (error) {
		try { await writer.abort(); } catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'Managed audio source write and cleanup failed.');
		}
		throw error;
	}
}

function managedAudioEntry(
	descriptor: DesktopSharedManagedSourceDescriptor,
	bridge: Pick<DesktopSharedSourceTransferBridge, 'readSharedSourceChunk'>,
): ScapeArchiveEntry {
	return {
		filename: descriptor.bindingId,
		directory: false,
		encrypted: false,
		compressionMethod: 0,
		compressedSize: descriptor.byteLength,
		uncompressedSize: descriptor.byteLength,
		async getData(writable, options) {
			const writer = writable.getWriter();
			let offset = 0;
			try {
				while (offset < descriptor.byteLength) {
					throwIfScapeAborted(options?.signal);
					const length = Math.min(
						MAXIMUM_DESKTOP_SHARED_SOURCE_CHUNK_BYTES,
						descriptor.byteLength - offset,
					);
					const bytes = await bridge.readSharedSourceChunk({
						bindingId: descriptor.bindingId,
						length,
						offset,
					});
					if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length) {
						throw new Error('Desktop shared-source read returned an unexpected chunk.');
					}
					await writer.write(bytes);
					offset += bytes.byteLength;
				}
				await writer.close();
			} catch (error) {
				await writer.abort(error).catch(() => undefined);
				throw error;
			}
		},
	};
}

function reachableAudioSources(project: AudioEditorProjectV9): readonly ManagedAudioSource[] {
	const sources: ManagedAudioSource[] = [];
	for (const source of reachableProjectSources(project)) {
		if (source.kind === 'audio') sources.push(source as ManagedAudioSource);
	}
	return Object.freeze(sources);
}

function preflightSenderAudioSources(project: AudioEditorProjectV9): readonly ManagedAudioSource[] {
	const sources: ManagedAudioSource[] = [];
	for (const source of reachableProjectSources(project)) {
		if (source.kind !== 'audio') {
			throw new Error(`PCM-only desktop shared handoff does not support reachable video source ${source.id}.`);
		}
		sources.push(source as ManagedAudioSource);
	}
	return preflightAudioTransfer(sources);
}

function reachableProjectSources(
	project: AudioEditorProjectV9,
): readonly Readonly<Record<string, unknown>>[] {
	const sourceIds = collectProjectSourceIds(project);
	if (sourceIds.size > MAXIMUM_REACHABLE_SOURCE_COUNT) {
		throw new RangeError('Desktop shared project source references exceed the managed handoff limit.');
	}
	const sourceById = new Map(project.sources.map((source) => [source.id, source]));
	return Object.freeze([...sourceIds].map((sourceId) => {
		const source = sourceById.get(sourceId);
		if (!source) throw new ReferenceError(`Desktop shared project source ${sourceId} is missing.`);
		return source;
	}));
}

function preflightAudioTransfer(sources: readonly ManagedAudioSource[]): readonly ManagedAudioSource[] {
	const byteBudget = new ScapeExpandedByteBudget(SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes);
	const chunkBudget = new ScapeAudioChunkBudget();
	const admittedBindings = new Set<string>();
	const admitted: ManagedAudioSource[] = [];
	for (const source of sources) {
		const binding = canonicalSourceBinding(source);
		if (admittedBindings.has(binding)) continue;
		admittedBindings.add(binding);
		const layout = scapeAudioSourceLayout(source);
		byteBudget.consume(layout.archiveBytes, source.id);
		chunkBudget.consumeMany(layout.chunkCount, source.id);
		admitted.push(source);
	}
	return Object.freeze(admitted);
}

function indexManagedDescriptors(
	values: readonly unknown[],
	project: AudioEditorProjectV9,
	sources: readonly ManagedAudioSource[],
): ReadonlyMap<string, DesktopSharedManagedSourceDescriptor> {
	if (!Array.isArray(values)) throw new TypeError('Desktop shared-source descriptors must be an array.');
	const reachable = new Set(sources.map(({ id }) => id));
	const byId = new Map<string, DesktopSharedManagedSourceDescriptor>();
	for (const value of values) {
		const descriptor = managedDescriptor(value);
		if (!reachable.has(descriptor.sourceId)) {
			throw new Error(`Managed source ${descriptor.sourceId} is not reachable from project ${project.id}.`);
		}
		const source = sources.find(({ id }) => id === descriptor.sourceId) as ManagedAudioSource;
		matchingDescriptor(descriptor, source, scapeAudioSourceLayout(source).archiveBytes, descriptor.sha256);
		if (byId.has(descriptor.sourceId)) throw new Error(`Duplicate managed source ${descriptor.sourceId}.`);
		byId.set(descriptor.sourceId, descriptor);
	}
	return byId;
}

function managedDescriptor(value: unknown): DesktopSharedManagedSourceDescriptor {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared-source descriptor must be an object.');
	}
	const record = value as Record<string, unknown>;
	if (record.kind !== 'audio' || record.encoding !== DESKTOP_SHARED_AUDIO_ENCODING
		|| typeof record.bindingId !== 'string' || !BINDING_ID.test(record.bindingId)
		|| typeof record.sha256 !== 'string' || !DIGEST.test(record.sha256)
		|| typeof record.sourceId !== 'string' || !record.sourceId
		|| typeof record.storageKey !== 'string' || !record.storageKey
		|| !Number.isSafeInteger(record.byteLength) || Number(record.byteLength) < 0) {
		throw new TypeError('Desktop shared-source descriptor is invalid.');
	}
	return Object.freeze({
		bindingId: record.bindingId,
		byteLength: record.byteLength as number,
		encoding: DESKTOP_SHARED_AUDIO_ENCODING,
		kind: 'audio',
		sha256: record.sha256,
		sourceId: record.sourceId,
		storageKey: record.storageKey,
	});
}

function matchingDescriptor(
	value: unknown,
	source: ManagedAudioSource,
	byteLength: number,
	sha256: string,
): DesktopSharedManagedSourceDescriptor {
	const descriptor = managedDescriptor(value);
	if (descriptor.sourceId !== source.id || descriptor.storageKey !== source.storageKey
		|| descriptor.byteLength !== byteLength || descriptor.sha256 !== sha256) {
		throw new Error(`Managed source descriptor does not match audio source ${source.id}.`);
	}
	return descriptor;
}

function validPriorProject(value: unknown, projectId: string): AudioEditorProjectV9 | null {
	if (value == null) return null;
	try {
		validateAudioEditorProjectV9(value);
	} catch {
		return null;
	}
	const project = value as AudioEditorProjectV9;
	return project.id === projectId ? project : null;
}

function priorSourceMatches(prior: AudioEditorProjectV9 | null, source: ManagedAudioSource): boolean {
	const candidate = prior?.sources.find(({ id }) => id === source.id);
	return Boolean(candidate && canonicalSourceBinding(candidate as ManagedAudioSource) === canonicalSourceBinding(source));
}

function canonicalSourceBinding(source: ManagedAudioSource): string {
	return JSON.stringify([
		source.storageKey,
		source.frameCount,
		source.channelCount,
		source.sampleRate,
		source.originalSampleRate,
		source.sampleFormat,
		source.chunkFrames,
	]);
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

function positiveChunkSize(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1
		|| Number(value) > MAXIMUM_DESKTOP_SHARED_SOURCE_CHUNK_BYTES) {
		throw new RangeError('Desktop shared-source chunk size is invalid.');
	}
	return Number(value);
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
