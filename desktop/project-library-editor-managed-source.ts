/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeVideoTimingAssetReference } from '../src/common/editor/video-timing-asset-reference.ts';

export interface ManagedAudioSource extends Record<string, unknown> {
	readonly id: string;
	readonly kind: 'audio';
	readonly storageKey: string;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly originalSampleRate: number;
	readonly sampleFormat: string;
	readonly chunkFrames: number;
}

export interface ManagedVideoSource extends Record<string, unknown> {
	readonly id: string;
	readonly kind: 'video';
	readonly storageKey: string;
	readonly mimeType: string;
	readonly sampleFrameCount: number;
	readonly sourceFrameCount: number;
	readonly sampleRate: number;
	readonly width: number;
	readonly height: number;
	readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
	readonly videoCodec: string;
	readonly audioCodec: string | null;
	readonly hasAudio: boolean;
	readonly timingAsset?: Readonly<Record<string, unknown>> | null;
	readonly contentSha256?: string;
}

export interface ManagedTimingAsset extends Record<string, unknown> {
	readonly id: string;
	readonly kind: 'video-timing';
	readonly storageKey: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export type ManagedSource = ManagedAudioSource | ManagedVideoSource | ManagedTimingAsset;

export function managedVideoTimingTransfers(
	source: ManagedAudioSource | ManagedVideoSource,
): readonly ManagedTimingAsset[] {
	if (source.kind !== 'video' || source.timingAsset == null) return [];
	const reference = normalizeVideoTimingAssetReference(source.timingAsset);
	return [Object.freeze({
		id: source.id,
		kind: 'video-timing',
		storageKey: reference.storageKey,
		byteLength: reference.byteLength,
		sha256: reference.sha256,
	})];
}
