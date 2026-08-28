/* SPDX-License-Identifier: AGPL-3.0-only */

/* eslint-disable @typescript-eslint/no-explicit-any -- This focused seam narrows the legacy import runtime without widening its public JavaScript contract. */

import { linkedAudioLocatorReferenceFromImportOptions } from './project-import-options.ts';
import { scaleSampleFrame } from '../timeline-time.ts';
import { admitAudioImportChannelCount } from './audio-import-channel-admission.ts';

type LegacyPort = (...args: any[]) => any;

interface LinkedPcmFile {
	readonly name?: unknown;
	readonly type?: unknown;
	readonly size?: unknown;
}

interface LinkedPcmDescriptor {
	readonly frameCount: unknown;
	readonly channelCount: unknown;
	readonly sampleRate: unknown;
	readonly markers?: unknown;
}

interface LinkedPcmImportStore {
	bindLinkedAudioOriginal(
		projectId: string,
		source: Readonly<Record<string, unknown>>,
		locatorId: string,
		options: Readonly<{ expectedLocatorRevision: string; expectedSnapshot: unknown }>,
	): Promise<any>;
	deleteAnalysis?(key: string): Promise<unknown>;
	getSourceMetadata(storageKey: string): Promise<any>;
	releaseLinkedOriginalLocator(reference: Readonly<{
		kind: 'audio';
		locatorId: string;
		locatorRevision: string;
	}>): Promise<boolean>;
	unlinkLinkedAudioOriginal(
		projectId: string,
		sourceId: string,
		expectedBindingToken: string,
	): Promise<boolean>;
}

export interface LinkedPcmImportRuntime {
	readonly SOURCE_CHUNK_FRAMES: number;
	readonly activateStoredSource: LegacyPort;
	readonly assertProject: LegacyPort;
	readonly captureProject: LegacyPort;
	readonly commit: LegacyPort;
	readonly copy: Readonly<{ track: string }>;
	readonly createStableId: (prefix: string) => string;
	readonly getProject: () => Readonly<{
		readonly id: string;
		readonly tracks: readonly unknown[];
		readonly sources?: readonly Readonly<{ readonly id?: unknown }>[];
	}>;
	readonly importResultWithWarnings: LegacyPort;
	readonly peakCacheKey: (sourceId: string) => string;
	readonly prepareImportedMediaCommand: LegacyPort;
	readonly projectSampleRate: () => number;
	readonly retireSourceChunkProvider: (sourceId: string) => PromiseLike<void> | void;
	readonly sourceBuffers: Readonly<{ delete(sourceId: string): unknown }>;
	readonly sourcePeaks: Readonly<{ delete(sourceId: string): unknown }>;
	readonly store: LinkedPcmImportStore;
	readonly stripExtension: (name: string) => string;
	readonly warnEnvelope: LegacyPort;
}

/** Import one verified PCM container backed only by its local linked original. */
export function createLinkedPcmImporter(runtime: LinkedPcmImportRuntime) {
	const {
		SOURCE_CHUNK_FRAMES, activateStoredSource, assertProject, captureProject,
		commit, copy, createStableId, getProject, importResultWithWarnings,
		peakCacheKey, prepareImportedMediaCommand, projectSampleRate, sourceBuffers,
		retireSourceChunkProvider, sourcePeaks, store, stripExtension, warnEnvelope,
	} = runtime;

	return async function importLinkedPcm(
		fileValue: unknown,
		descriptorValue: unknown,
		importOptions: Record<string, unknown>,
		pcmMetadata: any,
	) {
		const chunkFrames = positiveSafeInteger(SOURCE_CHUNK_FRAMES, 'Linked PCM chunk frames');
		const locator = linkedAudioLocatorReferenceFromImportOptions(importOptions);
		if (!locator) throw new TypeError('A linked PCM import requires one exact audio locator.');
		let startingProjectId: string | null = null;
		let sourceId: string | null = null;
		let binding: any = null;
		let activationStarted = false;
		try {
			const file = linkedPcmFile(fileValue);
			const descriptor = linkedPcmDescriptor(descriptorValue);
			const startingProject = getProject();
			startingProjectId = requiredIdentity(startingProject?.id, 'Linked PCM project ID');
			const startingProjectToken = captureProject();
			sourceId = requiredIdentity(createStableId('source'), 'Linked PCM source ID');
			const clipId = requiredIdentity(createStableId('clip'), 'Linked PCM clip ID');
			const trackName = stripExtension(file.name)
				|| `${copy.track} ${startingProject.tracks.length + 1}`;
			const source = linkedAudioSource({
				chunkFrames,
				descriptor,
				file,
				sourceId,
				pcmMetadata,
			});
			const prepared = prepareImportedMediaCommand(source, {
				title: trackName,
				sourceDurationFrames: descriptor.frameCount,
				id: clipId,
				sourceId,
				timelineStartFrame: 0,
				sourceStartFrame: 0,
				durationFrames: Math.max(1, scaleSampleFrame(
					descriptor.frameCount, descriptor.sampleRate, projectSampleRate(), 'point',
				)),
			}, trackName, pcmMetadata.importOptions, pcmMetadata.projectBext,
			pcmMetadataDescriptorMarkers(descriptorValue), descriptor.sampleRate,
			pcmMetadata.projectIxml, pcmMetadata.projectCart,
			pcmMetadata.projectAdmCandidate, descriptorValue);
			const assertImportProjectCurrent = (): void => {
				try {
					assertProject(startingProjectToken);
				} catch (error) {
					throw new Error('The project changed during linked PCM import.', { cause: error });
				}
				if (getProject()?.id !== startingProjectId) {
					throw new Error('The project changed during linked PCM import.');
				}
			};
			assertImportProjectCurrent();
			binding = await store.bindLinkedAudioOriginal(
				startingProjectId,
				source,
				locator.locatorId,
				{
					expectedLocatorRevision: locator.locatorRevision,
					expectedSnapshot: fileValue,
				},
			);
			const metadata = await store.getSourceMetadata(source.storageKey as string);
			if (!metadata) throw new Error('The linked PCM canonical source is unavailable after binding.');
			activationStarted = true;
			await activateStoredSource(source, metadata);
			assertImportProjectCurrent();
			commit(prepared.command, prepared.selection);
			try { warnEnvelope(); } catch { /* The canonical linked import is already committed. */ }
			return importResultWithWarnings(prepared.result, pcmMetadata.warnings);
		} catch (error) {
			const current = getProject();
			const canonicalSourceLanded = sourceId !== null && current?.id === startingProjectId
				&& current.sources?.some((candidate) => candidate.id === sourceId);
			if (canonicalSourceLanded) throw error;
			const cleanupErrors: unknown[] = [];
			let providerRetired = true;
			if (activationStarted && sourceId !== null) {
				try { await retireSourceChunkProvider(sourceId); }
				catch (cleanupError) {
					providerRetired = false;
					cleanupErrors.push(cleanupError);
				}
			}
			let releaseLocator = !binding;
			if (providerRetired && binding && startingProjectId !== null && sourceId !== null) {
				try {
					const unlinked = await store.unlinkLinkedAudioOriginal(
						startingProjectId,
						sourceId,
						requiredIdentity(binding.bindingToken, 'Linked PCM binding token'),
					);
					releaseLocator = unlinked;
					if (!unlinked) {
						cleanupErrors.push(new Error('The failed linked PCM import binding was not unlinked.'));
					}
				} catch (cleanupError) {
					releaseLocator = false;
					cleanupErrors.push(cleanupError);
				}
			}
			if (providerRetired && activationStarted && sourceId !== null) {
				try { sourceBuffers.delete(sourceId); }
				catch (cleanupError) { cleanupErrors.push(cleanupError); }
				try { sourcePeaks.delete(sourceId); }
				catch (cleanupError) { cleanupErrors.push(cleanupError); }
				try { await store.deleteAnalysis?.(peakCacheKey(sourceId)); }
				catch (cleanupError) { cleanupErrors.push(cleanupError); }
			}
			if (providerRetired && releaseLocator) {
				try {
					if (!await store.releaseLinkedOriginalLocator({ kind: 'audio', ...locator })) {
						throw new Error('The unused linked PCM locator was not released.');
					}
				} catch (cleanupError) {
					cleanupErrors.push(cleanupError);
				}
			}
			if (cleanupErrors.length) {
				throw new AggregateError(
					[error, ...cleanupErrors],
					'Linked PCM import and rollback both failed.',
					{ cause: error },
				);
			}
			throw error;
		}
	};
}

function linkedAudioSource({
	chunkFrames,
	descriptor,
	file,
	sourceId,
	pcmMetadata,
}: Readonly<{
	chunkFrames: number;
	descriptor: Readonly<{ frameCount: number; channelCount: number; sampleRate: number }>;
	file: Readonly<{ name: string; mimeType: string }>;
	sourceId: string;
	pcmMetadata: any;
}>): Readonly<Record<string, unknown>> {
	const extensions = {
		...(pcmMetadata.sourceBext ? { bext: pcmMetadata.sourceBext } : {}),
		...(pcmMetadata.sourceIxml ? { ixml: pcmMetadata.sourceIxml } : {}),
		...(pcmMetadata.sourceCart ? { cart: pcmMetadata.sourceCart } : {}),
		...(pcmMetadata.sourceAdm ? { adm: pcmMetadata.sourceAdm } : {}),
	};
	return Object.freeze({
		kind: 'audio',
		sampleFormat: 'float32',
		chunkFrames,
		id: sourceId,
		storageKey: sourceId,
		name: file.name,
		mimeType: file.mimeType,
		frameCount: descriptor.frameCount,
		channelCount: descriptor.channelCount,
		sampleRate: descriptor.sampleRate,
		originalSampleRate: descriptor.sampleRate,
		...(Object.keys(extensions).length ? { opaqueExtensions: extensions } : {}),
	});
}

function linkedPcmFile(value: unknown): Readonly<{ name: string; mimeType: string }> {
	if (!value || typeof value !== 'object') throw new TypeError('A linked PCM file is required.');
	const candidate = value as LinkedPcmFile;
	const name = requiredIdentity(candidate.name, 'Linked PCM file name');
	const lowerName = name.toLowerCase();
	const fallbackMimeType = lowerName.endsWith('.aif') || lowerName.endsWith('.aiff')
		? 'audio/aiff'
		: lowerName.endsWith('.rf64') ? 'audio/rf64' : 'audio/wav';
	const mimeType = candidate.type === '' || candidate.type === undefined
		? fallbackMimeType
		: candidate.type;
	if (!((/\.(?:aif|aiff)$/iu.test(name) && mimeType === 'audio/aiff')
		|| (/\.rf64$/iu.test(name) && mimeType === 'audio/rf64')
		|| (/\.wav$/iu.test(name) && mimeType === 'audio/wav'))) {
		throw new TypeError('Linked audio originals require canonical AIFF, WAV, or RF64 file identity.');
	}
	if (!Number.isSafeInteger(candidate.size) || Number(candidate.size) < 1) {
		throw new RangeError('A linked PCM file must have a positive safe byte length.');
	}
	return Object.freeze({ name, mimeType });
}

function linkedPcmDescriptor(value: unknown): Readonly<{
	frameCount: number;
	channelCount: number;
	sampleRate: number;
}> {
	if (!value || typeof value !== 'object') throw new TypeError('A strict linked PCM descriptor is required.');
	const candidate = value as LinkedPcmDescriptor;
	return Object.freeze({
		frameCount: positiveSafeInteger(candidate.frameCount, 'Linked PCM frame count'),
		channelCount: admitAudioImportChannelCount(candidate.channelCount),
		sampleRate: positiveSafeInteger(candidate.sampleRate, 'Linked PCM sample rate'),
	});
}

function pcmMetadataDescriptorMarkers(value: unknown): readonly unknown[] {
	if (!value || typeof value !== 'object') return [];
	const markers = (value as LinkedPcmDescriptor).markers;
	return Array.isArray(markers) ? markers : [];
}

function positiveSafeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${label} must be a positive safe integer.`);
	}
	return Number(value);
}

function requiredIdentity(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value || value !== value.trim()) {
		throw new TypeError(`${label} must be a non-empty canonical string.`);
	}
	return value;
}
