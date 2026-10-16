/* SPDX-License-Identifier: AGPL-3.0-only */

import { retainAudioEditorDialogEscapeOwner } from './dialog-escape-ownership.ts';

/** A title move owns dismissal until it completes or restores its starting offset. */
export function retainDialogMoveLifecycle(
	document: Document,
	window: Window,
	callbacks: Readonly<{
		move(event: MouseEvent): void;
		finish(): void;
		cancel(): void;
	}>,
): () => void {
	let active = true;
	const move = (event: MouseEvent) => { if (active) callbacks.move(event); };
	const release = () => {
		if (!active) return;
		active = false;
		releaseEscape();
		window.removeEventListener('mousemove', move);
		window.removeEventListener('mouseup', finish);
	};
	const finish = (event: MouseEvent) => {
		if (!active || event.button !== 0) return;
		release();
		callbacks.finish();
	};
	const releaseEscape = retainAudioEditorDialogEscapeOwner(document, () => {
		release();
		callbacks.cancel();
	});
	window.addEventListener('mousemove', move);
	window.addEventListener('mouseup', finish);
	return release;
}
