/* SPDX-License-Identifier: AGPL-3.0-only */

interface MenuFixtureNode<Item> {
	readonly id?: unknown;
	readonly items?: readonly Item[];
}

export function findMenuItem<Item extends MenuFixtureNode<Item>>(
	values: readonly Item[],
	id: string,
): Item | null {
	for (const value of values) {
		if (value.id === id) return value;
		const nested = value.items ? findMenuItem(value.items, id) : null;
		if (nested) return nested;
	}
	return null;
}
