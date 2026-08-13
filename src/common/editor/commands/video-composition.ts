/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	defineDomainCommandHandlerRegistry,
	type DomainCommandHandlerRegistry,
} from './domain-registry.ts';
import type { AudioEditorCommand, AudioEditorCommandType } from './protocol.ts';

export const VIDEO_COMPOSITION_COMMAND_TYPES = [
	'video-composition/set',
] as const satisfies readonly AudioEditorCommandType[];

export type VideoCompositionCommandType = typeof VIDEO_COMPOSITION_COMMAND_TYPES[number];
export type VideoCompositionCommand = Extract<
	AudioEditorCommand,
	{ readonly type: VideoCompositionCommandType }
>;
export type VideoCompositionCommandHandlers = DomainCommandHandlerRegistry<
	typeof VIDEO_COMPOSITION_COMMAND_TYPES
>;

export function defineVideoCompositionCommandHandlers(
	handlers: VideoCompositionCommandHandlers,
): Readonly<VideoCompositionCommandHandlers> {
	return defineDomainCommandHandlerRegistry(
		'video composition',
		VIDEO_COMPOSITION_COMMAND_TYPES,
		handlers,
	);
}
