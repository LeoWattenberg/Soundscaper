/* SPDX-License-Identifier: AGPL-3.0-only */

interface LocalAssistanceMenuInput {
	readonly desktopAvailable: boolean;
	readonly capabilityActive: boolean;
	readonly copy: Readonly<{
		localAssistance?: string;
		localAssistanceIndexedSearch?: string;
	}>;
}

interface LocalAssistanceMenuActions {
	readonly open?: () => void;
	readonly openIndexedSearch?: () => void;
}

export function createLocalAssistanceMenuItems(
	input: LocalAssistanceMenuInput,
	actions: LocalAssistanceMenuActions,
) {
	if (!input.desktopAvailable || !input.capabilityActive || typeof actions.open !== 'function') {
		return Object.freeze([]);
	}
	return Object.freeze([Object.freeze({
		id: 'local-assistance',
		label: `${input.copy.localAssistance || 'Local Assistance'}…`,
		onClick: actions.open,
	}), ...(typeof actions.openIndexedSearch === 'function' ? [Object.freeze({
		id: 'local-assistance-indexed-search',
		label: `${input.copy.localAssistanceIndexedSearch || 'Indexed Search'}…`,
		onClick: actions.openIndexedSearch,
	})] : [])]);
}
