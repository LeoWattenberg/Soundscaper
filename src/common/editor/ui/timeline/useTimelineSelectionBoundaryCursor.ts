/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import {
	resolveTimelineSelectionPointerTarget,
	setTimelineSelectionPointerCursor,
	type SelectionPointerEvent,
	type SelectionPointerTargetOptions,
} from './selection-pointer-target.ts';
import type { SelectionBoundaryEdge } from './selection-pointer-edit.ts';

interface SelectionCursorSession {
	readonly kind: string;
	readonly edge?: SelectionBoundaryEdge;
}

export function useTimelineSelectionBoundaryCursor(
	options: SelectionPointerTargetOptions,
	scrollRef: RefObject<HTMLElement | null>,
	pointerSession: RefObject<SelectionCursorSession | null>,
) {
	const hover = useRef<SelectionPointerEvent | null>(null);
	const optionsRef = useRef(options);
	optionsRef.current = options;
	const updateSelectionCursor = useCallback((event: SelectionPointerEvent) => {
		hover.current = {
			target: event.target, clientX: event.clientX, clientY: event.clientY,
			shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
		};
		const session = pointerSession.current;
		const edge = session?.kind === 'selection-resize' ? session.edge ?? null
			: session ? null : resolveTimelineSelectionPointerTarget(event, optionsRef.current)?.edge ?? null;
		setTimelineSelectionPointerCursor(scrollRef.current, edge);
	}, [pointerSession, scrollRef]);
	const clearSelectionCursor = useCallback(() => {
		hover.current = null;
		if (pointerSession.current?.kind !== 'selection-resize') setTimelineSelectionPointerCursor(scrollRef.current, null);
	}, [pointerSession, scrollRef]);
	useEffect(() => {
		const updateModifiers = (event: KeyboardEvent) => {
			if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key) && hover.current) {
				updateSelectionCursor({ ...hover.current,
					shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
				});
			}
		};
		globalThis.addEventListener('keydown', updateModifiers, true);
		globalThis.addEventListener('keyup', updateModifiers, true);
		globalThis.addEventListener('blur', clearSelectionCursor);
		return () => {
			globalThis.removeEventListener('keydown', updateModifiers, true);
			globalThis.removeEventListener('keyup', updateModifiers, true);
			globalThis.removeEventListener('blur', clearSelectionCursor);
			setTimelineSelectionPointerCursor(scrollRef.current, null);
		};
	}, [clearSelectionCursor, scrollRef, updateSelectionCursor]);
	useEffect(() => {
		if (hover.current) updateSelectionCursor(hover.current);
	}, [options, updateSelectionCursor]);
	return { updateSelectionCursor, clearSelectionCursor };
}
