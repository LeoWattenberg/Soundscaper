/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	defineDomainCommandHandlerRegistry,
	type DomainCommandHandlerRegistry,
} from './domain-registry.ts';
import type { AudioEditorCommand, AudioEditorCommandType } from './protocol.ts';

export const TEMPO_SIGNATURE_COMMAND_TYPES = [
	'tempo/set',
	'tempo-map/mode-set',
	'tempo-event/add',
	'tempo-event/update',
	'tempo-event/remove',
	'signature-event/add',
	'signature-event/update',
	'signature-event/remove',
] as const satisfies readonly AudioEditorCommandType[];

export type TempoSignatureCommandType = typeof TEMPO_SIGNATURE_COMMAND_TYPES[number];
export type TempoSignatureCommand = Extract<AudioEditorCommand, { readonly type: TempoSignatureCommandType }>;
export type TempoSignatureCommandHandlers = DomainCommandHandlerRegistry<typeof TEMPO_SIGNATURE_COMMAND_TYPES>;

export function defineTempoSignatureCommandHandlers(
	handlers: TempoSignatureCommandHandlers,
): Readonly<TempoSignatureCommandHandlers> {
	return defineDomainCommandHandlerRegistry('tempo/signature', TEMPO_SIGNATURE_COMMAND_TYPES, handlers);
}
