/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	defineDomainCommandHandlerRegistry,
	type DomainCommandHandlerRegistry,
} from './domain-registry.ts';
import type { AudioEditorCommand, AudioEditorCommandType } from './protocol.ts';

export const AUDIO_WARP_COMMAND_TYPES = [
	'audio-warp/set',
	'audio-warp/clear',
	'audio-warp/quantize',
] as const satisfies readonly AudioEditorCommandType[];

export type AudioWarpCommandType = typeof AUDIO_WARP_COMMAND_TYPES[number];
export type AudioWarpCommand = Extract<AudioEditorCommand, { readonly type: AudioWarpCommandType }>;
export type AudioWarpCommandHandlers = DomainCommandHandlerRegistry<typeof AUDIO_WARP_COMMAND_TYPES>;

export function defineAudioWarpCommandHandlers(
	handlers: AudioWarpCommandHandlers,
): Readonly<AudioWarpCommandHandlers> {
	return defineDomainCommandHandlerRegistry('audio-warp', AUDIO_WARP_COMMAND_TYPES, handlers);
}
