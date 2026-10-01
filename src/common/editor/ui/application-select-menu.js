/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS } from './application-menu-registry.ts';

/** @param {object} context
 * @param {import('./workspace/selection-view-menu-ports.ts').ApplicationSelectionMenuPort} selectionMenu
 * @param {object} actions Existing loop/transport callbacks. */
export function createApplicationSelectMenu(context, selectionMenu, actions) {
	const { copy, productId, project, snapshot, divider, editBlocked, durationFrames, editSelectionActive,
		clipSelectionNavigationMenus, spectralTrackSelected, uiFlags } = context;
	return {
		id: 'select',
		label: copy.selectMenu,
		items: [
			{ id: 'select-all', label: copy.selectAll, shortcut: 'Ctrl+A', disabled: editBlocked || durationFrames <= 0, onClick: selectionMenu.selectAll },
			{ id: 'select-none', label: copy.selectNone, shortcut: 'Ctrl+Shift+A', disabled: !editSelectionActive, onClick: selectionMenu.selectNone },
			divider(),
			{ id: 'select-tracks', label: copy.selectTracks, items: [
				{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.selectAllTracks, label: copy.allTracks, disabled: !project?.tracks.length, onClick: selectionMenu.selectAllTracks },
				clipSelectionNavigationMenus.selectNoTracks,
			] },
			clipSelectionNavigationMenus.audioClips,
			{ id: 'menu-selection-spectral', label: copy.selectSpectral, items: [
				{ id: 'toggle-spectral-selection', label: copy.toggleSpectralSelection, disabled: editBlocked || !spectralTrackSelected },
				{ id: 'spectral-brush', label: copy.spectralBrush, checked: Boolean(uiFlags.spectralBrush), disabled: editBlocked || !spectralTrackSelected },
			] },
			{
				id: 'select-region',
				label: copy.selectRegion,
				items: [
					{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.selectLeftOfPlaybackPosition, label: copy.leftAtPlayback, onClick: selectionMenu.selectLeftOfPlayback },
					{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.selectRightOfPlaybackPosition, label: copy.rightAtPlayback, onClick: selectionMenu.selectRightOfPlayback },
					{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.selectTrackStartToCursor, label: copy.trackStartToCursor, onClick: selectionMenu.selectTrackStartToCursor },
					{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.selectCursorToTrackEnd, label: copy.cursorToTrackEnd, onClick: selectionMenu.selectCursorToTrackEnd },
					{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.selectTrackStartToEnd, label: copy.trackStartToEnd || copy.selectAll, onClick: selectionMenu.selectTrackStartToEnd },
				],
			},
			{
				id: 'looping',
				label: copy.loopRegion,
				items: [
					{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.toggleLoopRegion, label: copy.loop, shortcut: productId === 'framescaper' ? undefined : 'L', checked: Boolean(project?.loop?.enabled), onClick: actions.toggleLoop },
					{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.clearLoopRegion, label: copy.clearLoopRegion || copy.selectNone, disabled: !project?.loop?.enabled, onClick: actions.clearLoop },
					{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.setLoopRegionToSelection, label: copy.loopToSelection || copy.loop, disabled: !editSelectionActive, onClick: actions.loopToSelection },
					{ id: 'set-selection-to-loop', label: copy.selectionToLoop, disabled: !project?.loop?.enabled, onClick: actions.selectionToLoop },
					{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.setLoopRegionInOut, label: copy.setLoopInOut || copy.loopRegion, onClick: actions.setLoopInOut },
					{ id: 'toggle-selection-follows-loop-region', label: copy.selectionFollowsLoop, checked: Boolean(snapshot.loopOptions?.selectionFollows), onClick: actions.toggleSelectionFollowsLoop },
				],
			},
			{ id: 'zero-crossings', label: copy.zeroCrossings, shortcut: 'Z', disabled: editBlocked || !editSelectionActive, onClick: selectionMenu.zeroCross },
		],
	};
}
