/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, type RefObject } from 'react';

/**
 * The design-system ContextMenu closes itself on any pointerdown outside the
 * menu, and the button that opened it counts as outside. Without a guard the
 * click that follows that pointerdown reopens the menu, so a pointer user can
 * never close a menu with its own trigger.
 *
 * The listener is registered once at mount, ahead of the menu's per-open
 * listener in the document's capture order, so it still observes the open
 * state when the trigger is pressed. The returned function reports (and
 * clears) whether the click being handled is the tail of such a dismissal.
 */
export function useMenuTriggerDismissal(
	triggerRef: RefObject<Element | null>,
	isOpen: boolean,
): () => boolean {
	const openRef = useRef(isOpen);
	openRef.current = isOpen;
	const dismissedRef = useRef(false);
	useEffect(() => {
		const ownerDocument = triggerRef.current?.ownerDocument ?? globalThis.document;
		if (typeof ownerDocument?.addEventListener !== 'function') return undefined;
		const remember = (event: Event) => {
			dismissedRef.current = openRef.current && containsTarget(triggerRef.current, event.target);
		};
		ownerDocument.addEventListener('pointerdown', remember, true);
		return () => ownerDocument.removeEventListener('pointerdown', remember, true);
	}, [triggerRef]);
	return () => {
		const dismissed = dismissedRef.current;
		dismissedRef.current = false;
		return dismissed;
	};
}

function containsTarget(trigger: Element | null, target: EventTarget | null): boolean {
	if (!trigger || !target || typeof target !== 'object') return false;
	try {
		return trigger.contains(target as Node);
	} catch {
		return false;
	}
}
