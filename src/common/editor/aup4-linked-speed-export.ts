/* SPDX-License-Identifier: AGPL-3.0-only */

import { exportError, positiveFrame } from './aup4-export-values.js';

interface LinkedClipGeometry {
	readonly id?: unknown;
	readonly linkPitchAndTempo?: unknown;
	readonly sourceDurationFrames?: unknown;
	readonly durationFrames?: unknown;
}

/** Native Audacity stretching preserves pitch; linked sample speed must already be in its PCM. */
export function aup4LinkedSamplePlaybackRate(clip: LinkedClipGeometry, sourceRate: number, projectRate: number): number {
	if (clip.linkPitchAndTempo !== true) return 1;
	const durationFrames = positiveFrame(clip.durationFrames, `clip ${String(clip.id)} durationFrames`);
	const sourceFrames = positiveFrame(clip.sourceDurationFrames ?? clip.durationFrames, `clip ${String(clip.id)} sourceDurationFrames`);
	const playbackRate = (sourceFrames / sourceRate) / (durationFrames / projectRate);
	if (!Number.isFinite(playbackRate) || playbackRate <= 0) throw exportError('Linked clip playback rate is invalid.', 'INVALID_SNAPSHOT');
	return playbackRate;
}

/** Mutate only the detached export clip, including tempo hints retained from a native import. */
export function neutralizeAup4RenderedTimePitch(clip: Record<string, unknown>): void {
	Object.assign(clip, { pitchCents: 0, speedRatio: 1, linkPitchAndTempo: false, stretchToTempo: false, stretchRatio: 1, timeRatio: 1 });
	delete clip.tempo;
	delete clip.rawAudioTempo;
	const opaque = record(clip.opaqueExtensions);
	const channels: unknown[] = Array.isArray(opaque?.aup4WaveClips) ? opaque.aup4WaveClips : [];
	for (const carrier of [opaque?.aup4WaveClip, ...channels]) {
		const node = record(record(carrier)?.node);
		if (node && Array.isArray(node.content)) node.content = node.content.filter((entry: unknown) => {
			const attribute = record(entry);
			return attribute?.kind !== 'attribute' || !['clipTempo', 'rawAudioTempo'].includes(String(attribute.name));
		});
	}
}

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
