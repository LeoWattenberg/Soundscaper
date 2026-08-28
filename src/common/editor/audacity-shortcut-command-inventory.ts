/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from './code-unit-order.ts';

interface AudacityShortcutActionDefinition {
	readonly id: string;
	readonly label: string;
	readonly status: string;
	readonly menuVisible?: boolean;
	readonly shortcut?: string | null;
	readonly reason?: unknown;
	readonly handler?: string | null;
	readonly locations?: readonly string[];
}

interface AudacityShortcutMenuItem {
	readonly id?: string;
	readonly label?: string;
	readonly shortcut?: string;
	readonly disabled?: boolean;
	readonly disabledReason?: string | null;
	readonly divider?: boolean;
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
}

export interface AudacityShortcutCommandOptions {
	readonly locale?: string;
	readonly copy?: unknown;
	readonly disabledCommandIds?: readonly string[];
}

interface AudacityShortcutCommandDependencies {
	readonly manifest: Readonly<Record<string, AudacityShortcutActionDefinition>>;
	readonly status: Readonly<{
		readonly EXCLUDED: string;
		readonly DISABLED_UPSTREAM: string;
	}>;
	readonly normalizeLocale: (locale: string) => string;
	readonly localizedLabel: (label: string, localization: unknown) => string;
	readonly localizedReason: (reason: unknown, localization: unknown) => string | null;
	readonly resolveDefinition: (id: string) => AudacityShortcutActionDefinition | null;
}

export interface AudacityShortcutCommandInventory {
	collectAudacityShortcutCommands(
		menus: readonly AudacityShortcutMenuEntry[],
		options?: AudacityShortcutCommandOptions,
	): AudacityShortcutCommand[];
	isAudacityShortcutCommandDisabled(
		id: string,
		disabledCommandIds?: readonly string[],
	): boolean;
}

const SHORTCUT_CONTAINER_ACTION_IDS: ReadonlySet<string> = new Set(['menu-align', 'menu-sort']);

/** Own the product-aware shortcut inventory without growing the pinned action manifest. */
export function createAudacityShortcutCommandInventory(
	dependencies: AudacityShortcutCommandDependencies,
): AudacityShortcutCommandInventory {
	const isAudacityShortcutCommandDisabled = (
		id: string,
		disabledCommandIds: readonly string[] = [],
	): boolean => {
		const definition = dependencies.resolveDefinition(id);
		const canonicalId = definition?.id || id;
		if (SHORTCUT_CONTAINER_ACTION_IDS.has(canonicalId)) return true;
		const disabled = new Set(disabledCommandIds);
		if (disabled.has(canonicalId) || disabled.has(id)) return true;
		if (!definition) return false;
		const handler = definition.handler || '';
		const locations = definition.locations || [];
		const hasLocation = (root: string): boolean => locations.some((location) => (
			location === root || location.startsWith(`${root} >`)
		));
		if (disabled.has('record') && handler.startsWith('recording.')) return true;
		if (disabled.has('generate') && (
			handler.startsWith('generators.') || handler === 'effects.openGenerator' || hasLocation('Generate')
		)) return true;
		if (disabled.has('selection-effect') && (
			handler.startsWith('effects.') || hasLocation('Effect') || hasLocation('Realtime effect rack')
		)) return true;
		if (disabled.has('spectral-edit') && (
			handler.startsWith('spectral.') || canonicalId.includes('spectral')
			|| locations.some((location) => location.includes('Spectral'))
		)) return true;
		if (disabled.has('analyze') && (handler.startsWith('analysis.') || hasLocation('Analyze'))) return true;
		if (disabled.has('manage-macros') && handler.startsWith('macros.')) return true;
		return disabled.has('nyquist-prompt') && handler.startsWith('nyquist.');
	};

	const collectAudacityShortcutCommands = (
		menus: readonly AudacityShortcutMenuEntry[],
		{ locale = 'en', copy = null, disabledCommandIds = [] }: AudacityShortcutCommandOptions = {},
	): AudacityShortcutCommand[] => {
		if (!Array.isArray(menus)) throw new TypeError('menus must be an array.');
		const normalizedLocale = dependencies.normalizeLocale(locale);
		const localization = copy || normalizedLocale;
		const commands = new Map<string, AudacityShortcutCommand>();

		for (const definition of Object.values(dependencies.manifest)) {
			if (definition.status === dependencies.status.EXCLUDED
				|| definition.menuVisible === false
				|| isAudacityShortcutCommandDisabled(definition.id, disabledCommandIds)) continue;
			const disabled = definition.status === dependencies.status.DISABLED_UPSTREAM;
			commands.set(definition.id, {
				id: definition.id,
				preferenceId: definition.id,
				label: dependencies.localizedLabel(definition.label, localization),
				shortcut: definition.shortcut || '',
				parityStatus: definition.status,
				disabled,
				disabledReason: disabled
					? dependencies.localizedReason(definition.reason, localization)
					: null,
			});
		}

		const visit = (items: readonly AudacityShortcutMenuEntry[] = []): void => {
			for (const item of items) {
				if (!item || item.divider) continue;
				if (item.items?.length) {
					visit(item.items);
					continue;
				}
				if (!item.id) continue;
				const definition = dependencies.resolveDefinition(item.id);
				if (definition?.status === dependencies.status.EXCLUDED) continue;
				const id = definition?.id || item.id;
				if (isAudacityShortcutCommandDisabled(id, disabledCommandIds)) continue;
				const current = commands.get(id);
				const disabled = definition
					? definition.status === dependencies.status.DISABLED_UPSTREAM
					: Boolean(item.disabled);
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
							? dependencies.localizedReason(definition.reason, localization)
							: null))
						: null,
				});
			}
		};
		visit(menus);

		return [...commands.values()].sort((left, right) => (
			left.label.localeCompare(right.label, normalizedLocale)
			|| compareCodeUnits(left.id, right.id)
		));
	};

	return Object.freeze({
		collectAudacityShortcutCommands,
		isAudacityShortcutCommandDisabled,
	});
}
