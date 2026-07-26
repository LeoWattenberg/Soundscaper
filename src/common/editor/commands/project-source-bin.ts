/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	defineDomainCommandHandlerRegistry,
	type DomainCommandHandlerRegistry,
} from './domain-registry.ts';
import type { AudioEditorCommand, AudioEditorCommandType } from './protocol.ts';

export const PROJECT_SOURCE_BIN_COMMAND_TYPES = [
	'batch',
	'project/rename',
	'selection/set',
	'loop/set',
	'snap/set',
	'tempo/set',
	'time-display/set',
	'metadata/update',
	'source/add',
	'source/remove',
	'source/update',
	'project-bin/add',
	'project-bin/move-from-timeline',
	'project-bin/place',
	'project-bin/update',
	'project-bin/remove',
	'project-bin/remove-from-project',
	'project-bin/replace-media',
] as const satisfies readonly AudioEditorCommandType[];

export type ProjectSourceBinCommandType = typeof PROJECT_SOURCE_BIN_COMMAND_TYPES[number];
export type ProjectSourceBinCommand = Extract<AudioEditorCommand, { readonly type: ProjectSourceBinCommandType }>;
export type ProjectSourceBinCommandHandlers = DomainCommandHandlerRegistry<typeof PROJECT_SOURCE_BIN_COMMAND_TYPES>;

export function defineProjectSourceBinCommandHandlers(
	handlers: ProjectSourceBinCommandHandlers,
): Readonly<ProjectSourceBinCommandHandlers> {
	return defineDomainCommandHandlerRegistry('project/source/bin', PROJECT_SOURCE_BIN_COMMAND_TYPES, handlers);
}
