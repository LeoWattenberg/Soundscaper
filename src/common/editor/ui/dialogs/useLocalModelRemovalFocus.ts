/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { LocalModelManagerModel } from '../local-model-manager-bridge.ts';

/** Keep keyboard removal on a surviving row action, or the model search. */
export function useLocalModelRemovalFocus(container: RefObject<HTMLDivElement | null>,
	models: readonly LocalModelManagerModel[], busyIds: readonly string[]) {
	const request = useRef<Readonly<{ control: HTMLButtonElement; modelId: string }> | null>(null);
	useLayoutEffect(() => {
		const captured = request.current;
		if (!captured || busyIds.includes(captured.modelId)) return;
		request.current = null;
		if (models.find(model => model.modelId === captured.modelId)?.installedBytes !== null) return;
		const document = captured.control.ownerDocument;
		if (document.activeElement !== captured.control && document.activeElement !== document.body) return;
		const row = [...(container.current?.querySelectorAll<HTMLElement>('[data-local-model-id]') ?? [])]
			.find(element => element.getAttribute('data-local-model-id') === captured.modelId);
		(row?.querySelector<HTMLElement>('button:not([disabled])')
			?? container.current?.querySelector<HTMLElement>('.search-field__input'))?.focus({ preventScroll: true });
	}, [busyIds, container, models]);
	return (modelId: string, control: HTMLButtonElement): void => {
		request.current = control.ownerDocument.activeElement === control ? { control, modelId } : null;
	};
}
