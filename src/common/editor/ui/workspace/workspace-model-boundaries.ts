/* SPDX-License-Identifier: AGPL-3.0-only */

export const WORKSPACE_OVERLAY_MODEL_KEYS = Object.freeze([
	'activeSurface', 'applicationMenus', 'aboutLabel', 'capabilities',
	'closeNyquist', 'controller', 'copy', 'dialog', 'displayAudioSupported',
	'dialogTrackId', 'dialogValue', 'effectWindows', 'editBlocked', 'fileService',
	'generatorType', 'locale', 'macroDraft', 'nyquistTarget', 'preferences',
	'preferencesPage', 'projectBinEffectivelyOpen', 'productId', 'run', 'scapeOpenDecision',
	'setActiveSurface', 'setDialog', 'setDialogValue', 'closeEffectWindow', 'setMacroDraft',
	'selectedMediaPreparation', 'settleScapeOpenDecision', 'showArmControls',
	'soundscaperWorkflow', 'snapshot', 'toggleWorkspacePanel',
] as const);

export type WorkspaceOverlayModelKey = typeof WORKSPACE_OVERLAY_MODEL_KEYS[number];
export type WorkspaceOverlayModel = Readonly<Record<WorkspaceOverlayModelKey, unknown>>;

/** Close the overlay courier to its declared fields and make it immutable. */
export function createWorkspaceOverlayModel(model: WorkspaceOverlayModel): WorkspaceOverlayModel {
	return Object.freeze(model);
}

export const WORKSPACE_PANEL_DOCK_RUNTIME_KEYS = Object.freeze([
	'controller', 'snapshot', 'productId', 'capabilities', 'copy', 'locale',
	'fileService', 'playbackMeterSettings', 'recordingMeterSettings',
	'onPlaybackMeterSettingsChange', 'onRecordingMeterSettingsChange', 'clippingEnabled', 'run', 'showArmControls',
	'displayAudioSupported', 'onOpenEffects', 'onRoutingGraphGesture',
	'onRoutingParameterGesture', 'effectsPanelTarget', 'onEffectWindowChange',
	'draggedPanelId', 'onPanelDragStart', 'onPanelDragEnd', 'onPanelMove',
	'onTogglePanel', 'projectBinEffectivelyOpen', 'blocked', 'clipPropertiesFocusRequest',
] as const);

export type WorkspacePanelDockRuntimeKey = typeof WORKSPACE_PANEL_DOCK_RUNTIME_KEYS[number];
export type WorkspacePanelDockRuntime = Readonly<Record<WorkspacePanelDockRuntimeKey, unknown>>;

/** Close the common dock wiring to one immutable runtime boundary. */
export function createWorkspacePanelDockRuntime(runtime: WorkspacePanelDockRuntime): WorkspacePanelDockRuntime {
	return Object.freeze(runtime);
}
