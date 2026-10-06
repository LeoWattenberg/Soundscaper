/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef, type RefObject } from 'react';

interface DeletedBandFocus {
	readonly control: HTMLElement;
	readonly targetId: string | null;
	readonly owner: string;
}

/** Hand keyboard editing to a surviving band after the removed handle disappears. */
export function useParametricEqBandDeletionFocus({ graphRef, bands, disabled, owner }: Readonly<{
	graphRef: RefObject<HTMLElement | null>;
	bands: readonly Readonly<{ id: string }>[];
	disabled: boolean;
	owner: string;
}>): (control: HTMLElement, targetId: string | null) => void {
	const pending = useRef<DeletedBandFocus | null>(null);
	useLayoutEffect(() => {
		const request = pending.current;
		const graph = graphRef.current;
		if (!request || !graph) return;
		if (request.owner !== owner) { pending.current = null; return; }
		if (disabled || request.control.isConnected) return;
		pending.current = null;
		const active = graph.ownerDocument.activeElement;
		if (active !== graph.ownerDocument.body && active !== request.control) return;
		const handles = [...graph.querySelectorAll<HTMLButtonElement>('[data-band-id]')];
		const target = handles.find((handle) => handle.dataset.bandId === request.targetId);
		(target ?? graph).focus({ preventScroll: true });
	}, [bands, disabled, graphRef, owner]);
	return (control, targetId) => { pending.current = { control, targetId, owner }; };
}
