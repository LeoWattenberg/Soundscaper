/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateAudioEditorProjectV9,
	type AudioEditorProjectV9,
} from '../project-v9.ts';
import { throwIfScapeAborted } from '../scape-abort.ts';
import { SCAPE_ARCHIVE_LIMITS, type ScapeArchiveEntry } from '../scape-archive-envelope.ts';
import {
	extractScapeAudio,
	scapeAudioSourceLayout,
	verifyScapeExtractedAsset,
} from '../scape-archive-media.ts';
import {
	ScapeAudioChunkBudget,
	ScapeExpandedByteBudget,
} from '../scape-expanded-byte-budget.ts';
import {
	DESKTOP_SHARED_AUDIO_ENCODING,
	DESKTOP_SHARED_VIDEO_ENCODING,
	MAXIMUM_DESKTOP_SHARED_SOURCE_CHUNK_BYTES,
	type DesktopSharedManagedAudioSourceDescriptor,
	type DesktopSharedManagedSourceDescriptor,
	type DesktopSharedManagedVideoSourceDescriptor,
	type DesktopSharedMediaAcquisition,
	type DesktopSharedSourceTransferBridge,
	type DesktopSharedSourceTransferStore,
} from './desktop-shared-project-media-contract.ts';
import {
	managedSourceBinding,
	reachableProjectSources,
	type ManagedAudioSource,
	type ManagedSource,
	type ManagedVideoSource,
} from './desktop-shared-project-media-sources.ts';
import type { OwnedMediaAssetPublication } from './media-asset-write-contract.ts';
import type { StorageRecord } from './media-records.ts';

const DIGEST = /^[a-f0-9]{64}$/u;
const AUDIO_BINDING_ID = /^m[a-f0-9]{64}$/u;
const VIDEO_BINDING_ID = /^v[a-f0-9]{64}$/u;

interface SourceGroup {
	readonly binding: string;
	descriptor: DesktopSharedManagedSourceDescriptor | null;
	readonly kind: 'audio' | 'video';
	readonly physicalKey: string;
	readonly sources: ManagedSource[];
}

type AcquiredOwnership = Readonly<{
	readonly kind: 'audio';
	readonly record: StorageRecord;
}> | Readonly<{
	readonly kind: 'video';
	readonly publication: OwnedMediaAssetPublication;
}>;

export async function acquireDesktopSharedProjectMedia(
	projectValue: unknown,
	priorProjectValue: unknown,
	descriptorValues: readonly unknown[],
	bridgeValue: Pick<DesktopSharedSourceTransferBridge, 'readSharedSourceChunk'>,
	store: DesktopSharedSourceTransferStore,
	options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<DesktopSharedMediaAcquisition> {
	validateAudioEditorProjectV9(projectValue);
	const project = projectValue as AudioEditorProjectV9;
	const groups = preflightGroups(project, descriptorValues);
	const expandedByteBudget = preflightAudioBudgets(groups);
	const prior = validPriorProject(priorProjectValue, project.id);
	const plans = await planMissingGroups(groups, prior, store, expandedByteBudget, options.signal);
	const trustedSourceIds = new Set<string>();
	const acquired: AcquiredOwnership[] = [];
	let committed = false;
	const rollback = async (): Promise<void> => {
		if (committed) return;
		committed = true;
		const failures: unknown[] = [];
		for (let index = acquired.length - 1; index >= 0; index -= 1) {
			try {
				const ownership = acquired[index] as AcquiredOwnership;
				if (ownership.kind === 'audio') await store.discardSourceIfCurrent(ownership.record);
				else await ownership.publication.discardIfCurrent();
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, 'Managed shared-source rollback failed.');
	};
	try {
		for (const group of plans) {
			throwIfScapeAborted(options.signal);
			const source = group.sources[0] as ManagedSource;
			const descriptor = requiredGroupDescriptor(group);
			if (group.kind === 'audio') {
				acquired.push(Object.freeze({
					kind: 'audio',
					record: await acquireAudioSource(
						source as ManagedAudioSource,
						descriptor as DesktopSharedManagedAudioSourceDescriptor,
						bridgeValue,
						store,
						options.signal,
					),
				}));
			} else {
				acquired.push(Object.freeze({
					kind: 'video',
					publication: await acquireVideoSource(
						source as ManagedVideoSource,
						descriptor as DesktopSharedManagedVideoSourceDescriptor,
						bridgeValue,
						store,
						options.signal,
					),
				}));
			}
			for (const candidate of group.sources) trustedSourceIds.add(candidate.id);
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

export function acquireDesktopSharedProjectAudio(
	projectValue: unknown,
	priorProjectValue: unknown,
	descriptorValues: readonly unknown[],
	bridgeValue: Pick<DesktopSharedSourceTransferBridge, 'readSharedSourceChunk'>,
	store: Pick<DesktopSharedSourceTransferStore,
		'beginSourceWrite' | 'discardSourceIfCurrent' | 'getSourceMetadata'>,
	options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<DesktopSharedMediaAcquisition> {
	return acquireDesktopSharedProjectMedia(
		projectValue,
		priorProjectValue,
		descriptorValues,
		bridgeValue,
		store as DesktopSharedSourceTransferStore,
		options,
	);
}

function preflightGroups(
	project: AudioEditorProjectV9,
	descriptorValues: readonly unknown[],
): readonly SourceGroup[] {
	if (!Array.isArray(descriptorValues)) throw new TypeError('Desktop shared-source descriptors must be an array.');
	const sources = reachableProjectSources(project);
	const sourceById = new Map(sources.map((source) => [source.id, source]));
	const groupByPhysicalKey = new Map<string, SourceGroup>();
	const groups: SourceGroup[] = [];
	for (const source of sources) {
		const physicalKey = JSON.stringify([source.kind, source.storageKey]);
		const binding = managedSourceBinding(source);
		const existing = groupByPhysicalKey.get(physicalKey);
		if (existing && existing.binding !== binding) {
			throw new Error(`Managed ${source.kind} aliases for ${source.storageKey} have conflicting geometry.`);
		}
		if (existing) existing.sources.push(source);
		else {
			const group: SourceGroup = {
				binding,
				descriptor: null,
				kind: source.kind,
				physicalKey,
				sources: [source],
			};
			groupByPhysicalKey.set(physicalKey, group);
			groups.push(group);
		}
	}
	const descriptorSourceIds = new Set<string>();
	const physicalKeyByBindingId = new Map<string, string>();
	for (const value of descriptorValues) {
		const descriptor = managedDescriptor(value);
		if (descriptorSourceIds.has(descriptor.sourceId)) {
			throw new Error(`Duplicate managed source ${descriptor.sourceId}.`);
		}
		descriptorSourceIds.add(descriptor.sourceId);
		const source = sourceById.get(descriptor.sourceId);
		if (!source) {
			throw new Error(`Managed source ${descriptor.sourceId} is not reachable from project ${project.id}.`);
		}
		if (descriptor.kind !== source.kind || descriptor.storageKey !== source.storageKey) {
			throw new Error(`Managed source descriptor does not match ${source.kind} source ${source.id}.`);
		}
		if (source.kind === 'audio'
			&& descriptor.byteLength !== scapeAudioSourceLayout(source as ManagedAudioSource).archiveBytes) {
			throw new Error(`Managed source descriptor does not match audio source ${source.id}.`);
		}
		const physicalKey = JSON.stringify([source.kind, source.storageKey]);
		const group = groupByPhysicalKey.get(physicalKey) as SourceGroup;
		const priorPhysicalKey = physicalKeyByBindingId.get(descriptor.bindingId);
		if (priorPhysicalKey && priorPhysicalKey !== physicalKey) {
			throw new Error(`Managed binding ${descriptor.bindingId} identifies incompatible sources.`);
		}
		physicalKeyByBindingId.set(descriptor.bindingId, physicalKey);
		if (group.descriptor && !samePhysicalDescriptor(group.descriptor, descriptor)) {
			throw new Error(`Managed aliases for ${source.storageKey} have inconsistent descriptors.`);
		}
		group.descriptor ??= descriptor;
	}
	return Object.freeze(groups.map((group) => Object.freeze({
		...group,
		sources: Object.freeze([...group.sources]) as unknown as ManagedSource[],
	})));
}

function preflightAudioBudgets(groups: readonly SourceGroup[]): ScapeExpandedByteBudget {
	const byteBudget = new ScapeExpandedByteBudget(SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes);
	const chunkBudget = new ScapeAudioChunkBudget();
	for (const group of groups) {
		const source = group.sources[0] as ManagedSource;
		if (group.kind !== 'audio') continue;
		const layout = scapeAudioSourceLayout(source as ManagedAudioSource);
		byteBudget.consume(layout.archiveBytes, source.id);
		chunkBudget.consumeMany(layout.chunkCount, source.id);
	}
	return byteBudget;
}

async function planMissingGroups(
	groups: readonly SourceGroup[],
	prior: AudioEditorProjectV9 | null,
	store: Pick<DesktopSharedSourceTransferStore, 'getMediaAssetMetadata' | 'getSourceMetadata'>,
	expandedByteBudget: ScapeExpandedByteBudget,
	signal?: AbortSignal,
): Promise<readonly SourceGroup[]> {
	const plans: SourceGroup[] = [];
	for (const group of groups) {
		throwIfScapeAborted(signal);
		const source = group.sources[0] as ManagedSource;
		const metadata = group.kind === 'audio'
			? await store.getSourceMetadata(source.storageKey)
			: await store.getMediaAssetMetadata(source.storageKey);
		throwIfScapeAborted(signal);
		if (metadata != null) {
			if (!priorGroupMatches(prior, group)) {
				throw new Error(`Recipient-local ${group.kind} source ${source.id} conflicts with a managed shared source.`);
			}
			if (group.kind === 'video') {
				const local = recipientVideoMetadata(source as ManagedVideoSource, metadata);
				if (group.descriptor && (local.size !== group.descriptor.byteLength
					|| local.sha256 !== group.descriptor.sha256)) {
					throw new Error(`Recipient-local video source ${source.id} does not match its managed descriptor.`);
				}
				expandedByteBudget.consume(local.size, source.id);
			}
			continue;
		}
		const descriptor = requiredGroupDescriptor(group);
		if (group.kind === 'video') expandedByteBudget.consume(descriptor.byteLength, source.id);
		plans.push(group);
	}
	return Object.freeze(plans);
}

function recipientVideoMetadata(
	source: ManagedVideoSource,
	value: unknown,
): Readonly<{ size: number; sha256: string }> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Recipient-local video source ${source.id} metadata is missing.`);
	}
	const record = value as Record<PropertyKey, unknown>;
	const sourceId = ownDataValue(record, 'sourceId');
	const mimeType = ownDataValue(record, 'mimeType');
	const size = ownDataValue(record, 'size');
	const sha256 = ownDataValue(record, 'sha256');
	if (sourceId !== source.storageKey || mimeType !== source.mimeType) {
		throw new Error(`Recipient-local video source ${source.id} metadata does not match its project binding.`);
	}
	if (!Number.isSafeInteger(size) || Number(size) < 1) {
		throw new RangeError('Recipient-local video metadata.size is invalid.');
	}
	if (typeof sha256 !== 'string' || !DIGEST.test(sha256)) {
		throw new TypeError(`Recipient-local video source ${source.id} has an invalid SHA-256.`);
	}
	return Object.freeze({ size: Number(size), sha256 });
}

function ownDataValue(record: Record<PropertyKey, unknown>, key: PropertyKey): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor || !('value' in descriptor)) {
		throw new TypeError(`Recipient-local metadata.${String(key)} must be a data property.`);
	}
	return descriptor.value;
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
		const extracted = await extractScapeAudio(managedAudioEntry(descriptor, bridge), writer, source, signal);
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

async function acquireVideoSource(
	source: ManagedVideoSource,
	descriptor: DesktopSharedManagedVideoSourceDescriptor,
	bridge: Pick<DesktopSharedSourceTransferBridge, 'readSharedSourceChunk'>,
	store: Pick<DesktopSharedSourceTransferStore, 'beginMediaAssetWrite'>,
	signal?: AbortSignal,
): Promise<OwnedMediaAssetPublication> {
	const writer = await store.beginMediaAssetWrite(
		source.storageKey,
		{ name: source.name, mimeType: source.mimeType },
		{ expectedBytes: descriptor.byteLength, expectedSha256: descriptor.sha256, signal },
	);
	let publication: OwnedMediaAssetPublication | null = null;
	try {
		const chunkSize = writerChunkSize(writer.maximumChunkBytes);
		let offset = 0;
		while (offset < descriptor.byteLength) {
			throwIfScapeAborted(signal);
			const length = Math.min(chunkSize, descriptor.byteLength - offset);
			const bytes = await bridge.readSharedSourceChunk({
				bindingId: descriptor.bindingId,
				length,
				offset,
			});
			if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length) {
				throw new Error('Desktop shared-source read returned an unexpected chunk.');
			}
			await writer.write(bytes, { signal });
			offset += bytes.byteLength;
		}
		if (offset !== descriptor.byteLength || writer.bytesWritten !== descriptor.byteLength) {
			throw new Error(`Managed video source ${source.id} emitted an unexpected byte length.`);
		}
		publication = await writer.commitOwned({ signal });
		assertVideoPublication(publication, source, descriptor);
		return publication;
	} catch (error) {
		try {
			if (publication) await publication.discardIfCurrent();
			else await writer.abort();
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'Managed video source write and cleanup failed.');
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

function managedDescriptor(value: unknown): DesktopSharedManagedSourceDescriptor {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared-source descriptor must be an object.');
	}
	const record = value as Record<string, unknown>;
	const common = typeof record.sha256 === 'string' && DIGEST.test(record.sha256)
		&& typeof record.sourceId === 'string' && Boolean(record.sourceId)
		&& typeof record.storageKey === 'string' && Boolean(record.storageKey)
		&& Number.isSafeInteger(record.byteLength)
		&& Number(record.byteLength) <= SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes;
	if (record.kind === 'audio' && record.encoding === DESKTOP_SHARED_AUDIO_ENCODING
		&& typeof record.bindingId === 'string' && AUDIO_BINDING_ID.test(record.bindingId)
		&& common && Number(record.byteLength) >= 0) {
		return freezeDescriptor(record, DESKTOP_SHARED_AUDIO_ENCODING, 'audio');
	}
	if (record.kind === 'video' && record.encoding === DESKTOP_SHARED_VIDEO_ENCODING
		&& typeof record.bindingId === 'string' && VIDEO_BINDING_ID.test(record.bindingId)
		&& common && Number(record.byteLength) >= 1) {
		return freezeDescriptor(record, DESKTOP_SHARED_VIDEO_ENCODING, 'video');
	}
	throw new TypeError('Desktop shared-source descriptor is invalid.');
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

function samePhysicalDescriptor(
	left: DesktopSharedManagedSourceDescriptor,
	right: DesktopSharedManagedSourceDescriptor,
): boolean {
	return left.kind === right.kind
		&& left.bindingId === right.bindingId
		&& left.byteLength === right.byteLength
		&& left.sha256 === right.sha256
		&& left.storageKey === right.storageKey;
}

function requiredGroupDescriptor(group: SourceGroup): DesktopSharedManagedSourceDescriptor {
	if (!group.descriptor) {
		throw new Error(`Managed ${group.kind} source ${group.sources[0]?.id ?? ''} has no shared-media descriptor.`);
	}
	return group.descriptor;
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

function priorGroupMatches(prior: AudioEditorProjectV9 | null, group: SourceGroup): boolean {
	return Boolean(prior && group.sources.every((source) => {
		const candidate = prior.sources.find(({ id }) => id === source.id) as ManagedSource | undefined;
		return candidate?.kind === source.kind && managedSourceBinding(candidate) === managedSourceBinding(source);
	}));
}

function writerChunkSize(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError('Managed video writer chunk size is invalid.');
	}
	return Math.min(Number(value), MAXIMUM_DESKTOP_SHARED_SOURCE_CHUNK_BYTES);
}

function assertVideoPublication(
	publication: OwnedMediaAssetPublication,
	source: ManagedVideoSource,
	descriptor: DesktopSharedManagedVideoSourceDescriptor,
): void {
	if (!publication || typeof publication !== 'object'
		|| typeof publication.discardIfCurrent !== 'function'
		|| !publication.metadata || typeof publication.metadata !== 'object') {
		throw new TypeError('Managed video publication is invalid.');
	}
	const metadata = publication.metadata;
	if (metadata.sourceId !== source.storageKey
		|| metadata.size !== descriptor.byteLength
		|| metadata.sha256 !== descriptor.sha256
		|| metadata.mimeType !== source.mimeType) {
		throw new Error(`Managed video source ${source.id} publication does not match its descriptor.`);
	}
}
