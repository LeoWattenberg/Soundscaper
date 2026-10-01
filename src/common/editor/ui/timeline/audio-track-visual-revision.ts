/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TimelineClipVisualController, TimelineWaveformClip } from './waveform-view-model.ts';

type VisualRevisionClip = Pick<TimelineWaveformClip, 'id' | 'projectBinClipId'> & Readonly<{
	isRecordingPreview?: boolean;
}>;

/** Identify only the media data used by a row's currently projected clips. */
export function createAudioTrackVisualRevisionReader(): (
	controller: TimelineClipVisualController,
	clips: readonly VisualRevisionClip[],
) => readonly unknown[] {
	let previous: readonly unknown[] = Object.freeze([]);
	return (controller, clips) => {
		const content: unknown[] = [];
		for (const clip of clips) {
			if (clip.isRecordingPreview) continue;
			const visual = controller.getClipVisualData(clip.id)
				|| controller.getProjectBinClipVisualData?.(clip.projectBinClipId || clip.id);
			// Visual getters return fresh wrappers. Immutable media references
			// change when a source or a bounded analysis window is published.
			content.push(
				clip.id,
				visual?.available ?? false,
				visual?.source ?? null,
				visual?.buffer ?? null,
				visual?.peaks ?? null,
				visual?.pcmWindow ?? null,
				visual?.peakWindow ?? null,
				visual?.frequencyAnalysis ?? null,
				visual?.frequencyWindow ?? null,
			);
		}
		if (content.length === previous.length
			&& content.every((value, index) => Object.is(value, previous[index]))) return previous;
		previous = Object.freeze(content);
		return previous;
	};
}
