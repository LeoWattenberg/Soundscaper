/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef, type RefObject } from 'react';

interface Removal {
	readonly control: HTMLElement;
	readonly effectId: string;
	readonly index: number;
	readonly clipId: string;
}

/** Continue rack authoring after the requested row actually disappears. */
export function useVideoEffectRemovalFocus(rack: RefObject<HTMLElement | null>, clipId: string,
	effects: readonly Readonly<{ id: string }>[], disabled: boolean) {
	const removal = useRef<Removal | null>(null);
	useLayoutEffect(() => {
		const request = removal.current;
		if (!request) return;
		if (request.clipId !== clipId) { removal.current = null; return; }
		if (disabled || effects.some(effect => effect.id === request.effectId)) return;
		removal.current = null;
		const document = request.control.ownerDocument;
		if (document.activeElement !== request.control && document.activeElement !== document.body) return;
		const rows = rack.current?.querySelectorAll<HTMLElement>('[data-video-effect-id]');
		const next = rows?.[Math.min(request.index, effects.length - 1)]?.querySelector<HTMLElement>('[data-video-effect-remove]');
		(next ?? rack.current?.querySelector('[data-video-effect-add]')?.querySelector<HTMLElement>('button'))?.focus();
	}, [clipId, disabled, effects, rack]);
	return (control: HTMLElement, effectId: string, index: number): void => {
		removal.current = control.ownerDocument.activeElement === control ? { control, effectId, index, clipId } : null;
	};
}
