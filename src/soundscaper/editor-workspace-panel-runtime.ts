/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperCaptureUiSnapshot } from '../common/editor/ui/framescaper-capture-ui-model.ts';
import type { WebVcrUiSnapshot } from '../common/editor/ui/web-vcr-ui-model.ts';

const DEFERRED_PANEL_IDS = new Set(['recording-setup', 'web-vcr']);

/** Shared docks pass optional product contexts; Soundscaper needs only the panel ID. */
export function workspacePanelAvailable(
	_productId: string,
	panelId: string,
	_webVcr?: Pick<WebVcrUiSnapshot, 'capability' | 'modeActive'> | null,
	_capture?: Pick<FramescaperCaptureUiSnapshot, 'phase'> | null,
): boolean;
export function workspacePanelAvailable(
	_productId: string,
	panelId: string,
): boolean {
	if (panelId === 'freesound') return true;
	return !DEFERRED_PANEL_IDS.has(panelId);
}

export function workspacePanelRestoresCaptureFocus(_panelId: string): boolean {
	return false;
}
