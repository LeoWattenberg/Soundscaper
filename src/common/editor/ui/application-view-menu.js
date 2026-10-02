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
import { createVideoPreviewResolutionMenu } from './video-preview-resolution-menu.ts';

/**
 * The View menu: panel visibility, workspace presets, waveform and ruler display, snapping,
 * zoom and the desktop host's own view entries.
 *
 * It is the one menu whose entries are almost all about how the editor is drawn rather than
 * what it does to a project, which is why it composes here instead of in the menu model that
 * assembles every menu.
 */
/** @param {object} context
 * @param {import('./workspace/selection-view-menu-ports.ts').ApplicationViewMenuPort} viewMenu
 * @param {object} actions Shared Effects/fullscreen entries. */
export function createApplicationViewMenu(context, viewMenu, actions = {}) {
	const {
		capabilities, clipSelectionNavigationMenus, compactLayout, copy, desktopHost, divider, editBlocked,
		effectsPanelOpen, preferences, productItems, project, projectBinEffectivelyOpen, selectedAudioTrack,
		editSelectionActive, showArmControls, snapshot, uiFlags,
	} = context;
	return {
		id: 'view',
		label: copy.viewMenu,
		items: [
			{
				id: 'panels',
				label: copy.panels,
				items: [
					{ id: 'toggle-tracks', label: copy.tracksPanel, checked: uiFlags.tracksPanel, visibilityToggle: true },
					...WORKSPACE_DISCOVERABLE_PANEL_IDS
						.filter((panelId) => !ANALYZER_PANEL_ID_SET.has(panelId)
							&& (capabilities.audioEffects || panelId !== 'effects')
							&& (capabilities.audioRecording || panelId !== 'recording-meter')
							&& (capabilities.audioAnalysis || panelId !== 'ebu-r128')
							&& (panelId !== 'markers' || timelineAnnotationsAvailable(snapshot)))
						.map((panelId) => panelId === 'effects'
						? {
							id: 'show-effects',
							label: copy.effects,
							checked: effectsPanelOpen,
							visibilityToggle: true,
							disabled: !selectedAudioTrack,
							onClick: actions.openEffects,
						}
						: extendApplicationMenuProductPanelItems(panelId, {
							id: `panel-${panelId}`,
							label: workspacePanelLabel(copy, panelId),
							checked: panelId === 'project-bin'
								? projectBinEffectivelyOpen
								: preferences.workspace.panels[panelId].visible,
							visibilityToggle: true,
							onClick: () => viewMenu.togglePanel(panelId),
						}, productItems))
						.flat(),
				],
			},
			{
				id: 'workspace-preset',
				label: copy.workspace,
				items: [
					{ id: 'workspace-modern', label: copy.workspaceModern, checked: preferences.workspace.activeId === 'modern', onClick: () => viewMenu.setWorkspace('modern') },
					{ id: 'workspace-audacity', label: copy.workspaceAudacity, checked: preferences.workspace.activeId === 'audacity', onClick: () => viewMenu.setWorkspace('audacity') },
					{ id: 'workspace-music', label: copy.workspaceMusic, checked: preferences.workspace.activeId === 'music', onClick: () => viewMenu.setWorkspace('music') },
					{ id: 'workspace-classic', label: copy.workspaceClassic, checked: preferences.workspace.activeId === 'classic', onClick: () => viewMenu.setWorkspace('classic') },
					{ id: 'workspace-video-editor', label: copy.workspaceVideo, checked: preferences.workspace.activeId === 'video-editor', onClick: () => viewMenu.setWorkspace('video-editor') },
					...preferences.workspace.custom.map((workspace) => ({ id: `workspace-${workspace.id}`, documentationId: 'workspace-custom', label: workspace.name, checked: preferences.workspace.activeId === workspace.id, onClick: () => viewMenu.setWorkspace(workspace.id) })),
					{ id: 'workspace-onboarding', label: copy.workspaceOnboardingMenu, onClick: viewMenu.openWorkspaceOnboarding },
				],
			},
			{ id: 'show-arm-controls', label: copy.showArmControls, checked: showArmControls, onClick: viewMenu.toggleArmControls },
			...(capabilities.videoPlayback ? [createVideoPreviewResolutionMenu(
				copy, snapshot.preferences?.view?.videoPreviewResolution, viewMenu.setVideoPreviewResolution,
			)] : []),
		// The compact layout keeps the track headers in a drawer; the desktop column has no such state.
		...(compactLayout ? [{ id: 'local://track-header-drawer', label: copy.trackHeaders, checked: Boolean(uiFlags.trackHeaderDrawer), visibilityToggle: true }] : []),
			{ id: AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.toggleRmsInWaveform, label: copy.viewRmsInWaveform, preserveLabel: true, checked: Boolean(snapshot.timeline?.showRms), visibilityToggle: true, onClick: viewMenu.toggleRms },
			{ id: 'show-fade-shape-handles', label: copy.viewFadeShapeHandles, checked: Boolean(snapshot.preferences?.view?.showFadeShapeHandles), visibilityToggle: true, onClick: viewMenu.toggleFadeShapeHandles },
			{ id: 'show-rulers', label: copy.viewVerticalRulers, preserveLabel: true, checked: snapshot.timeline?.showVerticalRulers !== false, visibilityToggle: true, onClick: viewMenu.toggleVerticalRulers },
			{ id: 'toggle-clipping-in-waveform', label: copy.viewClippingInWaveform, preserveLabel: true, checked: uiFlags.clipping, visibilityToggle: true },
			{ id: 'show-master-track', label: copy.viewMasterTrack, preserveLabel: true, checked: Boolean(snapshot.preferences?.view?.showMasterTrack), visibilityToggle: true },
			...(timelineAnnotationsAvailable(snapshot) ? [{
				id: 'show-markers',
				label: copy.panelMarkers,
				checked: Boolean(snapshot.preferences?.view?.showMarkers),
				visibilityToggle: true,
				onClick: viewMenu.toggleMarkers,
			}] : []),
			{ id: 'toggle-statusbar', label: copy.statusBar, checked: uiFlags.statusbar, visibilityToggle: true },
			divider(),
			createSnapMenu(copy, project, editBlocked, viewMenu.setSnap),
			{
				id: 'zoom',
				label: copy.zoomMenu,
				items: [
					{ id: 'zoom-in', label: copy.zoomIn, shortcut: 'Ctrl+1', onClick: viewMenu.zoomIn },
					{ id: 'zoom-default', label: copy.zoomNormal, shortcut: 'Ctrl+2', onClick: viewMenu.zoomDefault },
					{ id: 'zoom-out', label: copy.zoomOut, shortcut: 'Ctrl+3', onClick: viewMenu.zoomOut },
					{ id: 'zoom-to-selection', label: copy.zoomSelection, disabled: !editSelectionActive, onClick: viewMenu.zoomSelection },
					{ id: 'zoom-toggle', label: copy.zoomToggle, onClick: viewMenu.zoomToggle },
					{ id: 'zoom-fit', label: copy.zoomFit, shortcut: 'Ctrl+0', onClick: viewMenu.zoomFit },
					{ id: 'fit-height', label: copy.fitHeight, onClick: viewMenu.fitHeight },
					{ id: 'center-view-on-playhead', label: copy.centerViewOnPlayhead, onClick: viewMenu.centerOnPlayhead },
					divider(),
					{ id: 'decrease-all-track-heights', label: copy.decreaseAllTrackHeights, shortcut: 'Ctrl+Shift+Down', disabled: !project?.tracks.length, onClick: viewMenu.decreaseAllTrackHeights },
					{ id: 'increase-all-track-heights', label: copy.increaseAllTrackHeights, shortcut: 'Ctrl+Shift+Up', disabled: !project?.tracks.length, onClick: viewMenu.increaseAllTrackHeights },
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
