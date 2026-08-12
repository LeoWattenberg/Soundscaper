/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	defineDomainCommandHandlerRegistry,
	type DomainCommandHandlerRegistry,
} from './domain-registry.ts';
import type { AudioEditorCommand, AudioEditorCommandType } from './protocol.ts';

export const TAKE_COMP_COMMAND_TYPES = [
	'take-comp/group-add',
	'take-comp/group-update',
	'take-comp/group-remove',
	'take-comp/flatten',
] as const satisfies readonly AudioEditorCommandType[];

export type TakeCompCommandType = typeof TAKE_COMP_COMMAND_TYPES[number];
export type TakeCompCommand = Extract<AudioEditorCommand, { readonly type: TakeCompCommandType }>;
export type TakeCompCommandHandlers = DomainCommandHandlerRegistry<typeof TAKE_COMP_COMMAND_TYPES>;

export function defineTakeCompCommandHandlers(
	handlers: TakeCompCommandHandlers,
): Readonly<TakeCompCommandHandlers> {
	return defineDomainCommandHandlerRegistry('take-comp', TAKE_COMP_COMMAND_TYPES, handlers);
}
