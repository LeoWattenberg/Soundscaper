/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	defineDomainCommandHandlerRegistry,
	type DomainCommandHandlerRegistry,
} from './domain-registry.ts';
import type { AudioEditorCommand, AudioEditorCommandType } from './protocol.ts';

export const SEQUENCE_TIMING_COMMAND_TYPES = [
	'sequence/update',
] as const satisfies readonly AudioEditorCommandType[];

export type SequenceTimingCommandType = typeof SEQUENCE_TIMING_COMMAND_TYPES[number];
export type SequenceTimingCommand = Extract<AudioEditorCommand, { readonly type: SequenceTimingCommandType }>;
export type SequenceTimingCommandHandlers = DomainCommandHandlerRegistry<typeof SEQUENCE_TIMING_COMMAND_TYPES>;

export function defineSequenceTimingCommandHandlers(
	handlers: SequenceTimingCommandHandlers,
): Readonly<SequenceTimingCommandHandlers> {
	return defineDomainCommandHandlerRegistry('sequence timing', SEQUENCE_TIMING_COMMAND_TYPES, handlers);
}
