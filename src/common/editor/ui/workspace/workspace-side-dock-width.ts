/* SPDX-License-Identifier: AGPL-3.0-only */

import { groupWorkspacePanelColumns, workspaceSidePanelMinimumWidth } from '../../workspace-panel-columns.ts';
import type { WorkspacePanelGroup, WorkspacePanelPreference } from '../../workspace-panel-layout.ts';
import { AUDIO_EDITOR_WORKSPACE_PRESETS, DEFAULT_PANELS } from '../../workspace-layout-defaults.ts';

interface SideDockPanelWidth {
	readonly size?: number;
	readonly width?: number;
}

/** Keep default layouts responsive until a dock has been customized. */
export function workspaceSideDockAllowsWidePanels(
	panels: readonly (readonly [string, SideDockPanelWidth])[],
	workspaceId = 'modern',
): boolean {
	const defaults: Readonly<Record<string, { readonly size: number }>> = Object.hasOwn(AUDIO_EDITOR_WORKSPACE_PRESETS, workspaceId)
		? AUDIO_EDITOR_WORKSPACE_PRESETS[workspaceId as keyof typeof AUDIO_EDITOR_WORKSPACE_PRESETS].panels
		: DEFAULT_PANELS;
	return panels.some(([panelId, panel]) => {
		if (panelId === 'clock' || panelId === 'playback-meter' || panelId === 'recording-meter') return true;
		const defaultSize = defaults[panelId]?.size ?? DEFAULT_PANELS[panelId as keyof typeof DEFAULT_PANELS]?.size ?? 320;
		return (panel.width ?? panel.size ?? defaultSize) !== defaultSize;
	});
}

export function workspaceSideDockColumns<Panel extends WorkspacePanelPreference>(groups: readonly WorkspacePanelGroup<Panel>[]) {
	return groupWorkspacePanelColumns(groups).map((column) => {
		const panels = column.groups.flatMap((group) => group.entries);
		const minimumWidth = Math.max(...panels.map(([id]) => workspaceSidePanelMinimumWidth(id)));
		return { ...column, minimumWidth, width: Math.max(minimumWidth, Number(panels[0]?.[1].width ?? 360)) };
	});
}
