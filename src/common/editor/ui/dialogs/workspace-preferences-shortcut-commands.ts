/* SPDX-License-Identifier: AGPL-3.0-only */

import { localizedAudacityParityLabel, localizedAudacityReason } from '../../../i18n/action-parity.js';
import { normalizeBcp47Locale } from '../../../i18n/locale.js';
import {
	AUDACITY_ACTION_MANIFEST,
	AUDACITY_ACTION_STATUS,
	audacityActionDefinition,
	isAudacityShortcutCommandDisabled,
} from '../../audacity-action-parity.js';
import { audacityShortcutCommandUnassignable } from '../../audacity-shortcut-command-inventory.ts';
import { compareCodeUnits } from '../../code-unit-order.ts';
import { createShortcutPlacementIndex } from './workspace-preferences-shortcut-categories.ts';

interface AudacityShortcutActionDefinition {
	readonly id: string;
	readonly label: string;
	readonly status: string;
	readonly menuVisible?: boolean;
	readonly shortcut?: string | null;
	readonly reason?: unknown;
	readonly locations?: readonly string[];
}

interface AudacityShortcutMenuItem {
	readonly id?: string;
	readonly label?: string;
	readonly shortcut?: string;
	readonly disabled?: boolean;
	readonly disabledReason?: string | null;
	readonly divider?: boolean;
	readonly shortcutAssignable?: boolean;
	readonly items?: readonly AudacityShortcutMenuEntry[];
}

type AudacityShortcutMenuEntry = AudacityShortcutMenuItem | null | undefined;

export interface AudacityShortcutCommand {
	readonly id: string;
	readonly preferenceId: string;
	readonly label: string;
	readonly shortcut: string;
	readonly parityStatus: string | null;
	readonly disabled: boolean;
	readonly disabledReason: string | null;
	readonly categoryId: string;
	readonly categoryLabel: string;
	readonly categoryOrder: number;
	readonly order: number;
}

export interface AudacityShortcutCommandOptions {
	readonly locale?: string;
	readonly copy?: unknown;
	readonly disabledCommandIds?: readonly string[];
}

const manifest = AUDACITY_ACTION_MANIFEST as Readonly<Record<string, AudacityShortcutActionDefinition>>;
const definitionFor = (id: string): AudacityShortcutActionDefinition | null => (
	audacityActionDefinition(id) as AudacityShortcutActionDefinition | null
);
const localizedLabel = localizedAudacityParityLabel as (label: string, localization: unknown) => string;
const localizedReason = localizedAudacityReason as (reason: unknown, localization: unknown) => string | null;

/** Build the searchable shortcut inventory only when Preferences is opened. */
export function collectAudacityShortcutCommands(
	menus: readonly AudacityShortcutMenuEntry[],
	{ locale = 'en', copy = null, disabledCommandIds = [] }: AudacityShortcutCommandOptions = {},
): AudacityShortcutCommand[] {
	if (!Array.isArray(menus)) throw new TypeError('menus must be an array.');
	const normalizedLocale = normalizeBcp47Locale(locale);
	const localization = copy || normalizedLocale;
	const placements = createShortcutPlacementIndex(menus, {
		localization,
		resolveCanonicalId: (id) => definitionFor(id)?.id || id,
	});
	const commands = new Map<string, AudacityShortcutCommand>();
	const place = (id: string, locations: readonly string[] | undefined, inventoryOrder: number) => (
		placements.placementFor(id, locations, inventoryOrder)
	);

	let inventoryOrder = 0;
	for (const manifestDefinition of Object.values(manifest)) {
		const definition = definitionFor(manifestDefinition.id) || manifestDefinition;
		inventoryOrder += 1;
		if (definition.status === AUDACITY_ACTION_STATUS.EXCLUDED
			|| definition.menuVisible === false
			|| audacityShortcutCommandUnassignable(definition.id)
			|| audacityShortcutCommandUnassignable(manifestDefinition.id)
			|| isAudacityShortcutCommandDisabled(manifestDefinition.id, disabledCommandIds)) continue;
		const disabled = definition.status === AUDACITY_ACTION_STATUS.DISABLED_UPSTREAM;
		commands.set(definition.id, {
			id: definition.id,
			preferenceId: definition.id,
			label: localizedLabel(definition.label, localization),
			shortcut: definition.shortcut || '',
			parityStatus: definition.status,
			disabled,
			disabledReason: disabled ? localizedReason(definition.reason, localization) : null,
			...place(definition.id, definition.locations, inventoryOrder),
		});
	}

	const visit = (items: readonly AudacityShortcutMenuEntry[] = []): void => {
		for (const item of items) {
			if (!item || item.divider || item.shortcutAssignable === false) continue;
			if (item.items?.length) {
				visit(item.items);
				continue;
			}
			if (!item.id) continue;
			const definition = definitionFor(item.id);
			if (definition?.status === AUDACITY_ACTION_STATUS.EXCLUDED) continue;
			const id = definition?.id || item.id;
			if (audacityShortcutCommandUnassignable(id) || audacityShortcutCommandUnassignable(item.id)) continue;
			if (isAudacityShortcutCommandDisabled(id, disabledCommandIds)) continue;
			const current = commands.get(id);
			const disabled = definition
				? definition.status === AUDACITY_ACTION_STATUS.DISABLED_UPSTREAM
				: Boolean(item.disabled);
			inventoryOrder += 1;
			commands.set(id, {
				...(current || {}),
				id,
				preferenceId: item.id,
				label: item.label || current?.label || id,
				shortcut: item.shortcut || current?.shortcut || '',
				parityStatus: definition?.status || null,
				disabled,
				disabledReason: disabled
					? (item.disabledReason || (definition?.reason
							? localizedReason(definition.reason, localization)
						: null))
					: null,
				...place(id, definition?.locations, inventoryOrder),
			});
		}
	};
	visit(menus);

	return [...commands.values()].sort((left, right) => (
		left.label.localeCompare(right.label, normalizedLocale)
		|| compareCodeUnits(left.id, right.id)
	));
}
