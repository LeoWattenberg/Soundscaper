/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CommandObject } from '../commands/protocol.ts';

export type ClipMediaKind = 'audio' | 'video';

export interface ClipTransformEnvelopePoint extends Readonly<Record<string, unknown>> {
	readonly frame: number;
}

export interface ClipTransformClip extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly sourceId: string;
	readonly title?: string;
	readonly kind?: ClipMediaKind;
	readonly timelineStartFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
	readonly trimStartFrames: number;
	readonly trimEndFrames: number;
	readonly fadeInFrames: number;
	readonly fadeOutFrames: number;
	readonly reversed: boolean;
	readonly envelope?: readonly ClipTransformEnvelopePoint[];
	readonly groupId?: string | null;
	readonly avLinkId?: string | null;
	readonly speedRatio?: number;
	readonly videoEffects?: readonly CommandObject[];
}

export interface ClipTransformSource extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly frameCount: number;
}

export interface ClipTransformTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly name: string;
	readonly type: 'audio' | 'video' | 'label';
	readonly clipIds: readonly string[];
	readonly laneGroupId?: string | null;
	readonly height?: number;
	readonly channelCount?: number;
	readonly color?: string;
}

export interface ClipTransformSelection extends Readonly<Record<string, unknown>> {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds?: readonly string[];
	readonly clipIds?: readonly string[];
	readonly frequencyRange?: Readonly<{ minimumFrequency: number; maximumFrequency: number }> | null;
}

export interface ClipTransformProject extends Readonly<Record<string, unknown>> {
	readonly schemaVersion: number;
	readonly id: string;
	readonly title: string;
	readonly sampleRate: number;
	readonly tracks: readonly ClipTransformTrack[];
	readonly clips: readonly ClipTransformClip[];
	readonly sources: readonly ClipTransformSource[];
	readonly selection?: ClipTransformSelection | null;
}
