/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import type { CommandFactoryValue } from '../../../commands/factories.ts';
import type { RationalRate } from '../../../timeline-time.ts';
import type { VideoTimingProbePort, ResolvedVideoTimingProbe } from '../../../video-timing-probe.ts';
import type { VideoSourceCharacteristics } from '../../../video-source-characteristics.ts';
import type { OwnedMediaAssetWriter } from '../../../storage/media-asset-write-contract.ts';
import type { LinkedVideoOriginalBinding } from '../../../storage/linked-video-original-binding.ts';
import type { FoundationLinkedVideoOriginalSource } from '../../../storage/linked-video-original-source.ts';
import type { VideoDerivativeInput } from '../../../storage/video-derivative-repository.ts';
import type { EditorProjectToken } from '../../shared/lifecycle.ts';
import type { AudioBufferLike } from '../../source/source-audio.ts';
import type { WaveformPeaks } from '../../source/waveform-analysis.ts';
import type {
	ImportedVideoAudioBuffer,
	ImportedVideoDecodedAudio,
} from './video-import-audio-decode.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;
type AddClipCommand = Extract<AudioEditorCommand, { readonly type: 'clip/add' }>;
type AddSourceCommand = Extract<AudioEditorCommand, { readonly type: 'source/add' }>;
type AddTrackCommand = Extract<AudioEditorCommand, { readonly type: 'track/add' }>;

export interface ImportVideoFileInput extends Blob {
	readonly name: string;
}

export type ImportVideoMedia = Blob;
export type ImportVideoDestination = 'timeline' | 'project-bin';

export interface ImportVideoOptions {
	readonly destination: ImportVideoDestination;
	readonly trackId: string | null;
	readonly trackIndex?: number;
	readonly timelineStartFrame: number;
	readonly signal?: AbortSignal;
	readonly linkedVideoLocatorId?: string;
	readonly linkedVideoLocatorRevision?: string;
}

export interface ImportVideoResult {
	readonly destination: ImportVideoDestination;
	readonly sourceId: string;
	readonly audioSourceId: string | null;
	readonly clipId: string;
	readonly audioClipId: string | null;
	readonly trackId: string | null;
	readonly notice?: string;
}

export type ImportVideoFile = (
	file: ImportVideoFileInput,
	options?: Readonly<ImportVideoOptions>,
) => Promise<Readonly<ImportVideoResult>>;

export interface ImportVideoTrack {
	readonly id: string;
	readonly type: 'audio' | 'video' | 'label';
	readonly laneGroupId?: string | null;
}

export interface ImportVideoSequence {
	readonly id: string;
	readonly rate: RationalRate;
}

export interface ImportVideoProject {
	readonly id: string;
	readonly tracks: readonly ImportVideoTrack[];
	readonly sources?: readonly Readonly<{ readonly id: string }>[];
	readonly primarySequenceId?: string;
	readonly sequences?: readonly ImportVideoSequence[];
}

export interface ImportVideoFrameCapture {
	readonly blob: Blob;
	readonly width: number;
	readonly height: number;
	readonly mimeType: string;
	readonly timestampSeconds: number;
}

export interface ImportVideoFrameExtractor {
	readonly metadata: Readonly<{
		readonly durationSeconds: number;
		readonly width: number;
		readonly height: number;
	}>;
	capture(timestampSeconds: number, options?: Readonly<{
		readonly maximumWidth?: number;
		readonly maximumHeight?: number;
		readonly alpha?: boolean;
	}>): PromiseLike<Readonly<ImportVideoFrameCapture>>;
	dispose(): void;
}

export interface ImportVideoAudioContext {
	createBuffer(channelCount: number, length: number, sampleRate: number): AudioBufferLike;
}

export interface ImportVideoAudioSourceWriter {
	readonly framesWritten?: unknown;
	write(channels: readonly Float32Array[], options?: Readonly<{ signal?: AbortSignal }>): Awaitable<unknown>;
	commit(
		metadata?: Readonly<Record<string, unknown>>,
		options?: Readonly<{ signal?: AbortSignal; ifAbsent?: boolean }>,
	): Awaitable<unknown>;
	abort(reason?: unknown): Awaitable<unknown>;
}

export interface ImportVideoCopy {
	readonly audioAnalysisFailed: string;
	readonly audioAnalysisWorkerFailed: string;
	readonly audioBufferUnsupported: string;
	readonly audacityProjectTooLong: string;
	readonly decodedAudioEmpty: string;
	readonly decodedChannelLengthsMismatch: string;
	readonly videoAudioDecodeFailed: string;
}

export interface ImportVideoSource extends FoundationLinkedVideoOriginalSource {
	readonly characteristics: VideoSourceCharacteristics;
}

export interface ImportVideoStore {
	getMediaAssetMetadata(storageKey: string): PromiseLike<Readonly<Record<string, unknown>> | null>;
	loadMediaAsset(
		storageKey: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	): PromiseLike<unknown>;
	writeMediaAsset?(
		storageKey: string,
		input: Blob,
		metadata?: Readonly<Record<string, unknown>>,
		options?: Readonly<{ signal?: AbortSignal }>,
	): PromiseLike<Readonly<Record<string, unknown>>>;
	beginMediaAssetWrite(
		storageKey: string,
		metadata: Readonly<Record<string, unknown>>,
		options: Readonly<{ expectedBytes: number; expectedSha256: string; signal?: AbortSignal }>,
	): PromiseLike<OwnedMediaAssetWriter>;
	beginSourceWrite(
		sourceId: string,
		metadata: Readonly<Record<string, unknown>>,
	): PromiseLike<ImportVideoAudioSourceWriter>;
	saveAnalysis(key: string, value: unknown): Awaitable<unknown>;
	deleteSource(sourceId: string): Awaitable<unknown>;
	saveVideoDerivative(sourceId: string, derivative: VideoDerivativeInput): Awaitable<unknown>;
	bindLinkedVideoOriginal(
		projectId: string,
		source: ImportVideoSource,
		locatorId: string,
		options: Readonly<{ expectedLocatorRevision: string | null; expectedSnapshot: ImportVideoFileInput }>,
	): PromiseLike<LinkedVideoOriginalBinding>;
	saveLinkedVideoDerivative(
		projectId: string,
		source: ImportVideoSource,
		binding: LinkedVideoOriginalBinding,
		derivative: VideoDerivativeInput,
	): Awaitable<unknown>;
	unlinkLinkedVideoOriginal(
		projectId: string,
		sourceId: string,
		expectedBindingToken: string,
	): PromiseLike<boolean>;
	releaseLinkedVideoOriginalLocator(reference: Readonly<{
		readonly locatorId: string;
		readonly locatorRevision: string;
	}>): Awaitable<boolean>;
}

export interface ImportVideoRuntime {
	readonly SOURCE_CHUNK_FRAMES: number;
	readonly copy: ImportVideoCopy;
	readonly engine: Readonly<{
		decodeAudioData(encoded: ArrayBuffer): Promise<ImportedVideoDecodedAudio>;
		getAudioContext(options: Readonly<{ resume: false }>): Promise<ImportVideoAudioContext>;
	}>;
	readonly ffmpeg: Readonly<{
		decode(
			file: Blob,
			options: Readonly<{ sampleRate: number; signal?: AbortSignal }>,
		): PromiseLike<ImportedVideoDecodedAudio>;
		probeVideoTiming?: VideoTimingProbePort['probe'];
		conformVideoToCfr?(
			file: Blob,
			options: Readonly<{ rate: RationalRate; signal?: AbortSignal }>,
		): PromiseLike<Blob>;
	}>;
	readonly helperTimingProbe?: VideoTimingProbePort | null;
	readonly store: ImportVideoStore;
	readonly sourceBuffers: Pick<Map<string, unknown>, 'delete'>;
	readonly sourcePeaks: Pick<Map<string, unknown>, 'delete' | 'set'>;
	activateVideoSource(source: ImportVideoSource): Awaitable<unknown>;
	audioBufferChannels(buffer: ImportedVideoAudioBuffer): Float32Array[];
	audioEditorVideoThumbnailTimes(durationSeconds: number): readonly number[];
	assertProject(token: EditorProjectToken): void;
	bufferFromChannels(
		channels: readonly Float32Array[],
		sampleRate: number,
		context: ImportVideoAudioContext,
		copy: ImportVideoCopy,
	): PromiseLike<AudioBufferLike>;
	cacheSourceBuffer(sourceId: string, buffer: AudioBufferLike): void;
	canonicalizeBuffer(
		buffer: AudioBufferLike,
		context: ImportVideoAudioContext,
		targetSampleRate: number,
		copy: ImportVideoCopy,
	): PromiseLike<AudioBufferLike>;
	commit(
		command: AudioEditorCommand,
		selection?: Readonly<{ selectTrackId?: string | null; selectClipId?: string | null }>,
	): unknown;
	createAddClipCommand(trackId: string, clip: CommandFactoryValue): AddClipCommand;
	createAddSourceCommand(source: CommandFactoryValue): AddSourceCommand;
	createAddTrackCommand(track: CommandFactoryValue): AddTrackCommand;
	createAudioEditorVideoFrameExtractor(file: ImportVideoMedia): Awaitable<ImportVideoFrameExtractor>;
	createStableId(prefix: string): string;
	captureProject(): EditorProjectToken;
	findTrack(project: ImportVideoProject, trackId: string): ImportVideoTrack | null;
	fitAudioBufferToFrames(
		buffer: AudioBufferLike,
		frameCount: number,
		context: ImportVideoAudioContext,
	): AudioBufferLike;
	generateWaveformPeaks(channels: Float32Array[], copy: ImportVideoCopy): Promise<WaveformPeaks>;
	inspectEncodedAudioSampleRate(encoded: ArrayBuffer): number | null;
	normalizeImportOptions(): Readonly<ImportVideoOptions>;
	peakCacheKey(sourceId: string): string;
	preflightStorage(bytes: number, category: 'import'): PromiseLike<unknown>;
	getProject(): ImportVideoProject;
	projectSampleRate(): number;
	revokeVideoVisual(sourceId: string): Awaitable<unknown>;
	stripExtension(name: string): string;
	warnEnvelope(): void;
	writeBuffer(
		writer: Pick<ImportVideoAudioSourceWriter, 'write'>,
		buffer: AudioBufferLike,
	): PromiseLike<void>;
	readonly decodeContainerAudio?: (
		file: Blob,
		options: Readonly<{ signal?: AbortSignal; durationSeconds: number }>,
	) => Promise<ImportedVideoDecodedAudio>;
}

export interface PreparedVideoImport {
	readonly startingProjectId: string;
	readonly startingProjectToken: EditorProjectToken;
	readonly sampleRate: number;
	readonly timingProbe: ResolvedVideoTimingProbe;
	readonly canonicalVideoFile: ImportVideoMedia;
	readonly conformedAtIngest: boolean;
	readonly metadataDurationFrames: number;
	readonly videoSourceId: string;
	readonly videoClipId: string;
	readonly binItemId: string;
	readonly trackName: string;
	readonly sourceName: string;
}
