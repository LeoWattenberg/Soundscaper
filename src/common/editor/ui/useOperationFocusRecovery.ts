/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef } from 'react';

/** Recover an operation's focused control only when disabling it lost focus. */
export function useOperationFocusRecovery(pending: boolean, owner: unknown): () => void {
	const restore = useRef<Readonly<{ target: HTMLElement; owner: unknown }> | null>(null);
	useEffect(() => {
		if (pending) return;
		const captured = restore.current;
		restore.current = null;
		if (!captured || !Object.is(captured.owner, owner) || !captured.target.isConnected) return;
		const document = captured.target.ownerDocument;
		if (document.activeElement === document.body) captured.target.focus();
	}, [owner, pending]);
	return () => {
		if (typeof document === 'undefined' || !(document.activeElement instanceof HTMLElement)) return;
		restore.current = { target: document.activeElement, owner };
	};
}
