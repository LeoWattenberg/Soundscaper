export type NumericChannel = ArrayLike<number>;

export interface FrameConversionOptions {
	readonly minimumFrame?: number;
	readonly maximumFrame?: number;
	readonly sampleRate?: number;
}

export interface TimelineIndexClip {
	readonly id: string;
}

export interface TimelineIndexSource {
	readonly id: string;
}

export interface TimelineIndexTrack {
	readonly id: string;
	readonly clipIds?: readonly string[];
}

export interface TimelineProjectLike<
	Clip extends TimelineIndexClip = TimelineIndexClip,
	Source extends TimelineIndexSource = TimelineIndexSource,
	Track extends TimelineIndexTrack = TimelineIndexTrack,
> {
	readonly clips?: readonly Clip[];
	readonly sources?: readonly Source[];
	readonly tracks?: readonly Track[];
}

export interface TimelineProjectIndex<
	Clip extends TimelineIndexClip = TimelineIndexClip,
	Source extends TimelineIndexSource = TimelineIndexSource,
	Track extends TimelineIndexTrack = TimelineIndexTrack,
> {
	readonly clipById: Map<string, Clip>;
	readonly sourceById: Map<string, Source>;
	readonly clipsByTrackId: Map<string, Clip[]>;
	readonly trackByClipId: Map<string, Track>;
}

export interface TimelineViewportClip {
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
}

export interface ViewportClipProjection {
	readonly start: number;
	readonly duration: number;
	readonly timelineStartSeconds: number;
	readonly timelineDurationSeconds: number;
	readonly clipStartSeconds: number;
	readonly clipEndSeconds: number;
	readonly viewportStartSeconds: number;
	readonly viewportEndSeconds: number;
	readonly waveformStartFrame: number;
	readonly waveformEndFrame: number;
	readonly clippedAtStart: boolean;
	readonly clippedAtEnd: boolean;
	readonly visibleStartSeconds: number;
	readonly visibleEndSeconds: number;
	readonly isVisible: boolean;
}

export interface ViewportProjectionOptions {
	readonly viewportStartFrame?: number;
	readonly viewportDurationFrames: number;
	readonly sampleRate?: number;
}

export interface TimelineViewportProjection<Clip extends TimelineViewportClip> {
	readonly viewportStartFrame: number;
	readonly viewportEndFrame: number;
	readonly viewportDurationFrames: number;
	readonly viewportStartSeconds: number;
	readonly viewportDurationSeconds: number;
	readonly overscanStartFrame: number;
	readonly overscanEndFrame: number;
	readonly clips: Array<Clip & ViewportClipProjection>;
}

export interface CanvasDimensionOptions {
	readonly devicePixelRatio?: number;
	readonly maximumPixelRatio?: number;
	readonly maximumBackingWidth?: number;
	readonly maximumBackingHeight?: number;
	readonly maximumBackingPixels?: number;
}

export interface BoundedCanvasDimensions {
	readonly cssWidth: number;
	readonly cssHeight: number;
	readonly backingWidth: number;
	readonly backingHeight: number;
	readonly requestedPixelRatio: number;
	readonly pixelRatioX: number;
	readonly pixelRatioY: number;
}

export interface WaveformClipLike {
	readonly sourceStartFrame: number;
	readonly durationFrames: number;
	readonly sourceDurationFrames?: number;
	readonly gain?: number;
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
	readonly reversed?: boolean;
	readonly inverted?: boolean;
}

export interface WaveformWindowOptions {
	readonly startFrame?: number;
	readonly endFrame?: number;
	readonly maxSamples?: number;
	readonly pixelWidth?: number;
	readonly sourceFrameOffset?: number;
	readonly reuseSummaryForCompatibility?: boolean;
}

export interface PeakPyramidWindowOptions {
	readonly startFrame?: number;
	readonly endFrame?: number;
	readonly maxSamples?: number;
	readonly pixelWidth: number;
	readonly channelCount?: number;
	readonly sourceFrameCount?: number;
}

export interface SummaryWaveformChannel {
	readonly minimum: Float32Array;
	readonly maximum: Float32Array;
	readonly rms: Float32Array | null;
}

export interface IndividualWaveformChannel {
	readonly firstSample: number;
	readonly firstSampleX: number;
	readonly samples: Float32Array;
}

export interface WaveformRendering {
	readonly mode: string;
	readonly pixelWidth: number;
	readonly pixelsPerSample: number;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly frameCount: number;
	readonly peakBlockSize?: number;
	readonly channels: readonly (SummaryWaveformChannel | IndividualWaveformChannel)[];
}

export interface PreparedWaveformWindow {
	readonly channels: Float32Array[];
	readonly startFrame: number;
	readonly endFrame: number;
	readonly frameCount: number;
	readonly sampleCount: number;
	readonly framesPerBucket: number;
	readonly downsampled: boolean;
	readonly rendering?: WaveformRendering;
}

export interface ValidatedPeakChannel {
	readonly blockSize: number;
	readonly minimums: NumericChannel;
	readonly maximums: NumericChannel;
	readonly rms: NumericChannel | null;
}

export interface ValidatedPeakLevel {
	readonly blockSize: number;
	readonly channels: readonly ValidatedPeakChannel[];
}

export interface ValidatedPeakPyramid {
	readonly channelCount: number;
	readonly levels: ValidatedPeakLevel[];
}
