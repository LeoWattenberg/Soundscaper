/* SPDX-License-Identifier: AGPL-3.0-only */

import { workspacePanelRestoresCaptureFocus } from './workspace-product-panel-runtime.ts';

export function closePanelAndRestoreFocus(event, panelId, onTogglePanel) {
	const ownerDocument = event.currentTarget.ownerDocument;
	onTogglePanel(panelId);
	if (!workspacePanelRestoresCaptureFocus(panelId)) return;
	let attempts = 4;
	const restore = () => {
		const trigger = ownerDocument.querySelector('[data-transport="framescaper-record"] button');
		if (trigger instanceof HTMLElement) {
			trigger.focus();
			return;
		}
		attempts -= 1;
		if (attempts > 0) requestAnimationFrame(restore);
	};
	requestAnimationFrame(restore);
}
