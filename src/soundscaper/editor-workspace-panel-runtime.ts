/* SPDX-License-Identifier: AGPL-3.0-only */

const DEFERRED_PANEL_IDS = new Set(['recording-setup', 'web-vcr']);

export function workspacePanelAvailable(
	_productId: string,
	panelId: string,
): boolean {
	return !DEFERRED_PANEL_IDS.has(panelId);
}

export function workspacePanelRestoresCaptureFocus(_panelId: string): boolean {
	return false;
}
