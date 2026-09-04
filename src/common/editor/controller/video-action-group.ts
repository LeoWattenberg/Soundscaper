/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	EditorActionRuntime,
	RestrictToCapability,
	RuntimeValue,
} from './action-facade-runtime.ts';
import { createVideoTrimActionFacade } from './video-trim-action-facade.ts';

/**
 * The `video` group of the editor action facade.
 *
 * Visual data, export, trimming, shuttle navigation, clip effects, three-point editing,
 * the source monitor and A/V linking all address one surface, so they compose here rather
 * than in the facade's composition root, which has the whole editor to hold.
 */
export function createVideoActionGroup(
	scope: EditorActionRuntime,
	restricted: RestrictToCapability,
): RuntimeValue {
	const {
		addVideoClipEffect, beginVideoEffectGesture, bypassVideoClipEffect, cancelVideoEffectGesture, capabilities,
		commit, commitVideoEffectGesture, copy, createStableId, exportVideo, getClipVisualData,
		getVideoSourceVisualData, previewVideoEffectGesture, product, releaseVideoSourceVisual,
		reloadVideoSourceVisual, removeVideoClipEffect, reorderVideoClipEffect, reportVideoPreviewPressure,
		sequenceTimingService, setStatus, sourceMonitorService, taskProgress, toggleVideoClipEffect,
		updateVideoClipEffect, videoEditService, videoNavigationService, videoSourceReprobeService,
		videoTrimServices,
	} = scope;
	const videoNavigationMessage = (template: RuntimeValue, values: Readonly<Record<string, RuntimeValue>>) => (
		Object.entries(values).reduce((message, [key, value]) => (
			message.replace(`{${key}}`, String(value))
		), String(template))
	);
	const reportVideoShuttle = (operation: RuntimeValue) => {
		const view = operation();
		const timecode = sequenceTimingService.label(view.positionFrame, view.sequenceId);
		const message = view.rate === 0
			? videoNavigationMessage(copy.shuttleStoppedStatus, { timecode })
			: videoNavigationMessage(copy.shuttleStatus, {
				direction: view.rate < 0 ? copy.shuttleBackward : copy.shuttleForward,
				rate: Math.abs(view.rate), timecode,
			});
		setStatus(message, 'success');
		return view;
	};
	const navigateVideoEdit = (direction: 'previous' | 'next') => {
		const result = direction === 'previous'
			? videoNavigationService.previousEditPoint()
			: videoNavigationService.nextEditPoint();
		const found = result !== null;
		setStatus(found
			? videoNavigationMessage(direction === 'previous' ? copy.previousEditStatus : copy.nextEditStatus, {
				timecode: sequenceTimingService.playheadLabel(),
			})
			: direction === 'previous' ? copy.noPreviousEdit : copy.noNextEdit, found ? 'success' : 'info');
		return result;
	};
	return Object.freeze({
		getClipVisualData,
		getSourceVisualData: getVideoSourceVisualData,
		releaseSourceVisual: releaseVideoSourceVisual,
		reloadSourceVisual: reloadVideoSourceVisual, reportPreviewPressure: reportVideoPreviewPressure,
		export: exportVideo,
		trim: createVideoTrimActionFacade({
			videoCompositing: capabilities.videoCompositing, productName: product.name, services: videoTrimServices,
		}),
		navigation: Object.freeze({
			view: restricted('videoCompositing', () => videoNavigationService.view()),
			shuttleBackward: restricted('videoCompositing', () => reportVideoShuttle(videoNavigationService.shuttleReverse)),
			shuttleStop: restricted('videoCompositing', () => reportVideoShuttle(videoNavigationService.shuttleStop)),
			shuttleForward: restricted('videoCompositing', () => reportVideoShuttle(videoNavigationService.shuttleForward)),
			previousEdit: restricted('videoCompositing', () => navigateVideoEdit('previous')),
			nextEdit: restricted('videoCompositing', () => navigateVideoEdit('next')),
		}),
		effects: Object.freeze({
			add: restricted('videoEffects', addVideoClipEffect),
			update: restricted('videoEffects', updateVideoClipEffect),
			bypass: restricted('videoEffects', bypassVideoClipEffect),
			toggle: restricted('videoEffects', toggleVideoClipEffect),
			reorder: restricted('videoEffects', reorderVideoClipEffect),
			remove: restricted('videoEffects', removeVideoClipEffect),
			beginGesture: restricted('videoEffects', beginVideoEffectGesture),
			preview: restricted('videoEffects', previewVideoEffectGesture),
			commit: restricted('videoEffects', commitVideoEffectGesture),
			cancel: restricted('videoEffects', cancelVideoEffectGesture),
		}),
		// Three-point editing from the Project Bin into the targeted lanes.
		targets: (sequenceId: RuntimeValue) => videoEditService.targets(sequenceId),
		toggleTarget: (trackId: RuntimeValue, sequenceId: RuntimeValue) => (
			videoEditService.toggleTarget(trackId, sequenceId)
		),
		clearTargets: () => videoEditService.clearTargets(),
		insert: (request: RuntimeValue) => videoEditService.insert(request),
		overwrite: (request: RuntimeValue) => videoEditService.overwrite(request),
		// Replace and match-frame are both defined against the frame under the
		// program playhead.
		replace: (request: RuntimeValue) => videoEditService.replace(request),
		matchFrame: (request: RuntimeValue) => videoEditService.matchFrame(request),
		sourceTimecodeAtSample: (sample: RuntimeValue, sequenceId: RuntimeValue) => videoEditService.sourceTimecodeAtSample(sample, sequenceId),
		// One video source on its own frame grid supplies marks without persistence.
		sourceMonitor: Object.freeze({
			view: () => sourceMonitorService.view(),
			open: (binItemId: RuntimeValue, options: RuntimeValue) => (
				sourceMonitorService.open(binItemId, options)
			),
			close: () => sourceMonitorService.close(),
			seek: (frame: RuntimeValue) => sourceMonitorService.seek(frame),
			step: (frameDelta: RuntimeValue) => sourceMonitorService.step(frameDelta),
			markIn: (frame: RuntimeValue) => sourceMonitorService.markIn(frame),
			markOut: (frame: RuntimeValue) => sourceMonitorService.markOut(frame),
			clearMarks: () => sourceMonitorService.clearMarks(),
		}),
		// Re-read an already-imported source: the same bytes, probed again by
		// the current build, with every edit cut against the old grid conformed.
		reprobeSource: (sourceId: RuntimeValue, options: RuntimeValue) => (
			taskProgress?.run
				? taskProgress.run('probe', copy.probingVideoSource, () => videoSourceReprobeService.reprobe(sourceId, options))
				: videoSourceReprobeService.reprobe(sourceId, options)
		),
		link: (videoClipId: RuntimeValue, audioClipId: RuntimeValue) => commit({
			type: 'clip/link-av',
			videoClipId,
			audioClipId,
			avLinkId: createStableId('av-link'),
		}),
		unlink: (clipId: RuntimeValue) => commit({ type: 'clip/unlink-av', clipId }),
	});
}
