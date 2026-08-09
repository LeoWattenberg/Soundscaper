/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LinkedVideoOriginalSourceShape } from './linked-video-original-binding.ts';

export interface LinkedVideoOriginalSource extends Readonly<Record<string, unknown>> {
	readonly kind: 'video';
	readonly id: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly frameCount: number;
	readonly sampleRate: number;
	readonly width: number;
	readonly height: number;
	readonly frameRate: number;
	readonly videoCodec: string;
	readonly audioCodec: string | null;
	readonly hasAudio: boolean;
}

export interface FoundationLinkedVideoOriginalSource extends Readonly<Record<string, unknown>> {
	readonly kind: 'video';
	readonly id: string;
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
}

export type CompatibleLinkedVideoOriginalSource =
	| LinkedVideoOriginalSource
	| FoundationLinkedVideoOriginalSource;

export function linkedVideoOriginalSourceShape(
	source: CompatibleLinkedVideoOriginalSource,
): LinkedVideoOriginalSourceShape {
	return {
		frameCount: isLegacyVideoSource(source) ? source.frameCount : source.sampleFrameCount,
		sampleRate: source.sampleRate,
		width: source.width,
		height: source.height,
		frameRate: isLegacyVideoSource(source)
			? source.frameRate
			: source.frameRate.num / source.frameRate.den,
		videoCodec: source.videoCodec,
		audioCodec: source.audioCodec,
		hasAudio: source.hasAudio,
	};
}

function isLegacyVideoSource(
	source: CompatibleLinkedVideoOriginalSource,
): source is LinkedVideoOriginalSource {
	return typeof source.frameRate === 'number';
}
