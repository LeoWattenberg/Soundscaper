/* SPDX-License-Identifier: AGPL-3.0-only */

/* eslint-disable @typescript-eslint/no-explicit-any -- This focused seam narrows legacy project-import ports without changing their public JavaScript contract. */

import { scaleSampleFrame } from '../timeline-time.ts';
import { admitAudioImportChannelCount } from './audio-import-channel-admission.ts';
import {
	createImportedAudioContentIdentityWriter,
	rollbackImportedAudioContentIdentityWriter,
	type ImportedAudioContentIdentity,
} from './imported-audio-content-identity.ts';

type LegacyPort = (...args: any[]) => any;

export interface IncrementalPcmImportRuntime {
	readonly SOURCE_CHUNK_FRAMES: number;
	readonly activateStoredSource: LegacyPort;
	readonly commit: LegacyPort;
	readonly copy: Readonly<{ track: string }>;
	readonly createStableId: (prefix: string) => string;
	readonly getProject: () => Readonly<{ tracks: readonly unknown[] }>;
	readonly importResultWithWarnings: LegacyPort;
	readonly preflightStorage: LegacyPort;
	readonly prepareImportedMediaCommand: LegacyPort;
	readonly projectSampleRate: () => number;
	readonly reportProgress: (value: number) => void;
	readonly retireSourceChunkProvider: (sourceId: string) => PromiseLike<void> | void;
	readonly sourceBuffers: Readonly<{ delete(sourceId: string): unknown }>;
	readonly sourcePcmBytes: (source: unknown) => number;
	readonly sourcePeaks: Readonly<{ delete(sourceId: string): unknown }>;
	readonly store: Readonly<{
		beginSourceWrite(sourceId: string, metadata: Record<string, unknown>): Promise<any>;
		deleteSource(sourceId: string): Promise<unknown>;
	}>;
	readonly streamAiffBlobPcm?: LegacyPort;
	readonly streamWavBlobPcm: LegacyPort;
	readonly stripExtension: (name: string) => string;
	readonly warnEnvelope: LegacyPort;
}

export type IncrementalWavImportRuntime = IncrementalPcmImportRuntime;

interface IncrementalPcmImportOwnership {
	readonly assertCurrent?: () => void;
}

export function createIncrementalPcmImporter(runtime: IncrementalPcmImportRuntime) {
	const {
		SOURCE_CHUNK_FRAMES, activateStoredSource, commit, copy, createStableId,
		getProject, importResultWithWarnings, preflightStorage,
		prepareImportedMediaCommand, projectSampleRate, reportProgress, sourceBuffers,
		retireSourceChunkProvider, sourcePcmBytes, sourcePeaks, store,
		streamAiffBlobPcm, streamWavBlobPcm,
		stripExtension, warnEnvelope,
	} = runtime;

	return async function importIncrementalPcm(
		file: any,
		descriptor: any,
		importOptions: any,
		wavMetadata: any,
		activationOptions: Readonly<{ requireChunkStream?: boolean }> = {},
		ownership: IncrementalPcmImportOwnership = {},
	) {
		const assertCurrent = ownership.assertCurrent ?? (() => undefined);
		assertCurrent();
		admitAudioImportChannelCount(descriptor?.channelCount);
		const pcmBytes = sourcePcmBytes(descriptor);
		await preflightStorage(pcmBytes, 'import');
		assertCurrent();
		const sourceId = createStableId('source');
		const clipId = createStableId('clip');
		const trackName = stripExtension(file.name) || `${copy.track} ${getProject().tracks.length + 1}`;
		const sourceName = file.name;
		const mimeType = descriptor.container === 'aiff' || descriptor.container === 'aifc'
			? 'audio/aiff'
			: file.type || 'audio/wav';
		const writer = createImportedAudioContentIdentityWriter(await store.beginSourceWrite(sourceId, {
			name: sourceName,
			mimeType,
			sampleRate: descriptor.sampleRate,
			channelCount: descriptor.channelCount,
			chunkFrames: SOURCE_CHUNK_FRAMES,
		}), SOURCE_CHUNK_FRAMES);
		let metadata;
		let contentIdentity: ImportedAudioContentIdentity;
		let streamedFrames = 0;
		let importedResult: any;
		try {
			assertCurrent();
			const streamPcm = descriptor.container === 'aiff' || descriptor.container === 'aifc'
				? streamAiffBlobPcm
				: streamWavBlobPcm;
			if (typeof streamPcm !== 'function') throw new Error('The maintained PCM stream reader is unavailable.');
			await streamPcm(file, {
				descriptor,
				chunkFrames: SOURCE_CHUNK_FRAMES,
				onChunk: async (channels: Float32Array[]) => {
					assertCurrent();
					streamedFrames += channels[0]?.length || 0;
					reportProgress(streamedFrames / Math.max(1, descriptor.frameCount));
					await writer.write(channels);
					assertCurrent();
				},
			});
			assertCurrent();
			metadata = await writer.commit({
				sampleRate: descriptor.sampleRate,
				channelCount: descriptor.channelCount,
				chunkFrames: SOURCE_CHUNK_FRAMES,
			});
			assertCurrent();
			contentIdentity = writer.contentIdentity(descriptor.frameCount);
		} catch (error) {
			return rollbackImportedAudioContentIdentityWriter(
				writer, () => store.deleteSource(sourceId), error,
			);
		}

		try {
			assertCurrent();
			const source = {
				sampleFormat: 'float32',
				chunkFrames: SOURCE_CHUNK_FRAMES,
				id: sourceId,
				storageKey: sourceId,
				name: sourceName,
				mimeType,
				frameCount: descriptor.frameCount,
				channelCount: descriptor.channelCount,
				sampleRate: descriptor.sampleRate,
				originalSampleRate: descriptor.sampleRate,
				contentSha256: contentIdentity.contentSha256,
				byteLength: contentIdentity.byteLength,
				...((wavMetadata.sourceBext || wavMetadata.sourceIxml || wavMetadata.sourceCart || wavMetadata.sourceAdm) ? { opaqueExtensions: {
					...(wavMetadata.sourceBext ? { bext: wavMetadata.sourceBext } : {}),
					...(wavMetadata.sourceIxml ? { ixml: wavMetadata.sourceIxml } : {}),
					...(wavMetadata.sourceCart ? { cart: wavMetadata.sourceCart } : {}),
					...(wavMetadata.sourceAdm ? { adm: wavMetadata.sourceAdm } : {}),
				} } : {}),
			};
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
			}, trackName, importOptions, wavMetadata.projectBext, descriptor.markers || [],
			descriptor.sampleRate, wavMetadata.projectIxml, wavMetadata.projectCart,
			wavMetadata.projectAdmCandidate, descriptor);
			await activateStoredSource(source, metadata, activationOptions);
			assertCurrent();
			commit(prepared.command, prepared.selection);
			importedResult = prepared.result;
		} catch (error) {
			const cleanupErrors: unknown[] = [];
			let providerRetired = true;
			try { await retireSourceChunkProvider(sourceId); }
			catch (cleanupError) {
				providerRetired = false;
				cleanupErrors.push(cleanupError);
			}
			if (providerRetired) {
				try { sourceBuffers.delete(sourceId); }
				catch (cleanupError) { cleanupErrors.push(cleanupError); }
				try { sourcePeaks.delete(sourceId); }
				catch (cleanupError) { cleanupErrors.push(cleanupError); }
				try { await store.deleteSource(sourceId); }
				catch (cleanupError) { cleanupErrors.push(cleanupError); }
			}
			if (cleanupErrors.length) {
				throw new AggregateError(
					[error, ...cleanupErrors],
					'Incremental PCM import and rollback both failed.',
					{ cause: error },
				);
			}
			throw error;
		}
		warnEnvelope();
		return importResultWithWarnings(importedResult, wavMetadata.warnings);
	};
}

/** Compatibility export retained for existing WAV-only call sites. */
export const createIncrementalWavImporter = createIncrementalPcmImporter;
