/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, type RefObject } from 'react';

/** Removal keeps keyboard use in its surviving preset picker. */
export function useAuthoringPresetRemovalFocus(
	container: RefObject<HTMLElement | null>, owner: unknown, pending: boolean, blocked: boolean,
) {
	const request = useRef<Readonly<{ owner: unknown; control: HTMLElement; picker: string }> | null>(null);
	useEffect(() => {
		if (pending) return;
		const captured = request.current;
		request.current = null;
		if (!captured || captured.owner !== owner || blocked) return;
		if (captured.control.ownerDocument.activeElement !== captured.control.ownerDocument.body) return;
		container.current?.querySelector<HTMLElement>(captured.picker)?.focus();
	}, [blocked, container, owner, pending]);
	return (operation: string): void => {
		if (operation !== 'remove-visual' && operation !== 'remove-finishing') return;
		const kind = operation === 'remove-visual' ? 'visual' : 'finishing';
		const control = container.current?.querySelector<HTMLElement>(`[data-framescaper-authoring-remove-${kind}]`);
		if (control && control.ownerDocument.activeElement === control) {
			request.current = { owner, control, picker: `[data-framescaper-authoring-${kind}-preset]` };
		}
	};
}
