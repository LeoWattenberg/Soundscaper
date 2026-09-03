/* SPDX-License-Identifier: AGPL-3.0-only */

import type { BreakpointMap, Rational, RationalRate } from './timeline-time.ts';
import type { VideoTimingAssetReference } from './video-timing-asset-reference.ts';

export type MediaFactoryInput = Readonly<Record<string, unknown>>;
type Mutable<Value> = { -readonly [Key in keyof Value]: Value[Key] };
export type MediaFactoryResult<
	Options extends MediaFactoryInput,
	Leaf extends object,
> = Omit<Mutable<Options>, keyof Leaf> & Leaf & Readonly<Record<string, unknown>>;

export interface AudioSourceLeaf {
	readonly kind: 'audio';
	readonly id: string;
	readonly name: string;
	readonly mimeType: string;
	readonly storageKey: string;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly originalSampleRate: number;
	readonly sampleFormat: string;
	readonly chunkFrames: number;
	readonly opaqueExtensions: Record<string, unknown>;
}

export interface VideoSourceLeaf {
	readonly kind: 'video';
	readonly id: string;
	readonly name: string;
	readonly mimeType: string;
	readonly storageKey: string;
	readonly frameCount?: never;
	readonly sampleFrameCount: number;
	readonly sampleRate: number;
	readonly width: number;
	readonly height: number;
	readonly frameRate: RationalRate;
	readonly sourceFrameCount: number;
	readonly videoCodec: string;
	readonly audioCodec: string | null;
	readonly hasAudio: boolean;
	readonly posterStorageKey: string | null;
	readonly thumbnailStorageKey: string | null;
	readonly opaqueExtensions: Record<string, unknown>;
	readonly timingAsset: Readonly<VideoTimingAssetReference> | null;
	readonly timingDecision: Readonly<{
		readonly mode: 'exact' | 'conform-cfr-at-ingest';
		readonly rate: RationalRate;
	}>;
}

export interface AudioClipLeaf {
	readonly kind: 'audio';
	readonly id: string;
	readonly sourceId: string;
	readonly title: string;
	readonly timelineStartFrame?: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames?: number;
	readonly trimStartFrames: number;
	readonly trimEndFrames: number;
	readonly gain: number;
	readonly fadeInFrames: number;
	readonly fadeOutFrames: number;
	readonly reversed: boolean;
	readonly inverted: boolean;
	readonly envelope: readonly Readonly<{ readonly frame: number; readonly value: number }>[];
	readonly groupId: string | null;
	readonly color: string;
	readonly pitchCents: number;
	readonly speedRatio: number;
	readonly preserveFormants: boolean;
	readonly stretchToTempo: boolean;
	readonly renderCacheRevision: number;
	readonly opaqueExtensions: Record<string, unknown>;
	readonly avLinkId: string | null;
	readonly binItemId: string | null;
	readonly anchor: 'sample' | 'musical';
	readonly musicalStartBeat: Rational | null;
	readonly musicalExtent: 'fixedSamples' | 'beat';
	readonly musicalDurationBeats: Rational | null;
	readonly warpMap: BreakpointMap | null;
}

export interface VideoClipFixtureLeaf {
	readonly kind: 'video';
	readonly id: string;
	readonly sourceId: string;
	readonly title: string;
	readonly timelineStartFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
	readonly trimStartFrames: number;
	readonly trimEndFrames: number;
	readonly groupId: string | null;
	readonly color: string;
	readonly speedRatio: number;
	readonly avLinkId: string | null;
	readonly binItemId: string | null;
	readonly opaqueExtensions: Record<string, unknown>;
	readonly videoEffects: readonly VideoEffectLeaf[];
}

export interface VideoEffectLeaf extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: string;
	readonly enabled: boolean;
	readonly params: Readonly<Record<string, number>>;
}

export interface VideoClipLeaf extends Omit<VideoClipFixtureLeaf,
	'timelineStartFrame' | 'sourceStartFrame' | 'sourceDurationFrames' | 'durationFrames'> {
	readonly timelineStartFrame?: never;
	readonly sourceStartFrame?: never;
	readonly sourceDurationFrames?: never;
	readonly durationFrames?: never;
	readonly sequenceId: string;
	readonly sequenceStartFrame: number;
	readonly sequenceFrameCount: number;
	readonly sourceInFrame: number;
	readonly sourceFrameCount: number;
	readonly retimeMap: BreakpointMap | null;
}

export interface AudioTrackLeaf {
	readonly type: 'audio';
	readonly id: string;
	readonly name: string;
	readonly gain: number;
	readonly pan: number;
	readonly mute: boolean;
	readonly solo: boolean;
	readonly armed: boolean;
	readonly displayMode: string;
	readonly color: string;
	readonly spectrogram: Readonly<Record<string, unknown>>;
	readonly envelope: readonly Readonly<{ readonly frame: number; readonly value: number }>[];
	readonly effectsActive: boolean;
	readonly effects: readonly Readonly<Record<string, unknown>>[];
	readonly clipIds: readonly string[];
	readonly collapsed: boolean;
	readonly height: number;
	readonly opaqueExtensions: Record<string, unknown>;
	readonly laneGroupId: string | null;
}

export interface VideoTrackLeaf {
	readonly type: 'video';
	readonly id: string;
	readonly name: string;
	readonly clipIds: readonly string[];
	readonly mute: boolean;
	readonly solo: boolean;
	readonly hidden: boolean;
	readonly collapsed: boolean;
	readonly height: number;
	readonly laneGroupId: string | null;
	readonly opaqueExtensions: Record<string, unknown>;
}

export interface LabelLeaf {
	readonly id: string;
	readonly title?: string;
	readonly color?: string;
	readonly anchor: 'sample' | 'musical';
	readonly startFrame?: number;
	readonly endFrame?: number;
	readonly startBeat: Rational | null;
	readonly endBeat: Rational | null;
	readonly opaqueExtensions?: Record<string, unknown>;
}

export interface LabelTrackLeaf {
	readonly type: 'label';
	readonly id: string;
	readonly name: string;
	readonly labels: readonly LabelLeaf[];
	readonly collapsed: boolean;
	readonly height: number;
	readonly laneGroupId: null;
	readonly opaqueExtensions: Record<string, unknown>;
}

/** Exact-current media unions exposed by validated project documents. */
export type MediaSourceLeaf = (AudioSourceLeaf | VideoSourceLeaf) & Readonly<Record<string, unknown>>;
export type MediaClipLeaf = (AudioClipLeaf | VideoClipLeaf) & Readonly<Record<string, unknown>>;
export type MediaTrackLeaf = (AudioTrackLeaf | VideoTrackLeaf | LabelTrackLeaf) & Readonly<Record<string, unknown>>;

export type MediaSourceLeafFor<Options extends MediaFactoryInput> = Options extends { readonly kind: 'video' }
	? MediaFactoryResult<Options, VideoSourceLeaf>
	: MediaFactoryResult<Options, AudioSourceLeaf>;

export type MediaClipLeafFor<Options extends MediaFactoryInput> = Options extends { readonly kind: 'video' }
	? MediaFactoryResult<Options, VideoClipLeaf>
	: MediaFactoryResult<Options, AudioClipLeaf>;

export type MediaTrackLeafFor<Options extends MediaFactoryInput> = Options extends { readonly type: 'video' }
	? MediaFactoryResult<Options, VideoTrackLeaf>
	: Options extends { readonly type: 'label' }
		? MediaFactoryResult<Options, LabelTrackLeaf>
		: MediaFactoryResult<Options, AudioTrackLeaf>;
