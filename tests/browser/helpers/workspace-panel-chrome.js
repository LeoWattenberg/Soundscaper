/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';

/**
 * Every workspace panel header ends in a "…" menu button whose menu moves the
 * panel between docks or closes it. Specs drive both through these helpers
 * rather than reaching for the retired dock <select> and × button. The item
 * labels accept both catalog locales because some specs boot at /de/.
 */
const DOCK_MENU_LABELS = Object.freeze({
	left: /^(?:Left|Links)$/u,
	right: /^(?:Right|Rechts)$/u,
	bottom: /^(?:Bottom|Unten)$/u,
	floating: /^(?:Floating|Schwebend)$/u,
});
const CLOSE_MENU_LABEL = /^(?:Close|Schließen)$/u;

/** The header's overflow menu button for a `[data-workspace-panel]` locator. */
export function workspacePanelMenuButton(panel) {
	return panel.locator('.kw-audio-editor__workspace-panel-header [data-workspace-panel-menu] > button');
}

/** Open a panel's overflow menu and return the menu locator. */
export async function openWorkspacePanelMenu(editor, panelId) {
	const panel = editor.locator(`[data-workspace-panel="${panelId}"]`);
	await workspacePanelMenuButton(panel).click();
	const menu = panel.locator('.kw-audio-editor__workspace-panel-menu');
	await expect(menu).toBeVisible();
	return menu;
}

/** Close a panel through its overflow menu and wait for it to leave the workspace. */
export async function closeWorkspacePanel(editor, panelId) {
	const menu = await openWorkspacePanelMenu(editor, panelId);
	await menu.getByRole('menuitem', { name: CLOSE_MENU_LABEL }).click();
	await expect(editor.locator(`[data-workspace-panel="${panelId}"]`)).toBeHidden();
}

/**
 * Move a panel to another dock through its overflow menu. The panel re-mounts
 * in the target dock, and focus must follow it onto the re-mounted menu button.
 */
export async function dockWorkspacePanel(editor, panelId, dock) {
	const label = DOCK_MENU_LABELS[dock];
	if (!label) throw new Error(`Unknown workspace dock: ${dock}`);
	const menu = await openWorkspacePanelMenu(editor, panelId);
	await menu.getByRole('menuitem', { name: label }).click();
	const moved = editor.locator(`[data-panel-dock="${dock}"] [data-workspace-panel="${panelId}"]`);
	await expect(moved).toBeVisible();
	await expect(workspacePanelMenuButton(moved)).toBeFocused();
}
