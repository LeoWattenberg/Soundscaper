/* SPDX-License-Identifier: AGPL-3.0-only */

import type { WorkspacePanelPreference } from './workspace-panel-layout.ts';

const ORIGINAL_VIDEO_PANELS = [
	['project-bin', 'left', 0, 380],
	['video-preview', 'right', 0, 560],
	['source-monitor', 'right', 1, 460],
] as const;

/** Only the original, formerly fixed video strip needs its placements migrated. */
export function migrateVideoWorkspacePanels<Panel extends WorkspacePanelPreference>(
	activeId: string,
	panels: Readonly<Record<string, Panel>>,
): Readonly<Record<string, Panel>> {
	if (activeId !== 'video-editor' || !ORIGINAL_VIDEO_PANELS.every(([id, dock, order, size]) => {
		const panel = panels[id];
		return panel?.dock === dock && panel.order === order && panel.size === size
			&& panel.autoSize === undefined && panel.tabGroup === undefined && panel.column === undefined;
	})) return panels;
	const next = { ...panels };
	for (const [order, [id]] of ORIGINAL_VIDEO_PANELS.entries()) {
		next[id] = { ...panels[id], dock: 'top', order, size: 320, autoSize: true } as Panel;
	}
	return next;
}

export function normalizeWorkspacePanelAutoSize(value: Readonly<{ autoSize?: unknown }>): Readonly<{ autoSize?: boolean }> {
	if (value.autoSize === undefined) return {};
	if (typeof value.autoSize !== 'boolean') throw new TypeError('Panel automatic sizing must be boolean.');
	return { autoSize: value.autoSize };
}
