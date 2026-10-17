/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_BUILT_IN_WORKSPACES, DEFAULT_PANELS } from './workspace-layout-defaults.ts';
import type { WorkspacePanelPreference } from './workspace-panel-layout.ts';

export const WORKSPACE_PANEL_DEFAULTS_VERSION = 1;

const ORIGINAL_INSPECTOR_GEOMETRY = {
	'clip-properties': { dock: 'bottom', order: 15, size: 400, x: 272, y: 192, width: 400, height: 520 },
	'source-monitor': { dock: 'floating', order: 1, size: 460, x: 96, y: 72, width: 460, height: 420 },
} as const;

/** Upgrade generated audio defaults once; customized and video layouts belong to their user. */
export function migrateInspectorWorkspacePanelDefaults<Panel extends WorkspacePanelPreference>(
	activeId: string,
	panels: Readonly<Record<string, Panel>>,
	version: number,
): Readonly<Record<string, Panel>> {
	if (version >= WORKSPACE_PANEL_DEFAULTS_VERSION || activeId === 'video-editor'
		|| !AUDIO_EDITOR_BUILT_IN_WORKSPACES.some(id => id === activeId)) return panels;
	const next = { ...panels };
	for (const [id, geometry] of Object.entries(ORIGINAL_INSPECTOR_GEOMETRY)) {
		const panel = panels[id];
		if (!panel || panel.column !== undefined || panel.tabGroup !== undefined
			|| panel.tabActive !== undefined || panel.autoSize !== undefined) continue;
		if (Object.entries(geometry).every(([field, value]) => panel[field as keyof Panel] === value)) {
			next[id] = { ...panel, dock: DEFAULT_PANELS[id as keyof typeof ORIGINAL_INSPECTOR_GEOMETRY].dock };
		}
	}
	return next;
}
