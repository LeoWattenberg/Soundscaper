/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef, type RefObject } from 'react';

interface Removal {
	readonly control: HTMLElement;
	readonly projectId: string | null;
	readonly groupId: string;
}

/** Keep the surviving take picker or Close usable after the removed editor leaves. */
export function useTakeCompRemovalFocus(editor: RefObject<HTMLElement | null>,
	close: RefObject<HTMLElement | null>, projectId: string | null,
	groups: readonly Readonly<{ id: string }>[], disabled: boolean) {
	const removal = useRef<Removal | null>(null);
	useLayoutEffect(() => {
		const request = removal.current;
		if (!request) return;
		if (request.projectId !== projectId) { removal.current = null; return; }
		if (disabled || groups.some(group => group.id === request.groupId)) return;
		removal.current = null;
		const document = request.control.ownerDocument;
		if (document.activeElement !== request.control && document.activeElement !== document.body) return;
		(editor.current?.querySelector<HTMLElement>('[data-take-comp-group]')
			?? close.current?.querySelector<HTMLElement>('button'))?.focus();
	}, [close, disabled, editor, groups, projectId]);
	return (control: HTMLElement, groupId: string): void => {
		removal.current = control.ownerDocument.activeElement === control ? { control, projectId, groupId } : null;
	};
}
