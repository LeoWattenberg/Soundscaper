/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef, type RefObject } from 'react';

interface Request {
	readonly control: HTMLButtonElement;
	readonly id: string;
	readonly owner: unknown;
}

/** Recover only keyboard focus lost when this custom layout actually disappears. */
export function useWorkspaceDeletionFocus(picker: RefObject<HTMLDivElement | null>,
	workspaces: readonly unknown[], owner: unknown) {
	const pending = useRef<Request | null>(null);
	useLayoutEffect(() => {
		const request = pending.current;
		if (!request) return;
		if (!Object.is(request.owner, owner)) { pending.current = null; return; }
		if (workspaces.some(value => value && typeof value === 'object' && 'id' in value && value.id === request.id)) return;
		pending.current = null;
		const document = request.control.ownerDocument;
		if (document.activeElement !== request.control && document.activeElement !== document.body) return;
		picker.current?.querySelector<HTMLElement>('.dropdown__trigger')?.focus({ preventScroll: true });
	});
	return (control: HTMLButtonElement, id: unknown): void => {
		pending.current = typeof id === 'string' && control.ownerDocument.activeElement === control
			? { control, id, owner } : null;
	};
}
