/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	defineDomainCommandHandlerRegistry,
	type DomainCommandHandlerRegistry,
} from './domain-registry.ts';
import type { AudioEditorCommand, AudioEditorCommandType } from './protocol.ts';

export const CLIP_RANGE_CLIPBOARD_COMMAND_TYPES = [
	'clip/add',
	'clip/remove',
	'clip/remove-many',
	'clip/update',
	'clip/replace-source',
	'clip/render-replace-many',
	'clip/move',
	'clip/transform-many',
	'clip/overwrite',
	'clip/trim',
	'clip/split',
	'clip/link-av',
	'clip/unlink-av',
	'clip/group',
	'clip/ungroup',
	'clip/join',
	'range/lift-delete',
	'range/ripple-delete',
	'range/per-clip-ripple-delete',
	'range/keep',
	'range/replace',
	'clipboard/paste',
	'punch/replace',
	'edit/insert',
	'edit/overwrite',
] as const satisfies readonly AudioEditorCommandType[];

export type ClipRangeClipboardCommandType = typeof CLIP_RANGE_CLIPBOARD_COMMAND_TYPES[number];
export type ClipRangeClipboardCommand = Extract<AudioEditorCommand, { readonly type: ClipRangeClipboardCommandType }>;
export type ClipRangeClipboardCommandHandlers = DomainCommandHandlerRegistry<typeof CLIP_RANGE_CLIPBOARD_COMMAND_TYPES>;

export function defineClipRangeClipboardCommandHandlers(
	handlers: ClipRangeClipboardCommandHandlers,
): Readonly<ClipRangeClipboardCommandHandlers> {
	return defineDomainCommandHandlerRegistry('clip/range/clipboard', CLIP_RANGE_CLIPBOARD_COMMAND_TYPES, handlers);
}
