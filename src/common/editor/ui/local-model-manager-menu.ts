/* SPDX-License-Identifier: AGPL-3.0-only */

interface LocalModelManagerMenuCopy {
	readonly localModels?: string;
	readonly manageLocalModels?: string;
}

interface LocalModelManagerMenuInput {
	readonly desktopAvailable: boolean;
	readonly copy: LocalModelManagerMenuCopy;
}

interface LocalModelManagerMenuActions {
	readonly open?: () => void;
}

export function createLocalModelManagerMenuItems(
	input: LocalModelManagerMenuInput,
	actions: LocalModelManagerMenuActions,
) {
	if (!input.desktopAvailable || typeof actions.open !== 'function') return Object.freeze([]);
	return Object.freeze([Object.freeze({
		id: 'local-models',
		label: input.copy.localModels || 'Local Models',
		items: Object.freeze([Object.freeze({
			id: 'manage-local-models',
			label: `${input.copy.manageLocalModels || 'Manage Models'}…`,
			onClick: actions.open,
		})]),
	})]);
}
