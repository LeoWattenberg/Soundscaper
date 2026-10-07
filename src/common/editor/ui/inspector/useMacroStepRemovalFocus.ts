/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef, type RefObject } from 'react';

interface Removal {
	readonly control: HTMLElement;
	readonly effectId: string;
	readonly index: number;
}

/** Continue step authoring after the requested row has disappeared. */
export function useMacroStepRemovalFocus(list: RefObject<HTMLElement | null>,
	effects: readonly Readonly<{ id: string }>[]) {
	const removal = useRef<Removal | null>(null);
	useLayoutEffect(() => {
		const request = removal.current;
		if (!request || effects.some(effect => effect.id === request.effectId)) return;
		removal.current = null;
		const document = request.control.ownerDocument;
		if (document.activeElement !== request.control && document.activeElement !== document.body) return;
		const rows = list.current?.querySelectorAll<HTMLElement>('.effect-slot');
		(rows?.[Math.min(request.index, effects.length - 1)]
			?? list.current?.querySelector<HTMLElement>('[data-macro-add-effect]'))?.focus();
	}, [effects, list]);
	return (effectId: string, index: number): void => {
		const control = list.current?.ownerDocument.activeElement;
		removal.current = control instanceof HTMLElement
			&& (list.current?.contains(control) || control.getAttribute('role') === 'menuitem')
			? { control, effectId, index } : null;
	};
}
