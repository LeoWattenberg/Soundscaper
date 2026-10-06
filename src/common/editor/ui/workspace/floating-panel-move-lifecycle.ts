/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FloatingWorkspacePanelMove } from './floating-workspace-panel-move.ts';

/** Own one floating panel's pointer session, including keyboard cancellation. */
export function retainFloatingPanelMoveLifecycle(
	target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
	session: { current: FloatingWorkspacePanelMove | null },
): () => void {
	const move = (event: PointerEvent): void => { session.current?.move(event); };
	const finish = (event: PointerEvent): void => {
		if (session.current?.finish(event)) session.current = null;
	};
	const cancel = (event: PointerEvent): void => {
		if (session.current?.cancel(event)) session.current = null;
	};
	const escape = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape' || !session.current) return;
		event.preventDefault(); event.stopPropagation();
		session.current.cancel(); session.current = null;
	};
	target.addEventListener('pointermove', move, { passive: false });
	target.addEventListener('pointerup', finish);
	target.addEventListener('pointercancel', cancel);
	target.addEventListener('keydown', escape);
	return () => {
		target.removeEventListener('pointermove', move);
		target.removeEventListener('pointerup', finish);
		target.removeEventListener('pointercancel', cancel);
		target.removeEventListener('keydown', escape);
		session.current?.cancel(); session.current = null;
	};
}
