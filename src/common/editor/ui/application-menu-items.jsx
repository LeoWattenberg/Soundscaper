/* SPDX-License-Identifier: AGPL-3.0-only */

import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';

export const MENU_ITEM_SELECTOR = '[role="menuitem"], [role="menuitemcheckbox"]';
export const DIRECT_MENU_ITEM_SELECTOR = ':scope > [role="menuitem"], :scope > [role="menuitemcheckbox"]';
export const DIRECT_ENABLED_MENU_ITEM_SELECTOR = ':scope > [role="menuitem"]:not([aria-disabled="true"]), :scope > [role="menuitemcheckbox"]:not([aria-disabled="true"])';

/**
 * Renders one application-menu item and its submenu. Activation closes the
 * menu before the item's own handler runs, so a dialog the command opens
 * captures the top-level menu trigger as its return target; `onActivate` then
 * lets the compact chrome drawer close as well.
 */
export function renderApplicationMenuItem(item, key, { closeMenu, onActivate = /** @type {(() => void) | null} */ (null) }) {
	if (item.divider) return <ContextMenuItem key={key} isDivider />;
	const children = item.items?.map((child, index) => (
		renderApplicationMenuItem(child, `${key}-${index}`, { closeMenu, onActivate })
	));
	const activate = item.disabled || typeof item.onClick !== 'function' ? undefined : (...args) => {
		closeMenu();
		onActivate?.();
		return item.onClick(...args);
	};
	const plainLabel = item.disabledReason ? (
		<span title={item.disabledReason} data-disabled-reason={item.disabledReason}>
			{item.label}
			<span className="kw-audio-editor-sr-only"> — {item.disabledReason}</span>
		</span>
	) : item.label;
	const label = item.checked === undefined ? plainLabel : (
		<span data-audio-editor-menu-checked={item.checked ? 'true' : 'false'}>{plainLabel}</span>
	);
	return (
		<ContextMenuItem
			key={item.id || key}
			label={label}
			shortcut={item.shortcut}
			disabled={item.disabled}
			checked={item.checked}
			hasSubmenu={Boolean(children?.length)}
			onClick={activate}
			onClose={() => closeMenu()}
		>
			{children}
		</ContextMenuItem>
	);
}
