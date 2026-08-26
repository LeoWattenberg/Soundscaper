/* SPDX-License-Identifier: AGPL-3.0-only */

import { toDesignRecordingPreview } from './preview.ts';
import { createTimelineClipViewModel } from './waveform-view-model.ts';
import { resolveAudioEditorColor } from './TimelineOverlayComponents.jsx';

/**
 * Build the expensive design-system clip models as one memoizable operation.
 * Callers own memo invalidation so ordinary timeline scroll renders can reuse
 * waveform and spectrogram plans without hiding document or visual revisions.
 */
export function createAudioTrackRowClipViewModels({
	controller,
	sourceLookup,
	clips,
	recordingPreview,
	overscanStartFrame,
	pixelsPerSecond,
	sampleRate,
	copy,
	displayMode,
	project,
	selectedClipIds,
	showRms,
	trackColor,
	waveformCache,
	draggingClipIds,
	envelopePreviews,
}) {
	return clips.map((clip) => clip.isRecordingPreview
		? toDesignRecordingPreview(
			clip,
			recordingPreview,
			overscanStartFrame,
			pixelsPerSecond,
			sampleRate,
			copy,
			displayMode === 'multiview',
		)
		: createTimelineClipViewModel({
			controller,
			sourceLookup,
			clip,
			project,
			geometry: {
				overscanStartFrame,
				pixelsPerSecond,
				sampleRate,
			},
			selection: { selectedClipIds },
			copy,
			rendering: {
				showRms,
				halfWave: displayMode === 'half-wave',
				color: resolveAudioEditorColor(clip.color, resolveAudioEditorColor(trackColor)),
				reuseSummaryForCompatibility: displayMode === 'waveform' || displayMode === 'half-wave',
				allowPeakPyramid: displayMode !== 'spectrogram',
				provideAudacitySpectrogram: displayMode === 'spectrogram' || displayMode === 'multiview',
			},
			cache: waveformCache,
			reuseCachedWaveform: Boolean(
				draggingClipIds?.has(clip.id)
					&& clip.waveformPreviewKind !== 'trim'
					&& clip.waveformPreviewKind !== 'rate-stretch',
			),
		})).map((clip) => {
			const preview = envelopePreviews.get(String(clip.id));
			return preview ? {
				...clip,
				envelopePoints: preview.designPoints,
				audacityWaveform: clip.audacityWaveform
					? { ...clip.audacityWaveform, envelope: preview.envelope }
					: undefined,
			} : clip;
		});
}
