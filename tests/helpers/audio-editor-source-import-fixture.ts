/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';

import type { ImportVideoRuntime } from '../../src/common/editor/controller/source-import.ts';
import {
	VideoPreviewEncodedPayloadTooLargeError,
	VideoPreviewSourceGeometryTooLargeError,
} from '../../src/common/editor/video-preview-capture-admission.ts';

export interface VideoFile {
	readonly name: string;
	readonly type: string;
	readonly size: number;
	arrayBuffer(): Promise<ArrayBuffer>;
}

export function videoFile(name = 'movie.mp4'): VideoFile {
	return {
		name,
		type: 'video/mp4',
		size: 32,
		arrayBuffer: async () => new ArrayBuffer(8),
	};
}

export async function beginOwnedMediaAssetWriteFixture(
	sourceId: string,
	writeOptions: Readonly<{ expectedBytes: number; expectedSha256: string }>,
	state: Readonly<{
		calls: string[];
		deletedMedia: string[];
		discardAttempts: string[];
		generations: Map<string, number>;
		writeFails: boolean;
	}>,
) {
	if (state.writeFails) throw new Error('media write failed');
	let bytesWritten = 0;
	let closed = false;
	return {
		maximumChunkBytes: 4,
		get bytesWritten() { return bytesWritten; },
		async write(bytes: Uint8Array) {
			if (closed) throw new Error('media writer closed');
			bytesWritten += bytes.byteLength;
		},
		async commit() { throw new Error('Video import must retain publication ownership.'); },
		async commitOwned() {
			if (closed || bytesWritten !== writeOptions.expectedBytes) throw new Error('media write incomplete');
			closed = true;
			state.calls.push(`write-media:${sourceId}`);
			const generation = (state.generations.get(sourceId) ?? 0) + 1;
			state.generations.set(sourceId, generation);
			return {
				metadata: { sha256: writeOptions.expectedSha256, size: writeOptions.expectedBytes },
				async discardIfCurrent() {
					state.discardAttempts.push(sourceId);
					if (state.generations.get(sourceId) !== generation) return false;
					state.generations.delete(sourceId);
					state.deletedMedia.push(sourceId);
					return true;
				},
			};
		},
		async abort() { closed = true; },
	};
}

const SOURCE_IMPORT_CHUNK_FRAMES = 65_536;

function isSourceAddCommand(value: unknown): value is Readonly<{
	type: 'source/add';
	source: Record<string, unknown>;
}> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const command = value as Readonly<Record<string, unknown>>;
	return command.type === 'source/add' && Boolean(command.source)
		&& typeof command.source === 'object' && !Array.isArray(command.source);
}

export function createFixture() {
	const calls: string[] = [];
	const addedSources: Record<string, unknown>[] = [];
	const derivatives: Array<{ timestamp: number; type: string }> = [];
	const commits: Array<{ command: { commands: unknown[] }; selection: Record<string, unknown> }> = [];
	const deletedSources: string[] = [];
	const deletedMedia: string[] = [];
	const boundSnapshots: unknown[] = [];
	const releasedLocators: unknown[] = [];
	const unlinkedBindings: Array<Readonly<{
		projectId: string;
		sourceId: string;
		bindingToken: string;
	}>> = [];
	const mediaDiscardAttempts: string[] = [];
	const mediaGenerations = new Map<string, number>();
	const sourceBuffers = new Map<string, unknown>();
	const sourcePeaks = new Map<string, unknown>();
	const options = {
		decodeMode: 'native' as 'native' | 'container' | 'fallback' | 'none',
		posterFails: false,
		posterSourceAdmissionFails: false,
		thumbnailAdmissionFailure: null as number | null,
		thumbnailFailure: null as number | null,
		writeMediaFails: false,
		writerFails: false,
		activateFails: false,
		replaceMediaBeforeRollback: false,
		activationGate: null as Promise<void> | null,
		bindFails: false,
		commitFails: false,
		commitMutatesThenFails: false,
		extractorFails: false,
		preflightFails: false,
		peaksFail: false,
	};
	const canonicalAudio = {
		length: 8,
		numberOfChannels: 1,
		sampleRate: 48_000,
		channels: [Float32Array.of(0, 0.1, 0.2, 0.3, 0.4, 0.3, 0.2, 0.1)],
	};
	let project = {
		id: 'project-import-video',
		tracks: [] as Array<{ id: string; type: string; laneGroupId?: string }>,
		sources: [] as Record<string, unknown>[],
	};
	let projectGeneration = 0;
	const ids = new Map<string, number>();
	const stableId = (prefix: string) => {
		const next = (ids.get(prefix) || 0) + 1;
		ids.set(prefix, next);
		return `${prefix}-${next}`;
	};
	const extractor = {
		metadata: { durationSeconds: 2, width: 1_920, height: 1_080 },
		async capture(timestamp: number, captureOptions?: { maximumWidth?: number }) {
			// The poster is the capture that carries its own geometry bound.
			calls.push(`capture:${timestamp}:${captureOptions?.maximumWidth ? 'poster' : 'thumbnail'}`);
			if (timestamp === 0 && options.posterSourceAdmissionFails) {
				throw new VideoPreviewSourceGeometryTooLargeError(16_385, 1, 'exceeds the maximum width');
			}
			if (timestamp === options.thumbnailAdmissionFailure) {
				throw new VideoPreviewEncodedPayloadTooLargeError(2, 1);
			}
			if ((timestamp === 0 && options.posterFails) || timestamp === options.thumbnailFailure) {
				throw new Error('capture failed');
			}
			return {
				blob: new Blob([Uint8Array.of(1)], { type: 'image/webp' }),
				width: 320,
				height: 180,
				mimeType: 'image/webp',
				timestampSeconds: timestamp,
			};
		},
		dispose() { calls.push('dispose'); },
	};
	const writer = {
		async write(_channels?: readonly Float32Array[]) {
			calls.push('writer-write');
			if (options.writerFails) throw new Error('writer failed');
		},
		async commit() { calls.push('writer-commit'); },
		async abort() { calls.push('writer-abort'); },
	};
	const runtime: ImportVideoRuntime = {
		SOURCE_CHUNK_FRAMES: 65_536,
		activateVideoSource: async (source: { id: string }) => {
			calls.push(`activate:${source.id}`);
			if (options.activationGate) await options.activationGate;
			if (options.activateFails) {
				if (options.replaceMediaBeforeRollback) {
					mediaGenerations.set(source.id, (mediaGenerations.get(source.id) ?? 0) + 1);
				}
				throw new Error('activation failed');
			}
		},
		audioBufferChannels: (value: typeof canonicalAudio) => value.channels || canonicalAudio.channels,
		audioEditorVideoThumbnailTimes: () => [1, 2],
		bufferFromChannels: async () => canonicalAudio,
		cacheSourceBuffer: (sourceId: string, value: unknown) => { sourceBuffers.set(sourceId, value); },
		canonicalizeBuffer: async () => canonicalAudio,
		commit: (command: { commands: unknown[] }, selection: Record<string, unknown>) => {
			calls.push('commit');
			if (options.commitFails) throw new Error('commit failed');
			if (options.commitMutatesThenFails) {
				project = {
					...project,
					sources: [
						...project.sources,
						...command.commands.filter(isSourceAddCommand).map(({ source }) => source),
					],
				};
				throw new Error('post-commit publication failed');
			}
			commits.push({ command, selection });
		},
		copy: {
			videoAudioDecodeFailed: 'The audio from {file} could not be decoded. The video was imported without audio.',
		},
		createAddClipCommand: (trackId: string, clip: unknown) => ({ type: 'clip/add', trackId, clip }),
		createAddSourceCommand: (source: unknown) => {
			addedSources.push(source as Record<string, unknown>);
			return { type: 'source/add', source };
		},
		createAddTrackCommand: (track: unknown) => ({ type: 'track/add', track }),
		createAudioEditorVideoFrameExtractor: async () => {
			if (options.extractorFails) throw new Error('extractor failed');
			return extractor;
		},
		createStableId: stableId,
		engine: {
			getAudioContext: async () => ({}),
			decodeAudioData: async () => {
				if (options.decodeMode !== 'native') throw new Error('native decode failed');
				return {
					...canonicalAudio,
					channels: undefined,
				};
			},
		},
		decodeContainerAudio: async () => {
			calls.push('decode-container');
			if (options.decodeMode !== 'container') throw new Error('container decode failed');
			return { channels: canonicalAudio.channels, sampleRate: 48_000 };
		},
		ffmpeg: {
			decode: async () => {
				calls.push('decode-ffmpeg');
				if (options.decodeMode === 'none') throw new Error('no audio');
				return { channels: canonicalAudio.channels, sampleRate: 44_100 };
			},
		},
		findTrack: (value: typeof project, trackId: string) => value.tracks.find((track) => track.id === trackId) || null,
		fitAudioBufferToFrames: () => canonicalAudio,
		generateWaveformPeaks: async () => {
			if (options.peaksFail) throw new Error('peaks failed');
			return { levels: [] };
		},
		inspectEncodedAudioSampleRate: () => 44_100,
		normalizeImportOptions: () => ({ destination: 'timeline', trackId: null, timelineStartFrame: 0 }),
		peakCacheKey: (sourceId: string) => `peaks:${sourceId}`,
		preflightStorage: async (bytes: number) => {
			calls.push(`preflight:${bytes}`);
			if (options.preflightFails) throw new Error('preflight failed');
		},
		captureProject: () => Object.freeze({ generation: projectGeneration, projectId: project.id }),
		assertProject: (token: Readonly<{ generation: number; projectId: string }>) => {
			calls.push(`assert-project:${token.generation}`);
			if (token.generation !== projectGeneration || token.projectId !== project.id) {
				throw new Error('The project changed during video import.');
			}
		},
		getProject: () => project,
		projectSampleRate: () => 48_000,
		revokeVideoVisual: (sourceId: string) => { calls.push(`revoke:${sourceId}`); },
		sourceBuffers,
		sourcePeaks,
		store: {
			async beginMediaAssetWrite(
				sourceId: string,
				_metadata: Readonly<Record<string, unknown>>,
				writeOptions: Readonly<{ expectedBytes: number; expectedSha256: string }>,
			) {
				return beginOwnedMediaAssetWriteFixture(sourceId, writeOptions, {
					calls,
					deletedMedia,
					discardAttempts: mediaDiscardAttempts,
					generations: mediaGenerations,
					writeFails: options.writeMediaFails,
				});
			},
			async saveVideoDerivative(_sourceId: string, derivative: { timestamp: number; type: string }) {
				derivatives.push(derivative);
			},
			async saveLinkedVideoDerivative(
				_projectId: string,
				_source: unknown,
				_binding: unknown,
				derivative: { timestamp: number; type: string },
			) {
				calls.push('save-linked-derivative');
				derivatives.push(derivative);
			},
			async beginSourceWrite() { return writer; },
			async saveAnalysis() { calls.push('save-analysis'); },
			async deleteSource(sourceId: string) { deletedSources.push(sourceId); },
			async deleteMediaAsset(sourceId: string) { deletedMedia.push(sourceId); },
			async bindLinkedVideoOriginal(
				projectId: string,
				source: { id: string },
				locatorId: string,
				bindOptions: { expectedLocatorRevision: string; expectedSnapshot: unknown },
			) {
				calls.push(`bind:${projectId}:${source.id}:${locatorId}`);
				assert.equal(bindOptions.expectedLocatorRevision, 'revision_0000000000000001');
				boundSnapshots.push(bindOptions.expectedSnapshot);
				if (options.bindFails) throw new Error('binding failed');
				return Object.freeze({
					projectId,
					sourceId: source.id,
					storageKey: source.id,
					locatorId,
					locatorRevision: 'revision_0000000000000001',
					byteLength: 32,
					sha256: '1'.repeat(64),
					bindingToken: 'binding_token_0000000000001',
					boundAt: '2026-08-02T00:00:00.000Z',
				});
			},
			async unlinkLinkedVideoOriginal(projectId: string, sourceId: string, bindingToken: string) {
				unlinkedBindings.push({ projectId, sourceId, bindingToken });
				return true;
			},
			async releaseLinkedVideoOriginalLocator(reference: unknown) {
				releasedLocators.push(reference);
				return true;
			},
		},
		stripExtension: (name: string) => name.replace(/\.[^.]+$/u, ''),
		warnEnvelope: () => { calls.push('warn-envelope'); },
		// Write the buffer the caller actually handed over, in the declared chunk size.
		// Always replaying the canonical eight frames hid a real contract: imported audio
		// proves the PCM it committed matches the frame count the project records, so a
		// fitted buffer has to reach storage as the frames it claims.
		writeBuffer: async (
			target: typeof writer,
			buffer?: Readonly<{
				length?: number;
				numberOfChannels?: number;
				channels?: readonly Float32Array[];
				getChannelData?: (channel: number) => Float32Array;
			}>,
		) => {
			const read = buffer?.getChannelData;
			const channels = buffer?.channels
				?? (read
					? Array.from({ length: buffer?.numberOfChannels ?? 1 }, (_, index) => read.call(buffer, index))
					: canonicalAudio.channels);
			const frames = channels[0]?.length ?? 0;
			for (let start = 0; start < frames; start += SOURCE_IMPORT_CHUNK_FRAMES) {
				const end = Math.min(frames, start + SOURCE_IMPORT_CHUNK_FRAMES);
				await target.write(channels.map((channel) => channel.slice(start, end)));
			}
		},
	};
	return {
		addedSources,
		boundSnapshots,
		calls,
		commits,
		deletedMedia,
		deletedSources,
		derivatives,
		options,
		getProject: () => project,
		mediaDiscardAttempts,
		releasedLocators,
		replaceMediaGeneration: (sourceId: string) => {
			mediaGenerations.set(sourceId, (mediaGenerations.get(sourceId) ?? 0) + 1);
		},
		runtime,
		setProject: (value: typeof project) => { projectGeneration += 1; project = value; },
		sourceBuffers,
		sourcePeaks,
		unlinkedBindings,
	};
}
