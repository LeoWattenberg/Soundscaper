/* SPDX-License-Identifier: AGPL-3.0-only */

import { retainAudioEditorDialogEscapeOwner } from './dialog-escape-ownership.ts';

export function retainResizableSurfaceMouseLifecycle(
	document: Document,
	callbacks: Readonly<{
		move(event: MouseEvent): void;
		finish(): void;
		cancel(): void;
	}>,
): () => void {
	const releaseEscape = retainAudioEditorDialogEscapeOwner(document, callbacks.cancel);
	document.addEventListener('mousemove', callbacks.move);
	document.addEventListener('mouseup', callbacks.finish);
	return () => {
		releaseEscape();
		document.removeEventListener('mousemove', callbacks.move);
		document.removeEventListener('mouseup', callbacks.finish);
		callbacks.cancel();
	};
}
