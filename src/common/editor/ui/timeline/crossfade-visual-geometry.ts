/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ClipCrossfadeRanges } from '../../audio-clip-overlap.ts';
import { evaluateClipTransitionGainAt } from '../../audio-clip-transition-gain.ts';

export interface CrossfadeVisualClip {
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
}

/** Match the design-system path geometry to Soundscaper's actual clip gain. */
export function clipCrossfadeCurvePath(
	clip: CrossfadeVisualClip,
	ranges: ClipCrossfadeRanges,
	startFrame: number,
	endFrame: number,
): string {
	const samples = 64;
	const points: string[] = [];
	for (let index = 0; index <= samples; index += 1) {
		const progress = index / samples;
		const frame = startFrame + (endFrame - startFrame) * progress;
		const gain = evaluateClipTransitionGainAt(frame - clip.timelineStartFrame, clip.durationFrames, {
			fadeInFrames: clip.fadeInFrames ?? 0,
			fadeOutFrames: clip.fadeOutFrames ?? 0,
			crossfadeInRanges: ranges.crossfadeInRanges,
			crossfadeOutRanges: ranges.crossfadeOutRanges,
		});
		points.push(`${(progress * 100).toFixed(2)},${((1 - gain) * 100).toFixed(2)}`);
	}
	return `M ${points.join(' L ')}`;
}
