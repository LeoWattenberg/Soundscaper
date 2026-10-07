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
	halfWave = displayMode === 'half-wave',
	project,
	selectedClipIds,
	showRms,
	trackColor,
	waveformCache,
	draggingClipIds,
	waveformPendingClipIds,
	envelopePreviews,
	frequencyWaveformProjector,
	frequencyWaveformPreferences,
}) {
	const geometry = { overscanStartFrame, pixelsPerSecond, sampleRate };
	const selection = { selectedClipIds };
	const color = resolveAudioEditorColor(trackColor);
	const sharedRendering = {
		showRms, halfWave,
		reuseSummaryForCompatibility: displayMode === 'waveform' || displayMode === 'half-wave',
		provideAudacitySpectrogram: displayMode === 'spectrogram' || displayMode === 'multiview',
		frequencyWaveformMode: displayMode === 'waveform-three-band' || displayMode === 'waveform-rainbow' ? displayMode : null,
		frequencyWaveformProjector, frequencyWaveformPreferences,
	};
	return clips.map((clip) => {
		const model = clip.isRecordingPreview
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
			geometry,
			selection,
			copy,
			rendering: {
				...sharedRendering,
				color: resolveAudioEditorColor(clip.color, color),
			},
			cache: waveformCache,
			reuseCachedWaveform: Boolean(
				draggingClipIds?.has(clip.id)
					&& clip.waveformPreviewKind !== 'trim'
					&& clip.waveformPreviewKind !== 'rate-stretch',
			),
			waveformPending: waveformPendingClipIds?.has(String(clip.id)) ?? false,
		});
			const preview = envelopePreviews.get(String(model.id));
			return preview ? {
				...model,
				envelopePoints: preview.designPoints,
				audacityWaveform: model.audacityWaveform
					? { ...model.audacityWaveform, envelope: preview.envelope }
					: undefined,
			} : model;
		});
}
