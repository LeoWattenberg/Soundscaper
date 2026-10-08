/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef, type RefObject } from 'react';

interface RemovalFocus {
	readonly control: HTMLButtonElement;
	readonly locale: string;
}

export function useTranslationRemovalFocus(locale: string, search: RefObject<HTMLInputElement | null>) {
	const pending = useRef<RemovalFocus | null>(null);
	useLayoutEffect(() => {
		const request = pending.current;
		if (!request) return;
		if (request.locale !== locale) { pending.current = null; return; }
		if (request.control.isConnected && !request.control.hasAttribute('disabled')) return;
		pending.current = null;
		const active = request.control.ownerDocument.activeElement;
		if (active === request.control || active === request.control.ownerDocument.body || !active?.isConnected) {
			search.current?.focus({ preventScroll: true });
		}
	});
	return (control: HTMLButtonElement): void => {
		pending.current = control.ownerDocument.activeElement === control ? { control, locale } : null;
	};
}
