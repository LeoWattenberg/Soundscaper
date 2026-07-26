/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	defineDomainCommandHandlerRegistry,
	type DomainCommandHandlerRegistry,
} from './domain-registry.ts';
import type { AudioEditorCommand, AudioEditorCommandType } from './protocol.ts';

export const EFFECTS_VIDEO_COMMAND_TYPES = [
	'effect/add',
	'effect/update',
	'effect/remove',
	'effect/reorder',
	'video-effect/add',
	'video-effect/update',
	'video-effect/remove',
	'video-effect/reorder',
] as const satisfies readonly AudioEditorCommandType[];

export type EffectsVideoCommandType = typeof EFFECTS_VIDEO_COMMAND_TYPES[number];
export type EffectsVideoCommand = Extract<AudioEditorCommand, { readonly type: EffectsVideoCommandType }>;
export type EffectsVideoCommandHandlers = DomainCommandHandlerRegistry<typeof EFFECTS_VIDEO_COMMAND_TYPES>;

export function defineEffectsVideoCommandHandlers(
	handlers: EffectsVideoCommandHandlers,
): Readonly<EffectsVideoCommandHandlers> {
	return defineDomainCommandHandlerRegistry('effects/video', EFFECTS_VIDEO_COMMAND_TYPES, handlers);
}
