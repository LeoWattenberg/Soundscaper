/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useLayoutEffect, useRef } from 'react';

import { retainAudioEditorDialogEscapeOwner } from '../dialog-escape-ownership.ts';
import { resolveEditorReturnFocus } from '../focus-restoration.ts';

const FOCUSABLE_SELECTOR = [
	'button:not([disabled])',
	'[href]',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * The compact layout's chrome drawer: a side panel that holds the application
 * menubar, the action bar and the tool toolbar while a narrow viewport shows
 * only the compact bar. It is not a modal dialog. Its content stays mounted
 * (inert and hidden) while closed so the menubar's refs, access keys and
 * arrow-key navigation keep working, and Escape ownership is shared with the
 * editor dialogs so the newest open surface closes first.
 */
export default function WorkspaceChromeDrawer({
	children,
	closeLabel,
	id,
	label,
	onClose,
	open,
	toggleRef = null,
}) {
	const containerRef = useRef(null);
	const panelRef = useRef(null);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	// The drawer is fixed to the viewport so its scrollable height is exactly
	// what is visible, and it hangs from the header it lives in, whose bottom
	// edge depends on the site shell above the editor.
	useLayoutEffect(() => {
		const container = containerRef.current;
		const header = container?.parentElement;
		if (!open || !container || !header?.getBoundingClientRect) return undefined;
		const place = () => {
			const rect = header.getBoundingClientRect();
			container.style.setProperty('--chrome-drawer-top', `${rect.bottom}px`);
			container.style.setProperty('--chrome-drawer-left', `${rect.left}px`);
			container.style.setProperty('--chrome-drawer-width', `${rect.width}px`);
		};
		place();
		const view = header.ownerDocument?.defaultView;
		view?.addEventListener?.('resize', place);
		return () => view?.removeEventListener?.('resize', place);
	}, [open]);

	// The application menu's capture-phase Escape handler prevents default
	// first while a menu is open, so this owner only sees Escape once the menu
	// is gone.
	useEffect(() => {
		const panel = panelRef.current;
		if (!open || !panel) return undefined;
		return retainAudioEditorDialogEscapeOwner(panel.ownerDocument, () => onCloseRef.current?.());
	}, [open]);

	const wasOpenRef = useRef(false);
	useLayoutEffect(() => {
		const panel = panelRef.current;
		if (open && !wasOpenRef.current) {
			const first = panel?.querySelector(FOCUSABLE_SELECTOR);
			(first || panel)?.focus?.({ preventScroll: true });
		} else if (!open && wasOpenRef.current) {
			const ownerDocument = panel?.ownerDocument;
			const target = toggleRef?.current
				|| (ownerDocument ? resolveEditorReturnFocus(ownerDocument, null) : null);
			target?.focus?.({ preventScroll: true });
		}
		wasOpenRef.current = open;
	}, [open, toggleRef]);

	// Focus leaving the drawer for anything other than the open application
	// menu or the toggle (whose own click closes it) dismisses the drawer.
	const onBlur = (event) => {
		if (!open) return;
		const next = event.relatedTarget;
		if (!(next instanceof Element)) return;
		if (event.currentTarget.contains(next)) return;
		if (next === toggleRef?.current) return;
		if (next.closest('.kw-audio-editor__application-menu')) return;
		onCloseRef.current?.();
	};

	return (
		<div ref={containerRef} className="kw-audio-editor__chrome-drawer" data-chrome-drawer data-open={open ? 'true' : 'false'}>
			<button
				type="button"
				className="kw-audio-editor__chrome-drawer-scrim"
				aria-label={closeLabel}
				tabIndex={-1}
				onClick={() => onCloseRef.current?.()}
			/>
			<div
				ref={panelRef}
				id={id}
				className="kw-audio-editor__chrome-drawer-panel"
				role="group"
				aria-label={label}
				aria-hidden={open ? undefined : 'true'}
				inert={!open}
				tabIndex={-1}
				onBlur={onBlur}
			>
				{children}
			</div>
		</div>
	);
}
