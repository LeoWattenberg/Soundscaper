/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateAudioEditorProjectV9,
	type AudioEditorProjectV9,
} from '../project-v9.ts';
import type { ScapeArchiveEntry } from '../scape-archive-envelope.ts';
import {
	extractScapeAudio,
	scapeAudioSourceLayout,
	verifyScapeExtractedAsset,
} from '../scape-archive-media.ts';
import { throwIfScapeAborted } from '../scape-abort.ts';
import type { StorageRecord } from './media-records.ts';
import {
	DESKTOP_SHARED_AUDIO_ENCODING,
	MAXIMUM_DESKTOP_SHARED_SOURCE_CHUNK_BYTES,
	type DesktopSharedAudioAcquisition,
	type DesktopSharedManagedAudioSourceDescriptor,
	type DesktopSharedSourceTransferBridge,
	type DesktopSharedSourceTransferStore,
} from './desktop-shared-project-media-contract.ts';
import {
	managedSourceBinding,
	preflightAudioTransfer,
	reachableAudioSources,
	type ManagedAudioSource,
} from './desktop-shared-project-media-sources.ts';

export * from './desktop-shared-project-media-contract.ts';
export { prepareDesktopSharedProjectAudioHandoff } from './desktop-shared-project-media-sender.ts';

const DIGEST = /^[a-f0-9]{64}$/u;
const BINDING_ID = /^m[a-f0-9]{64}$/u;

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
			const sourceBinding = managedSourceBinding(source);
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

async function acquireAudioSource(
	source: ManagedAudioSource,
	descriptor: DesktopSharedManagedAudioSourceDescriptor,
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
	descriptor: DesktopSharedManagedAudioSourceDescriptor,
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

function indexManagedDescriptors(
	values: readonly unknown[],
	project: AudioEditorProjectV9,
	sources: readonly ManagedAudioSource[],
): ReadonlyMap<string, DesktopSharedManagedAudioSourceDescriptor> {
	if (!Array.isArray(values)) throw new TypeError('Desktop shared-source descriptors must be an array.');
	const reachable = new Set(sources.map(({ id }) => id));
	const byId = new Map<string, DesktopSharedManagedAudioSourceDescriptor>();
	for (const value of values) {
		const descriptor = managedAudioDescriptor(value);
		if (!reachable.has(descriptor.sourceId)) {
			throw new Error(`Managed source ${descriptor.sourceId} is not reachable from project ${project.id}.`);
		}
		const source = sources.find(({ id }) => id === descriptor.sourceId) as ManagedAudioSource;
		if (descriptor.storageKey !== source.storageKey
			|| descriptor.byteLength !== scapeAudioSourceLayout(source).archiveBytes) {
			throw new Error(`Managed source descriptor does not match audio source ${source.id}.`);
		}
		if (byId.has(descriptor.sourceId)) throw new Error(`Duplicate managed source ${descriptor.sourceId}.`);
		byId.set(descriptor.sourceId, descriptor);
	}
	return byId;
}

function managedAudioDescriptor(value: unknown): DesktopSharedManagedAudioSourceDescriptor {
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
	return Boolean(candidate && managedSourceBinding(candidate as ManagedAudioSource) === managedSourceBinding(source));
}
