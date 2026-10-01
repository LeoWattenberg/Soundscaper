/* SPDX-License-Identifier: AGPL-3.0-only */

import type { createGroupedEditorActions } from '../../controller/composition/action-facade.ts';
import type { VideoPreviewResolution } from '../../video-preview-preferences.ts';

type Actions = ReturnType<typeof createGroupedEditorActions>;

interface WorkspaceMenuDependencies {
	readonly controller: { readonly actions: {
		readonly timeline: Omit<Actions['timeline'], 'zoomFit'> & { readonly zoomFit: () => unknown };
		readonly track: Pick<Actions['track'], 'decreaseAllHeights' | 'increaseAllHeights'>;
		readonly preferences: Pick<Actions['preferences'], 'update' | 'setWorkspace'>;
	} };
	readonly parityRuntime: { readonly actions: { readonly timeline: Readonly<Record<
		'zoomDefault' | 'zoomSelection' | 'zoomToggle' | 'centerOnPlayhead', () => unknown>> } };
	readonly snapshot: { readonly preferences?: { readonly view?: {
		readonly showFadeShapeHandles?: boolean; readonly showMarkers?: boolean;
	} } };
	readonly run: (operation: () => unknown) => unknown;
	readonly zoomProject: (direction: 'in' | 'out', anchor: 'playhead') => unknown;
	readonly setShowArmControls: (update: (current: boolean) => boolean) => unknown;
	readonly toggleWorkspacePanel: (panelId: string) => unknown;
	readonly openSurface: (surface: string) => unknown;
}

/** Keep each menu's controller ownership, invocation boundary and captured snapshot together. */
export function createWorkspaceSelectionViewMenuPorts(dependencies: WorkspaceMenuDependencies) {
	const { controller, parityRuntime, snapshot, run, zoomProject, setShowArmControls,
		toggleWorkspacePanel, openSurface } = dependencies;
	return Object.freeze({
		selectionMenu: Object.freeze({
			selectAll: () => run(() => controller.actions.timeline.selectAll()),
			selectNone: () => run(() => controller.actions.timeline.clearSelection()),
			selectAllTracks: () => run(() => controller.actions.timeline.selectAllTracks()),
			selectNoTracks: () => run(() => controller.actions.timeline.selectNoTracks()),
			selectPreviousClipBoundaryToCursor: () => run(() => controller.actions.timeline.selectPreviousClipBoundaryToCursor()),
			selectCursorToNextClipBoundary: () => run(() => controller.actions.timeline.selectCursorToNextClipBoundary()),
			selectPreviousClip: () => run(() => controller.actions.timeline.selectPreviousClip()),
			selectNextClip: () => run(() => controller.actions.timeline.selectNextClip()),
			skipToSelectionStart: () => run(() => controller.actions.timeline.skipToSelectionStart()),
			skipToSelectionEnd: () => run(() => controller.actions.timeline.skipToSelectionEnd()),
			selectLeftOfPlayback: () => run(() => controller.actions.timeline.selectLeftOfPlayback()),
			selectRightOfPlayback: () => run(() => controller.actions.timeline.selectRightOfPlayback()),
			selectTrackStartToCursor: () => run(() => controller.actions.timeline.selectTrackStartToCursor()),
			selectCursorToTrackEnd: () => run(() => controller.actions.timeline.selectCursorToTrackEnd()),
			selectTrackStartToEnd: () => run(() => controller.actions.timeline.selectTrackStartToEnd()),
			zeroCross: () => run(() => controller.actions.timeline.zeroCross()),
		}),
		viewMenu: Object.freeze({
			setTimelineView: (view: Parameters<Actions['timeline']['setView']>[0]) => run(() => controller.actions.timeline.setView(view)),
			setVideoPreviewResolution: (resolution: VideoPreviewResolution) => run(() => controller.actions.preferences.update({
				view: { videoPreviewResolution: resolution },
			})),
			toggleRms: () => run(() => controller.actions.timeline.toggleRms()),
			toggleFadeShapeHandles: () => run(() => controller.actions.preferences.update({
				view: { showFadeShapeHandles: !snapshot.preferences?.view?.showFadeShapeHandles },
			})),
			toggleVerticalRulers: () => run(() => controller.actions.timeline.toggleVerticalRulers()),
			toggleScrollViewToPlayhead: () => run(() => controller.actions.timeline.toggleScrollViewToPlayhead()),
			togglePinnedPlayhead: () => run(() => controller.actions.timeline.togglePinnedPlayhead()),
			toggleRulerPlayback: () => run(() => controller.actions.timeline.toggleRulerPlayback()),
			setSnap: (settings: Parameters<Actions['timeline']['setSnap']>[0]) => run(() => controller.actions.timeline.setSnap(settings)),
			zoomIn: () => zoomProject('in', 'playhead'),
			zoomOut: () => zoomProject('out', 'playhead'),
			zoomDefault: () => run(() => parityRuntime.actions.timeline.zoomDefault()),
			zoomSelection: () => run(() => parityRuntime.actions.timeline.zoomSelection()),
			zoomToggle: () => run(() => parityRuntime.actions.timeline.zoomToggle()),
			zoomFit: () => run(() => controller.actions.timeline.zoomFit()),
			fitHeight: () => run(() => controller.actions.timeline.fitHeight()),
			centerOnPlayhead: () => run(() => parityRuntime.actions.timeline.centerOnPlayhead()),
			toggleArmControls: () => setShowArmControls((current) => !current),
			toggleMarkers: () => run(() => controller.actions.preferences.update({
				view: { showMarkers: !snapshot.preferences?.view?.showMarkers },
			})),
			decreaseAllTrackHeights: () => run(() => controller.actions.track.decreaseAllHeights()),
			increaseAllTrackHeights: () => run(() => controller.actions.track.increaseAllHeights()),
			setWorkspace: (workspaceId: string) => run(() => controller.actions.preferences.setWorkspace(workspaceId)),
			togglePanel: toggleWorkspacePanel,
			openWorkspaceOnboarding: () => openSurface('workspace-onboarding'),
		}),
	});
}

export type ApplicationSelectionMenuPort = ReturnType<typeof createWorkspaceSelectionViewMenuPorts>['selectionMenu'];
export type ApplicationViewMenuPort = ReturnType<typeof createWorkspaceSelectionViewMenuPorts>['viewMenu'];
