/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	defineDomainCommandHandlerRegistry,
	type DomainCommandHandlerRegistry,
} from './domain-registry.ts';
import type { AudioEditorCommand, AudioEditorCommandType } from './protocol.ts';

export const TRACK_FOLDER_COMMAND_TYPES = [
	'track-folder/add',
	'track-folder/update',
	'track-folder/remove',
	'track-node/move',
] as const satisfies readonly AudioEditorCommandType[];

export type TrackFolderCommandType = typeof TRACK_FOLDER_COMMAND_TYPES[number];
export type TrackFolderCommand = Extract<AudioEditorCommand, { readonly type: TrackFolderCommandType }>;
export type TrackFolderCommandHandlers = DomainCommandHandlerRegistry<typeof TRACK_FOLDER_COMMAND_TYPES>;

export function defineTrackFolderCommandHandlers(
	handlers: TrackFolderCommandHandlers,
): Readonly<TrackFolderCommandHandlers> {
	return defineDomainCommandHandlerRegistry('track-folder', TRACK_FOLDER_COMMAND_TYPES, handlers);
}
