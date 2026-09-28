/* SPDX-License-Identifier: AGPL-3.0-only */

import { LOCAL_ASSISTANCE_MENU_ICON } from './assistance-task-catalog.ts';

interface LocalAssistanceMenuInput {
	readonly desktopAvailable: boolean;
	readonly capabilityActive: boolean;
	readonly copy: Readonly<{
		localAssistance?: string;
		advancedLocalProcessing?: string;
		'assistance-search'?: string;
		localAssistanceIndexedSearch?: string;
	}>;
}

interface LocalAssistanceMenuActions {
	readonly open?: () => void;
	readonly openIndexedSearch?: () => void;
}

interface LocalAssistanceMenuEntry {
	readonly id: string;
	readonly label: string;
	readonly icon?: string;
	readonly onClick?: () => void;
	readonly items?: readonly LocalAssistanceMenuEntry[];
}

export function createLocalAssistanceMenuItems(
	input: LocalAssistanceMenuInput,
	actions: LocalAssistanceMenuActions,
): readonly LocalAssistanceMenuEntry[] {
	if (!input.desktopAvailable || !input.capabilityActive || typeof actions.open !== 'function') {
		return Object.freeze([]);
	}
	return Object.freeze([Object.freeze({
		id: 'local-assistance',
		label: input.copy.advancedLocalProcessing || 'Advanced Local Processing',
		icon: LOCAL_ASSISTANCE_MENU_ICON,
		onClick: () => actions.open?.(),
	}), ...(typeof actions.openIndexedSearch === 'function' ? [Object.freeze({
		id: 'assistance-search',
		label: input.copy['assistance-search'] || 'Search',
		items: [Object.freeze({
		id: 'local-assistance-indexed-search',
		label: input.copy.localAssistanceIndexedSearch || 'Indexed Search',
		icon: LOCAL_ASSISTANCE_MENU_ICON,
		onClick: actions.openIndexedSearch,
	})],
	})] : [])]);
}
