/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CaptureSourceRole } from '../framescaper-capture-domain.ts';
import type { FramescaperCaptureExactPresentationRange } from './framescaper-capture-exact-presentation-range.ts';

interface ExactCaptureStream {
	readonly role: CaptureSourceRole;
	readonly startOffsetFrames: number;
	readonly presentationEndOffsetFrames: number;
	readonly timelineDurationFrames: number;
	readonly exactPresentationRange: FramescaperCaptureExactPresentationRange | null;
	readonly timelineStartFrame: number;
	readonly timelineEndFrame: number;
}

/** Give an exact capture pair the one video-conformed timeline range required by an A/V link. */
export function alignExactCaptureAvPairs<Stream extends ExactCaptureStream>(
	streams: readonly Stream[],
): Stream[] {
	const byRole = new Map(streams.map((stream) => [stream.role, stream]));
	const alignedAudio = new Map<CaptureSourceRole, Stream>();
	for (const [videoRole, audioRole] of [
		['camera', 'microphone'],
		['display', 'system-audio'],
	] as const) {
		const video = byRole.get(videoRole);
		const audio = byRole.get(audioRole);
		if (!video || !audio
			|| video.startOffsetFrames !== audio.startOffsetFrames
			|| video.presentationEndOffsetFrames !== audio.presentationEndOffsetFrames
			|| video.timelineDurationFrames !== audio.timelineDurationFrames
			|| video.exactPresentationRange === null
			|| video.exactPresentationRange !== audio.exactPresentationRange) continue;
		alignedAudio.set(audioRole, Object.freeze({
			...audio,
			timelineStartFrame: video.timelineStartFrame,
			timelineEndFrame: video.timelineEndFrame,
		}));
	}
	return streams.map((stream) => alignedAudio.get(stream.role) ?? stream);
}
