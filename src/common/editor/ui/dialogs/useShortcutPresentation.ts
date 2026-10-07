/* SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo } from 'react';
import { collectAudacityShortcutCommands, type AudacityShortcutCommand, type AudacityShortcutCommandOptions } from './workspace-preferences-shortcut-commands.ts';
import { groupAudacityShortcutCommands, type ShortcutSortMode } from './workspace-preferences-shortcut-groups.ts';

export function useShortcutCommands(menus: Parameters<typeof collectAudacityShortcutCommands>[0], options: AudacityShortcutCommandOptions, enabled: boolean) {
	const { copy, locale, disabledCommandIds } = options;
	return useMemo(() => enabled ? collectAudacityShortcutCommands(menus, { copy, locale, disabledCommandIds }) : [], [menus, copy, locale, disabledCommandIds, enabled]);
}

export function useShortcutCommandGroups(commands: readonly AudacityShortcutCommand[], query: string, sort: ShortcutSortMode) {
	const searchable = useMemo(() => commands.map(command => ({ command, text: `${command.label} ${command.id}`.toLowerCase() })), [commands]);
	return useMemo(() => {
		const normalized = query.trim().toLowerCase();
		return groupAudacityShortcutCommands(searchable.filter(entry => entry.text.includes(normalized)).map(entry => entry.command), sort);
	}, [searchable, query, sort]);
}
