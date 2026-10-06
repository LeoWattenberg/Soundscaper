/* SPDX-License-Identifier: AGPL-3.0-only */

import { evaluateClipFadeAt } from '../../audio-clip-transition-gain.ts';
import { envelopeValueAtFrame } from '../../automation.js';

interface RenderedPencilClip {
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly gain?: number;
	readonly inverted?: boolean;
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
	readonly fadeInShape?: number;
	readonly fadeOutShape?: number;
	readonly envelope?: readonly Readonly<{ frame: number; value: number }>[];
}

/** The pointer addresses the rendered waveform; Pencil writes its underlying PCM. */
export function samplePointerSourceAmplitude(
	clip: RenderedPencilClip,
	timelineFrame: number,
	displayedAmplitude: number,
): number {
	const localFrame = timelineFrame - clip.timelineStartFrame;
	const gain = (clip.inverted ? -1 : 1) * (clip.gain ?? 1)
		* evaluateClipFadeAt(localFrame, clip.durationFrames, clip.fadeInFrames ?? 0, 'in', clip.fadeInShape)
		* evaluateClipFadeAt(localFrame, clip.durationFrames, clip.fadeOutFrames ?? 0, 'out', clip.fadeOutShape)
		* envelopeValueAtFrame(clip.envelope, localFrame, clip.durationFrames);
	if (gain === 0) return 0;
	return Math.max(-1, Math.min(1, displayedAmplitude / gain));
}
