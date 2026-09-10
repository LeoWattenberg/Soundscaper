/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	EditorActionRuntime,
	RestrictToCapability,
} from '../composition/action-facade-runtime.ts';
import { createVideoTrimActionFacade } from './internal/trim/video-trim-action-facade.ts';

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
) {
	const {
		addVideoClipEffect, beginVideoEffectGesture, bypassVideoClipEffect, cancelVideoEffectGesture, capabilities,
		commit, commitVideoEffectGesture, copy, createStableId, exportVideo, getClipVisualData,
		getVideoSourceVisualData, previewVideoEffectGesture, product, releaseVideoSourceVisual,
		reloadVideoSourceVisual, removeVideoClipEffect, reorderVideoClipEffect, reportVideoPreviewPressure,
		sequenceTimingService, setStatus, sourceMonitorService, taskProgress, toggleVideoClipEffect,
		updateVideoClipEffect, videoEditService, videoNavigationService, videoSourceReprobeService,
		videoTrimServices,
	} = scope;
	const videoNavigationMessage = (template: unknown, values: Readonly<Record<string, unknown>>) => (
		Object.entries(values).reduce((message, [key, value]) => (
			message.replace(`{${key}}`, String(value))
		), String(template))
	);
	const reportVideoShuttle = (operation: typeof videoNavigationService.shuttleStop) => {
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
		targets: (...args: Parameters<typeof videoEditService.targets>) => videoEditService.targets(...args),
		toggleTarget: (...args: Parameters<typeof videoEditService.toggleTarget>) => videoEditService.toggleTarget(...args),
		clearTargets: () => videoEditService.clearTargets(),
		insert: (...args: Parameters<typeof videoEditService.insert>) => videoEditService.insert(...args),
		overwrite: (...args: Parameters<typeof videoEditService.overwrite>) => videoEditService.overwrite(...args),
		// Replace and match-frame are both defined against the frame under the
		// program playhead.
		replace: (...args: Parameters<typeof videoEditService.replace>) => videoEditService.replace(...args),
		matchFrame: (...args: Parameters<typeof videoEditService.matchFrame>) => videoEditService.matchFrame(...args),
		sourceTimecodeAtSample: (...args: Parameters<typeof videoEditService.sourceTimecodeAtSample>) => videoEditService.sourceTimecodeAtSample(...args),
		// One video source on its own frame grid supplies marks without persistence.
		sourceMonitor: Object.freeze({
			view: () => sourceMonitorService.view(),
			open: (...args: Parameters<typeof sourceMonitorService.open>) => sourceMonitorService.open(...args),
			close: () => sourceMonitorService.close(),
			seek: (...args: Parameters<typeof sourceMonitorService.seek>) => sourceMonitorService.seek(...args),
			step: (...args: Parameters<typeof sourceMonitorService.step>) => sourceMonitorService.step(...args),
			markIn: (...args: Parameters<typeof sourceMonitorService.markIn>) => sourceMonitorService.markIn(...args),
			markOut: (...args: Parameters<typeof sourceMonitorService.markOut>) => sourceMonitorService.markOut(...args),
			clearMarks: () => sourceMonitorService.clearMarks(),
		}),
		// Re-read an already-imported source: the same bytes, probed again by
		// the current build, with every edit cut against the old grid conformed.
		reprobeSource: (sourceId: Parameters<typeof videoSourceReprobeService.reprobe>[0], options?: Parameters<typeof videoSourceReprobeService.reprobe>[1]) => (
			taskProgress?.run
				? taskProgress.run('probe', copy.probingVideoSource, () => videoSourceReprobeService.reprobe(sourceId, options))
				: videoSourceReprobeService.reprobe(sourceId, options)
		),
		link: (videoClipId: string, audioClipId: string) => commit({
			type: 'clip/link-av',
			videoClipId,
			audioClipId,
			avLinkId: createStableId('av-link'),
		}),
		unlink: (clipId: string) => commit({ type: 'clip/unlink-av', clipId }),
	});
}
