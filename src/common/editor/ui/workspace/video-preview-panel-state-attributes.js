/* SPDX-License-Identifier: AGPL-3.0-only */

import { videoPreviewOpenFxDispositionAttribute } from './video-preview-openfx-status.jsx';

/**
 * The video preview panel's state, published as DOM attributes.
 *
 * The browser suite reads the preview's behaviour off these rather than off pixels, which
 * is what lets it assert that a clip was omitted, an effect was dropped, or a compositor
 * fell back, without decoding a frame. There are thirty of them, so they are derived here
 * instead of burying the element they hang on.
 */
export function videoPreviewPanelStateAttributes({
	activeEffectCount, activeEntries, compositorState, keyframePreviewFailed, openFxIssue,
	renderIssue, renderableCount, resolvedLayers, topActiveEntry, unavailableCount,
	visualPreviewState,
}) {
	return {
		'data-active-clip-id': visualPreviewState.activeClipIds.at(-1) || topActiveEntry?.clipId || '',
		'data-active-clip-ids': [...activeEntries.map((entry) => entry.clipId),
			...visualPreviewState.activeClipIds].join(' '),
		'data-active-track-count': resolvedLayers.length + visualPreviewState.activeTrackCount,
		'data-renderable-clip-count': renderableCount,
		'data-unavailable-clip-count': unavailableCount,
		'data-active-video-effect-count': activeEffectCount,
		'data-video-preview-requested-effect-count': renderIssue.requestedEffectCount,
		'data-video-preview-omitted-effect-count': renderIssue.omittedEffectIds.length,
		'data-video-preview-omitted-effect-ids': renderIssue.omittedEffectIds.join(' '),
		'data-video-preview-requested-composition-count': renderIssue.requestedCompositionCount,
		'data-video-preview-omitted-composition-count': renderIssue.omittedCompositionClipIds.length,
		'data-video-preview-omitted-composition-clip-ids': renderIssue.omittedCompositionClipIds.join(' '),
		'data-video-preview-renderer': compositorState,
		'data-video-preview-openfx-degraded': openFxIssue.degraded ? 'true' : 'false',
		'data-video-preview-openfx-dispositions': videoPreviewOpenFxDispositionAttribute(openFxIssue),
		'data-video-preview-keyframe-error': keyframePreviewFailed ? 'true' : 'false',
		'data-video-preview-visual-pending': visualPreviewState.pending ? 'true' : 'false',
		'data-video-preview-visual-error': visualPreviewState.error || '',
		'data-video-preview-visual-requested-count': visualPreviewState.requestedNodeIds.length,
		'data-video-preview-visual-requested-node-ids': visualPreviewState.requestedNodeIds.join(' '),
		'data-video-preview-visual-consumed-count': visualPreviewState.consumedNodeIds.length,
		'data-video-preview-visual-consumed-node-ids': visualPreviewState.consumedNodeIds.join(' '),
		'data-video-preview-visual-omitted-count': visualPreviewState.omittedNodeIds.length,
		'data-video-preview-visual-omitted-node-ids': visualPreviewState.omittedNodeIds.join(' '),
		'data-video-preview-active-freeze-node-ids': visualPreviewState.activeFreezeNodeIds.join(' '),
		'data-video-preview-available-preset-ids': visualPreviewState.availablePresetIds.join(' '),
	};
}
