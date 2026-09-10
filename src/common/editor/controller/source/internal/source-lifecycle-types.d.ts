/* SPDX-License-Identifier: AGPL-3.0-only */

import type { WaveformPcmRange } from '../waveform-analysis.ts';
import type { SourceChunkProviderRegistryPort } from './source-chunk-provider-registration.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

/** Buffer fields the lifecycle may inspect before a product chooses its exact buffer type. */
export interface SourceLifecycleAudioBuffer {
	readonly byteLength?: number;
	readonly length?: number;
	readonly numberOfChannels?: number;
	readonly sampleRate?: number;
	getChannelData?(channel: number): Float32Array;
}

/** Source identity and PCM geometry shared by persisted and visual-only sources. */
export interface SourceLifecycleSource {
	readonly id: string;
	readonly kind?: string;
	readonly name?: string;
	readonly storageKey?: string;
	readonly frameCount?: number;
	readonly channelCount?: number;
	readonly sampleRate?: number;
	readonly chunkFrames?: number;
}

/** Timeline fields needed to find a source and map waveform windows. */
export interface SourceLifecycleClip {
	readonly id: string;
	readonly sourceId: string;
	readonly kind?: string;
	readonly timelineStartFrame?: number;
	readonly sourceStartFrame?: number;
	readonly sourceDurationFrames?: number;
	readonly durationFrames?: number;
	readonly reversed?: boolean;
	readonly warpMap?: unknown;
}

/** Closed project projection consumed by source loading and waveform requests. */
export interface SourceLifecycleProject {
	readonly id: string;
	readonly sources: readonly SourceLifecycleSource[];
	readonly clips: readonly SourceLifecycleClip[];
	readonly projectBin?: Readonly<{ readonly clips?: readonly SourceLifecycleClip[] }>;
	readonly sampleRate?: number;
	readonly tempoMap?: unknown;
}

/** Stored geometry consulted before a source reader or provider is activated. */
export interface SourceLifecycleMetadata {
	readonly id?: unknown;
	readonly frameCount?: unknown;
	readonly frameLength?: unknown;
	readonly channelCount?: unknown;
	readonly sampleRate?: unknown;
	readonly chunkFrames?: unknown;
	readonly chunkCount?: unknown;
}

/** Copy used by the worker-backed waveform analyzers. */
export interface SourceLifecycleCopy {
	readonly audioAnalysisWorkerFailed?: string;
	readonly audioAnalysisFailed?: string;
}

export interface SourceLifecycleState {
	readonly missingSourceIds: Set<string>;
}

export interface SourceLifecycleBufferCache<Buffer> extends Iterable<readonly [string, Buffer]> {
	has(sourceId: string): boolean;
	get(sourceId: string): Buffer | undefined;
	delete(sourceId: string): boolean;
	setIfFits(sourceId: string, buffer: Buffer): boolean;
}

export interface SourceLifecycleStore<Peaks = unknown, Metadata = unknown> {
	readonly getSourceMetadata: (sourceId: string) => Awaitable<Metadata | null | undefined>;
	readonly loadAnalysis: (key: string) => Awaitable<Peaks | null | undefined>;
	readonly saveAnalysis: (key: string, value: Peaks) => Awaitable<unknown>;
	readonly deleteAnalysis?: (key: string) => Awaitable<unknown>;
	readonly readSourceChunk?: unknown;
}

export interface SourceLifecycleEngine<Provider = unknown> {
	readonly getAudioContext?: (options?: Readonly<{ resume?: boolean }>) => Awaitable<unknown>;
	readonly setChunkSources?: (providers: ReadonlyMap<string, Provider>) => unknown;
}

export interface SourceLifecycleWaveformPcmWindow extends WaveformPcmRange {
	readonly clipId: string;
	readonly sourceId: string;
	readonly channels: readonly Float32Array[];
}

export interface SourceLifecycleWaveformPcmRequest extends WaveformPcmRange {
	readonly sourceId: string;
	readonly promise: Promise<SourceLifecycleWaveformPcmWindow | null>;
}

export interface SourceLifecycleLoadOptions {
	readonly excludedAudioSourceIds?: readonly string[];
	readonly onlyRequiredAudioSources?: boolean;
	readonly requiredAudioSourceIds?: readonly string[];
	readonly requiredVideoSourceIds?: readonly string[];
	readonly signal?: AbortSignal;
}

export interface ActivateStoredSourceOptions<Buffer> {
	readonly buffer?: Buffer | null;
	readonly requireChunkStream?: boolean;
}

/** Closed, generic ports for stored-source loading and runtime cache ownership. */
export interface SourceLifecycleServiceRuntime<
	Buffer = unknown,
	Project extends SourceLifecycleProject = SourceLifecycleProject,
	Provider = unknown,
	Peaks = unknown,
	Metadata = unknown,
> {
	readonly MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES: number;
	readonly MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES: number;
	readonly SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: number;
	readonly activateVideoSource: (source: SourceLifecycleSource, options?: Readonly<{ signal?: AbortSignal }>) => Awaitable<unknown>;
	readonly allProjectClips: (project: Project) => readonly SourceLifecycleClip[];
	readonly audioBufferChannels: (buffer: Buffer) => readonly Float32Array[];
	readonly clipSourceWindowRange: (
		clip: SourceLifecycleClip,
		startFrame: number,
		endFrame: number,
		sourceFrameCount: number,
	) => WaveformPcmRange;
	readonly clipWaveformPcmRequests: Map<string, SourceLifecycleWaveformPcmRequest>;
	readonly clipWaveformPcmWindows: Map<string, SourceLifecycleWaveformPcmWindow>;
	readonly copy: SourceLifecycleCopy;
	readonly createStoredChunkProviderCandidate: (
		source: SourceLifecycleSource,
		metadata: Metadata | null | undefined,
	) => Provider | null;
	readonly engine: SourceLifecycleEngine<Provider>;
	readonly findClip: (project: Project, clipId: string) => SourceLifecycleClip | null | undefined;
	readonly findSource: (project: Project, sourceId: string) => SourceLifecycleSource | null | undefined;
	readonly generateStoredWaveformPeaks: (
		store: SourceLifecycleStore<Peaks, Metadata>,
		source: SourceLifecycleSource,
		copy: SourceLifecycleCopy,
	) => Awaitable<Peaks>;
	readonly generateWaveformPeaks: (channels: readonly Float32Array[], copy: SourceLifecycleCopy) => Awaitable<Peaks>;
	readonly getProject: () => Project | null;
	readonly legacyPeakCacheKey: (sourceId: string) => string;
	readonly peakCacheKey: (sourceId: string) => string;
	readonly publishDocumentSnapshot: () => void;
	readonly readStoredAudioBuffer: (
		store: SourceLifecycleStore<Peaks, Metadata>,
		source: SourceLifecycleSource,
		context: unknown,
	) => Awaitable<Buffer | null>;
	readonly readWaveformPcmWindow: (provider: Provider, range: WaveformPcmRange) => Awaitable<readonly Float32Array[]>;
	readonly setStatus: (message: string, state: 'error') => void;
	readonly sourceAudioBufferBytes: (buffer: Buffer) => number;
	readonly sourceBuffers: SourceLifecycleBufferCache<Buffer>;
	readonly sourceChunkProviders: SourceChunkProviderRegistryPort<string, Provider>;
	readonly sourcePcmBytes: (source: SourceLifecycleSource | null | undefined) => number;
	readonly sourcePeaks: Map<string, Peaks>;
	readonly state: SourceLifecycleState;
	readonly store: SourceLifecycleStore<Peaks, Metadata>;
	readonly waveformPcmWindowContains: (
		window: WaveformPcmRange | null | undefined,
		range: WaveformPcmRange,
	) => boolean;
	readonly waveformPeaksHaveRms: (
		peaks: Peaks | null | undefined,
		source?: SourceLifecycleSource | null,
	) => boolean;
}
