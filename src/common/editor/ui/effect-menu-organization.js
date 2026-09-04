/* SPDX-License-Identifier: AGPL-3.0-only */

import { EFFECT_MENU_GROUPS } from './application-menu-model.js';

/**
 * The Effect menu's effect entries, either as category submenus or as one
 * alphabetical list.
 *
 * @param {{organization?: string, copy: Record<string, string>, effectLabels: Map<string, string>, productId: string, disabled: boolean, locale?: string}} context
 * @param {(type: string) => unknown} openSelectionEffect
 * @returns {object[]} menu entries to splice into the Effect menu
 */
export function createEffectMenuEntries(context, openSelectionEffect) {
	const { organization, copy, effectLabels, productId, disabled, locale } = context;
	const admitted = (type) => effectLabels.has(type)
		&& (type !== 'reviewed-utility-gain' || productId === 'soundscaper');
	const entry = (type) => ({
		id: type,
		label: effectLabels.get(type),
		disabled,
		onClick: () => openSelectionEffect(type),
	});
	if (organization === 'sortby:name') {
		return EFFECT_MENU_GROUPS
			.flatMap(([, types]) => types)
			.filter(admitted)
			.map(entry)
			.sort((left, right) => left.label.localeCompare(right.label, locale || 'en'));
	}
	return EFFECT_MENU_GROUPS.map(([labelKey, types]) => ({
		id: labelKey,
		label: copy[labelKey],
		items: types.filter(admitted).map(entry),
	})).filter((group) => group.items.length);
}
