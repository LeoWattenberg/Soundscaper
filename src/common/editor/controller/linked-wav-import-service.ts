/* SPDX-License-Identifier: AGPL-3.0-only */

/* eslint-disable @typescript-eslint/no-explicit-any -- This focused seam narrows the legacy import runtime without widening its public JavaScript contract. */

import { linkedAudioLocatorReferenceFromImportOptions } from './project-import-options.ts';

type LegacyPort = (...args: any[]) => any;

interface LinkedWavFile {
	readonly name?: unknown;
	readonly type?: unknown;
	readonly size?: unknown;
}

interface LinkedWavDescriptor {
	readonly frameCount: unknown;
	readonly channelCount: unknown;
	readonly sampleRate: unknown;
	readonly markers?: unknown;
}

interface LinkedWavImportStore {
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

export interface LinkedWavImportRuntime {
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
	readonly sourceBuffers: Readonly<{ delete(sourceId: string): unknown }>;
	readonly sourceChunkProviders: Readonly<{ delete(sourceId: string): unknown }>;
	readonly sourcePeaks: Readonly<{ delete(sourceId: string): unknown }>;
	readonly store: LinkedWavImportStore;
	readonly stripExtension: (name: string) => string;
	readonly warnEnvelope: LegacyPort;
}

/** Import one verified WAV as canonical Float32 PCM backed only by its local linked original. */
export function createLinkedWavImporter(runtime: LinkedWavImportRuntime) {
	const {
		SOURCE_CHUNK_FRAMES, activateStoredSource, assertProject, captureProject,
		commit, copy, createStableId, getProject, importResultWithWarnings,
		peakCacheKey, prepareImportedMediaCommand, projectSampleRate, sourceBuffers,
		sourceChunkProviders, sourcePeaks, store, stripExtension, warnEnvelope,
	} = runtime;
	const chunkFrames = positiveSafeInteger(SOURCE_CHUNK_FRAMES, 'Linked WAV chunk frames');

	return async function importLinkedWav(
		fileValue: unknown,
		descriptorValue: unknown,
		importOptions: Record<string, unknown>,
		wavMetadata: any,
	) {
		const locator = linkedAudioLocatorReferenceFromImportOptions(importOptions);
		if (!locator) throw new TypeError('A linked WAV import requires one exact audio locator.');
		let startingProjectId: string | null = null;
		let sourceId: string | null = null;
		let binding: any = null;
		let activationStarted = false;
		try {
			const file = linkedWavFile(fileValue);
			const descriptor = linkedWavDescriptor(descriptorValue);
			const startingProject = getProject();
			startingProjectId = requiredIdentity(startingProject?.id, 'Linked WAV project ID');
			const startingProjectToken = captureProject();
			sourceId = requiredIdentity(createStableId('source'), 'Linked WAV source ID');
			const clipId = requiredIdentity(createStableId('clip'), 'Linked WAV clip ID');
			const trackName = stripExtension(file.name)
				|| `${copy.track} ${startingProject.tracks.length + 1}`;
			const source = linkedAudioSource({
				chunkFrames,
				descriptor,
				file,
				sourceId,
				wavMetadata,
			});
			const prepared = prepareImportedMediaCommand(source, {
				schemaVersion: 2,
				title: trackName,
				sourceDurationFrames: descriptor.frameCount,
				id: clipId,
				sourceId,
				timelineStartFrame: 0,
				sourceStartFrame: 0,
				durationFrames: Math.max(1, Math.round(
					descriptor.frameCount * projectSampleRate() / descriptor.sampleRate,
				)),
			}, trackName, wavMetadata.importOptions, wavMetadata.projectBext,
			wavMetadataDescriptorMarkers(descriptorValue), descriptor.sampleRate,
			wavMetadata.projectIxml, wavMetadata.projectCart,
			wavMetadata.projectAdmCandidate, descriptorValue);
			const assertImportProjectCurrent = (): void => {
				try {
					assertProject(startingProjectToken);
				} catch (error) {
					throw new Error('The project changed during linked WAV import.', { cause: error });
				}
				if (getProject()?.id !== startingProjectId) {
					throw new Error('The project changed during linked WAV import.');
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
			if (!metadata) throw new Error('The linked WAV canonical source is unavailable after binding.');
			activationStarted = true;
			await activateStoredSource(source, metadata);
			assertImportProjectCurrent();
			commit(prepared.command, prepared.selection);
			try { warnEnvelope(); } catch { /* The canonical linked import is already committed. */ }
			return importResultWithWarnings(prepared.result, wavMetadata.warnings);
		} catch (error) {
			const current = getProject();
			const canonicalSourceLanded = sourceId !== null && current?.id === startingProjectId
				&& current.sources?.some((candidate) => candidate.id === sourceId);
			if (canonicalSourceLanded) throw error;
			const cleanupErrors: unknown[] = [];
			let releaseLocator = !binding;
			if (binding && startingProjectId !== null && sourceId !== null) {
				try {
					const unlinked = await store.unlinkLinkedAudioOriginal(
						startingProjectId,
						sourceId,
						requiredIdentity(binding.bindingToken, 'Linked WAV binding token'),
					);
					releaseLocator = unlinked;
					if (!unlinked) {
						cleanupErrors.push(new Error('The failed linked WAV import binding was not unlinked.'));
					}
				} catch (cleanupError) {
					releaseLocator = false;
					cleanupErrors.push(cleanupError);
				}
			}
			if (activationStarted && sourceId !== null) {
				sourceBuffers.delete(sourceId);
				sourceChunkProviders.delete(sourceId);
				sourcePeaks.delete(sourceId);
				try {
					await store.deleteAnalysis?.(peakCacheKey(sourceId));
				} catch (cleanupError) {
					cleanupErrors.push(cleanupError);
				}
			}
			if (releaseLocator) {
				try {
					if (!await store.releaseLinkedOriginalLocator({ kind: 'audio', ...locator })) {
						throw new Error('The unused linked WAV locator was not released.');
					}
				} catch (cleanupError) {
					cleanupErrors.push(cleanupError);
				}
			}
			if (cleanupErrors.length) {
				throw new AggregateError(
					[error, ...cleanupErrors],
					'Linked WAV import and rollback both failed.',
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
	wavMetadata,
}: Readonly<{
	chunkFrames: number;
	descriptor: Readonly<{ frameCount: number; channelCount: number; sampleRate: number }>;
	file: Readonly<{ name: string; mimeType: string }>;
	sourceId: string;
	wavMetadata: any;
}>): Readonly<Record<string, unknown>> {
	const extensions = {
		...(wavMetadata.sourceBext ? { bext: wavMetadata.sourceBext } : {}),
		...(wavMetadata.sourceIxml ? { ixml: wavMetadata.sourceIxml } : {}),
		...(wavMetadata.sourceCart ? { cart: wavMetadata.sourceCart } : {}),
		...(wavMetadata.sourceAdm ? { adm: wavMetadata.sourceAdm } : {}),
	};
	return Object.freeze({
		schemaVersion: 2,
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

function linkedWavFile(value: unknown): Readonly<{ name: string; mimeType: string }> {
	if (!value || typeof value !== 'object') throw new TypeError('A linked WAV file is required.');
	const candidate = value as LinkedWavFile;
	const name = requiredIdentity(candidate.name, 'Linked WAV file name');
	if (!/\.(?:rf64|wav)$/iu.test(name)) {
		throw new TypeError('Linked audio originals are limited to WAV and RF64 files.');
	}
	const mimeType = candidate.type === '' || candidate.type === undefined
		? 'audio/wav'
		: candidate.type;
	if (mimeType !== 'audio/wav' && mimeType !== 'audio/rf64') {
		throw new TypeError('Linked audio originals require audio/wav or audio/rf64 MIME identity.');
	}
	if (!Number.isSafeInteger(candidate.size) || Number(candidate.size) < 1) {
		throw new RangeError('A linked WAV file must have a positive safe byte length.');
	}
	return Object.freeze({ name, mimeType });
}

function linkedWavDescriptor(value: unknown): Readonly<{
	frameCount: number;
	channelCount: number;
	sampleRate: number;
}> {
	if (!value || typeof value !== 'object') throw new TypeError('A strict linked WAV descriptor is required.');
	const candidate = value as LinkedWavDescriptor;
	return Object.freeze({
		frameCount: positiveSafeInteger(candidate.frameCount, 'Linked WAV frame count'),
		channelCount: positiveSafeInteger(candidate.channelCount, 'Linked WAV channel count'),
		sampleRate: positiveSafeInteger(candidate.sampleRate, 'Linked WAV sample rate'),
	});
}

function wavMetadataDescriptorMarkers(value: unknown): readonly unknown[] {
	if (!value || typeof value !== 'object') return [];
	const markers = (value as LinkedWavDescriptor).markers;
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
