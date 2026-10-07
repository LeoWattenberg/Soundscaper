/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef, type RefObject } from 'react';

interface Request {
	readonly control: HTMLElement;
	readonly id: string;
	readonly owner: unknown;
}

/** Return keyboard authoring only after the requested preset is removed. */
export function usePresetDeletionFocus(bar: RefObject<HTMLDivElement | null>,
	presets: readonly Readonly<{ id: string }>[], selectedId: string, disabled: boolean, owner: unknown): () => void {
	const request = useRef<Request | null>(null);
	useLayoutEffect(() => {
		const pending = request.current;
		if (!pending) return;
		if (!Object.is(pending.owner, owner)) { request.current = null; return; }
		if (disabled || presets.some(preset => preset.id === pending.id)) return;
		request.current = null;
		const document = pending.control.ownerDocument;
		if (document.activeElement !== pending.control && document.activeElement !== document.body) return;
		bar.current?.querySelector<HTMLElement>('.dropdown__trigger')?.focus();
	}, [bar, disabled, owner, presets]);
	return () => {
		const control = bar.current?.querySelectorAll<HTMLElement>('.effect-header__icon-button')[2];
		request.current = selectedId && control && control.ownerDocument.activeElement === control
			? { control, id: selectedId, owner } : null;
	};
}
