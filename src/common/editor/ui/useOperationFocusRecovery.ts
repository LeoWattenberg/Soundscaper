/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef } from 'react';

/** Recover focus lost by an operation, optionally replacing a removed control. */
export function useOperationFocusRecovery(pending: boolean, owner: unknown): (fallback?: () => HTMLElement | null) => void {
	const restore = useRef<Readonly<{ target: HTMLElement; owner: unknown; fallback?: () => HTMLElement | null }> | null>(null);
	useEffect(() => {
		if (pending) return;
		const captured = restore.current;
		restore.current = null;
		if (!captured || !Object.is(captured.owner, owner)) return;
		const document = captured.target.ownerDocument;
		if (document.activeElement !== document.body) return;
		const target = captured.target.isConnected ? captured.target : captured.fallback?.();
		if (target?.isConnected) target.focus();
	}, [owner, pending]);
	return (fallback) => {
		if (typeof document === 'undefined' || !(document.activeElement instanceof HTMLElement)) return;
		restore.current = { target: document.activeElement, owner, fallback };
	};
}
