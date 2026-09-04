/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from '../../code-unit-order.ts';
import type { AudacityShortcutCommand } from './workspace-preferences-shortcut-commands.ts';

export const SHORTCUT_SORT_MODES = Object.freeze(['categorized', 'alphabetical'] as const);

export type ShortcutSortMode = (typeof SHORTCUT_SORT_MODES)[number];

export interface ShortcutCommandGroup {
	readonly id: string;
	readonly label: string;
	readonly commands: readonly AudacityShortcutCommand[];
}

/** The view the shortcut editor opens on: where a reader would meet each command. */
export const DEFAULT_SHORTCUT_SORT_MODE: ShortcutSortMode = 'categorized';

export function isShortcutSortMode(value: unknown): value is ShortcutSortMode {
	return SHORTCUT_SORT_MODES.includes(value as ShortcutSortMode);
}

/**
 * Arrange the command inventory for one of the two views. The alphabetical view
 * is a single unlabelled run; the categorized view keeps each command under the
 * menu or surface it appears in, in that surface's own order.
 */
export function groupAudacityShortcutCommands(
	commands: readonly AudacityShortcutCommand[],
	mode: ShortcutSortMode = DEFAULT_SHORTCUT_SORT_MODE,
): ShortcutCommandGroup[] {
	if (mode !== 'categorized') return commands.length ? [{ id: 'all', label: '', commands }] : [];
	const groups = new Map<string, { order: number; label: string; commands: AudacityShortcutCommand[] }>();
	for (const command of commands) {
		const group = groups.get(command.categoryId) || {
			order: command.categoryOrder,
			label: command.categoryLabel,
			commands: [],
		};
		group.commands.push(command);
		groups.set(command.categoryId, group);
	}
	return [...groups]
		.sort(([leftId, left], [rightId, right]) => left.order - right.order || compareCodeUnits(leftId, rightId))
		.map(([id, group]) => ({
			id,
			label: group.label,
			commands: group.commands.sort((left, right) => (
				left.order - right.order || compareCodeUnits(left.id, right.id)
			)),
		}));
}
