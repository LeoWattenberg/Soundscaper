/* SPDX-License-Identifier: AGPL-3.0-only */

import { MUSESCORE_ICON_CODES } from './audacity-iconcodes.js';

export interface CustomToolbarButton {
	readonly id: string;
	readonly name: string;
	readonly icon: string;
	readonly actionId: string;
}

/** User buttons retain their IDs and action bindings across workspace presets. */
export function normalizeCustomToolbarButtons(value: unknown = []): CustomToolbarButton[] {
	if (!Array.isArray(value)) throw new TypeError('workspace.customButtons must be an array.');
	const buttons = (value as unknown[]).map((button, index) => {
		const path = `workspace.customButtons[${index}]`;
		if (!button || typeof button !== 'object' || Array.isArray(button)) {
			throw new TypeError(`${path} must be a plain data object.`);
		}
		const prototype = Object.getPrototypeOf(button) as unknown;
		if (prototype !== Object.prototype && prototype !== null) {
			throw new TypeError(`${path} must be a plain data object.`);
		}
		const id = buttonString(button, 'id', path);
		const name = buttonString(button, 'name', path);
		const icon = buttonString(button, 'icon', path);
		const actionId = buttonString(button, 'actionId', path);
		if (!Object.hasOwn(MUSESCORE_ICON_CODES, icon)) {
			throw new RangeError(`${path}.icon has an unsupported font symbol: ${icon}.`);
		}
		return { id, name, icon, actionId };
	});
	if (new Set(buttons.map(button => button.id)).size !== buttons.length) {
		throw new RangeError('Custom toolbar button IDs must be unique.');
	}
	return buttons;
}

function buttonString(button: object, field: keyof CustomToolbarButton, path: string): string {
	const descriptor = Object.getOwnPropertyDescriptor(button, field);
	if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${path}.${field} must be an enumerable data property.`);
	}
	const value: unknown = descriptor.value;
	if (typeof value !== 'string' || !value.trim()) {
		throw new TypeError(`${path}.${field} must be a non-empty string.`);
	}
	return value.trim();
}
