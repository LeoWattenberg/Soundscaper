/* SPDX-License-Identifier: AGPL-3.0-only */

import { shortcutCategoryCopyValue as categoryCopyValue } from '../../../i18n/shortcut-category-copy.js';

export interface ShortcutCategoryMenuEntry {
	readonly id?: string;
	readonly label?: string;
	readonly divider?: boolean;
	readonly shortcutAssignable?: boolean;
	readonly items?: readonly (ShortcutCategoryMenuEntry | null | undefined)[];
}

export interface ShortcutCommandPlacement {
	readonly categoryId: string;
	readonly categoryLabel: string;
	readonly categoryOrder: number;
	readonly order: number;
}

export interface ShortcutPlacementIndexOptions {
	readonly localization?: unknown;
	readonly resolveCanonicalId?: (id: string) => string;
}

/*
 * Commands the running menubar contains are placed where the reader met them:
 * under that menu, in the order the menu lists them. Everything else — toolbar
 * controls, context menus, keyboard-navigation commands — is placed by the first
 * location the pinned action inventory records for it. When that location names
 * a menu the menubar also shows, the command joins that group after its menu
 * rows; otherwise the location becomes a group of its own, and those groups
 * follow the menus in the order the inventory first mentions them.
 */
const INVENTORY_ORDER_BASE = 1_000_000;
const INVENTORY_CATEGORY_ORDER_BASE = 1_000;
const OTHER_CATEGORY_KEY = 'shortcutCategoryOther';
const shortcutCategoryCopyValue = categoryCopyValue as (key: string, localization: unknown) => string;

export interface ShortcutPlacementIndex {
	placementFor(id: string, locations: readonly string[] | undefined, inventoryOrder: number): ShortcutCommandPlacement;
}

/** Index one menubar snapshot so every command can be told which group it belongs to. */
export function createShortcutPlacementIndex(
	menus: readonly (ShortcutCategoryMenuEntry | null | undefined)[] = [],
	{ localization = 'en', resolveCanonicalId = (id: string) => id }: ShortcutPlacementIndexOptions = {},
): ShortcutPlacementIndex {
	const byCommand = new Map<string, ShortcutCommandPlacement>();
	const byCategory = new Map<string, ShortcutCommandPlacement>();
	let order = 0;
	menus.forEach((menu, categoryOrder) => {
		if (!menu?.id) return;
		const categoryId = `menu:${menu.id}`;
		const categoryLabel = menu.label || menu.id;
		byCategory.set(categoryId, { categoryId, categoryLabel, categoryOrder, order: 0 });
		const visit = (items: readonly (ShortcutCategoryMenuEntry | null | undefined)[] = []): void => {
			for (const item of items) {
				if (!item || item.divider || item.shortcutAssignable === false) continue;
				if (item.items?.length) {
					visit(item.items);
					continue;
				}
				if (!item.id) continue;
				const id = resolveCanonicalId(item.id);
				order += 1;
				if (!byCommand.has(id)) byCommand.set(id, { categoryId, categoryLabel, categoryOrder, order });
			}
		};
		visit(menu.items);
	});

	const inventoryCategoryOrder = new Map<string, number>();
	return {
		placementFor(id, locations, inventoryOrder) {
			const menuPlacement = byCommand.get(id);
			if (menuPlacement) return menuPlacement;
			const root = String(locations?.[0] || '').split(' > ')[0].trim();
			const menuCategory = root ? byCategory.get(menuCategoryId(root)) : undefined;
			const categoryId = menuCategory?.categoryId
				|| (root ? `location:${root}` : `location:${OTHER_CATEGORY_KEY}`);
			if (!menuCategory && !inventoryCategoryOrder.has(categoryId)) {
				inventoryCategoryOrder.set(categoryId, INVENTORY_CATEGORY_ORDER_BASE + inventoryCategoryOrder.size);
			}
			return {
				categoryId,
				categoryLabel: menuCategory?.categoryLabel || shortcutCategoryLabel(root, localization),
				categoryOrder: menuCategory?.categoryOrder ?? inventoryCategoryOrder.get(categoryId)!,
				order: INVENTORY_ORDER_BASE + inventoryOrder,
			};
		},
	};
}

/** Map an inventory location root onto the menubar entry that shows the same group. */
export function menuCategoryId(root: string): string {
	return `menu:${root.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}`;
}

/** Name one inventory location root, translated where the catalog carries it. */
export function shortcutCategoryLabel(root: string, localization: unknown): string {
	if (!root) return shortcutCategoryCopyValue(OTHER_CATEGORY_KEY, localization);
	const key = `shortcutCategory${root.split(/[^a-zA-Z0-9]+/u).filter(Boolean)
		.map((part) => part[0].toUpperCase() + part.slice(1)).join('')}`;
	const label = shortcutCategoryCopyValue(key, localization);
	return label === key ? root : label;
}
