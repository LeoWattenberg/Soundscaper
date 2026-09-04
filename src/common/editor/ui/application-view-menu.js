/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS } from './application-menu-registry.ts';
import { createSnapMenu } from './application-menu-model.js';
import { timelineAnnotationsAvailable } from './timeline/timeline-annotation-ui-model.ts';
import {
	ANALYZER_PANEL_ID_SET,
	WORKSPACE_DISCOVERABLE_PANEL_IDS,
	workspacePanelLabel,
} from './workspace/workspace-panel-model.ts';
import { extendApplicationMenuProductPanelItems } from './application-menu-product-runtime.js';

/**
 * The View menu: panel visibility, workspace presets, waveform and ruler display, snapping,
 * zoom and the desktop host's own view entries.
 *
 * It is the one menu whose entries are almost all about how the editor is drawn rather than
 * what it does to a project, which is why it composes here instead of in the menu model that
 * assembles every menu.
 */
export function createApplicationViewMenu(context, actions) {
	const {
		capabilities, clipSelectionNavigationMenus, compactLayout, copy, desktopHost, divider, editBlocked,
		effectsPanelOpen, preferences, productItems, project, projectBinEffectivelyOpen, selectedAudioTrack,
		selectionActive, showArmControls, snapshot, uiFlags,
	} = context;
	return {
		id: 'view',
		label: copy.viewMenu,
		items: [
			{
				id: 'panels',
				label: copy.panels,
				items: [
					{ id: 'toggle-tracks', label: copy.tracksPanel, checked: uiFlags.tracksPanel },
					...WORKSPACE_DISCOVERABLE_PANEL_IDS
						.filter((panelId) => !ANALYZER_PANEL_ID_SET.has(panelId)
							&& (capabilities.audioEffects || panelId !== 'effects')
							&& (capabilities.audioAnalysis || panelId !== 'ebu-r128')
							&& (panelId !== 'markers' || timelineAnnotationsAvailable(snapshot)))
						.map((panelId) => panelId === 'effects'
						? {
							id: 'show-effects',
							label: copy.showEffects,
							checked: effectsPanelOpen,
							disabled: !selectedAudioTrack,
							onClick: actions.openEffects,
						}
						: extendApplicationMenuProductPanelItems(panelId, {
							id: `panel-${panelId}`,
							label: workspacePanelLabel(copy, panelId),
							checked: panelId === 'project-bin'
								? projectBinEffectivelyOpen
								: preferences.workspace.panels[panelId].visible,
							onClick: () => actions.togglePanel(panelId),
						}, productItems))
						.flat(),
				],
			},
			{
				id: 'workspace-preset',
				label: copy.workspace,
				items: [
					{ id: 'workspace-modern', label: copy.workspaceModern, checked: preferences.workspace.activeId === 'modern', onClick: () => actions.setWorkspace('modern') },
					{ id: 'workspace-audacity', label: copy.workspaceAudacity, checked: preferences.workspace.activeId === 'audacity', onClick: () => actions.setWorkspace('audacity') },
					{ id: 'workspace-music', label: copy.workspaceMusic, checked: preferences.workspace.activeId === 'music', onClick: () => actions.setWorkspace('music') },
					{ id: 'workspace-classic', label: copy.workspaceClassic, checked: preferences.workspace.activeId === 'classic', onClick: () => actions.setWorkspace('classic') },
					{ id: 'workspace-video-editor', label: copy.workspaceVideo, checked: preferences.workspace.activeId === 'video-editor', onClick: () => actions.setWorkspace('video-editor') },
					...preferences.workspace.custom.map((workspace) => ({ id: `workspace-${workspace.id}`, label: workspace.name, checked: preferences.workspace.activeId === workspace.id, onClick: () => actions.setWorkspace(workspace.id) })),
					{ id: 'workspace-onboarding', label: copy.workspaceOnboardingMenu, onClick: actions.openWorkspaceOnboarding },
				],
			},
			{ id: 'show-arm-controls', label: copy.showArmControls, checked: showArmControls, onClick: actions.toggleArmControls },
		// The compact layout keeps the track headers in a drawer; the desktop column has no such state.
		...(compactLayout ? [{ id: 'local://track-header-drawer', label: copy.trackHeaders, checked: Boolean(uiFlags.trackHeaderDrawer) }] : []),
			{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.toggleRmsInWaveform, label: copy.showRms, checked: Boolean(snapshot.timeline?.showRms), onClick: actions.toggleRms },
			{ id: 'show-rulers', label: copy.showVerticalRulers, checked: snapshot.timeline?.showVerticalRulers !== false, onClick: actions.toggleVerticalRulers },
			{ id: 'toggle-clipping-in-waveform', label: copy.showClipping, checked: uiFlags.clipping },
			{ id: 'show-master-track', label: copy.masterTrack, checked: Boolean(snapshot.preferences?.view?.showMasterTrack) },
			...(timelineAnnotationsAvailable(snapshot) ? [{
				id: 'show-markers',
				label: copy.showMarkers,
				checked: Boolean(snapshot.preferences?.view?.showMarkers),
				onClick: actions.toggleMarkers,
			}] : []),
			{ id: 'toggle-statusbar', label: copy.statusBar, checked: uiFlags.statusbar },
			divider(),
			createSnapMenu(copy, project, editBlocked, actions.setSnap),
			{
				id: 'zoom',
				label: copy.zoomMenu,
				items: [
					{ id: 'zoom-in', label: copy.zoomIn, shortcut: 'Ctrl+1', onClick: actions.zoomIn },
					{ id: 'zoom-default', label: copy.zoomNormal, shortcut: 'Ctrl+2', onClick: actions.zoomDefault },
					{ id: 'zoom-out', label: copy.zoomOut, shortcut: 'Ctrl+3', onClick: actions.zoomOut },
					{ id: 'zoom-to-selection', label: copy.zoomSelection, disabled: !selectionActive, onClick: actions.zoomSelection },
					{ id: 'zoom-toggle', label: copy.zoomToggle, onClick: actions.zoomToggle },
					{ id: 'zoom-fit', label: copy.zoomFit, shortcut: 'Ctrl+0', onClick: actions.zoomFit },
					{ id: 'fit-height', label: copy.fitHeight, onClick: actions.fitHeight },
					{ id: 'center-view-on-playhead', label: copy.centerViewOnPlayhead, onClick: actions.centerOnPlayhead },
					divider(),
					{ id: 'decrease-all-track-heights', label: copy.decreaseAllTrackHeights, shortcut: 'Ctrl+Shift+Down', disabled: !project?.tracks.length, onClick: actions.decreaseAllTrackHeights },
					{ id: 'increase-all-track-heights', label: copy.increaseAllTrackHeights, shortcut: 'Ctrl+Shift+Up', disabled: !project?.tracks.length, onClick: actions.increaseAllTrackHeights },
				],
			},
			clipSelectionNavigationMenus.skip,
			...productItems.view,
			...(desktopHost.view.length ? [divider(), ...desktopHost.view] : []),
			divider(),
			{ id: 'fullscreen', label: copy.fullscreen, shortcut: 'F11', onClick: actions.fullscreen },
		],
	};
}
