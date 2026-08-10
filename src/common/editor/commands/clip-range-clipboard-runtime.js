/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	addClip,
	moveClip,
	removeClip,
	removeClips,
	replaceClipSource,
	replaceRenderedClips,
	updateClip,
} from './clip-basic-runtime.js';
import {
	groupClips,
	joinClips,
	linkAvClips,
	splitClip,
	ungroupClips,
	unlinkAvClips,
} from './clip-link-runtime.js';
import {
	overwriteClip,
	transformClips,
	trimClip,
} from './clip-transform-runtime.js';
import { pasteClipboard } from './clipboard-runtime.js';
import {
	insertThreePointEdit,
	overwriteThreePointEdit,
} from './three-point-edit-runtime.js';
import {
	deleteRange,
	keepRange,
	punchReplace,
	replaceRange,
} from './range-runtime.js';

export function createClipRangeClipboardRuntimeHandlers() {
	return {
		'clip/add': (project, command) => addClip(project, command.trackId, command.clip),
		'clip/remove': (project, command) => removeClip(project, command.clipId),
		'clip/remove-many': (project, command) => removeClips(project, command.clipIds, command.rippleMode),
		'clip/update': (project, command) => updateClip(project, command.clipId, command.changes),
		'clip/replace-source': (project, command) => replaceClipSource(project, command.clipId, command.sourceId),
		'clip/render-replace-many': replaceRenderedClips,
		'clip/move': moveClip,
		'clip/transform-many': transformClips,
		'clip/overwrite': overwriteClip,
		'clip/trim': trimClip,
		'clip/split': splitClip,
		'clip/link-av': linkAvClips,
		'clip/unlink-av': unlinkAvClips,
		'clip/group': (project, command) => groupClips(project, command.clipIds, command.groupId),
		'clip/ungroup': (project, command) => ungroupClips(project, command.clipIds),
		'clip/join': (project, command) => joinClips(project, command.clipIds),
		'range/lift-delete': (project, command) => deleteRange(project, command, 'none'),
		'range/ripple-delete': (project, command) => deleteRange(project, command, 'track'),
		'range/per-clip-ripple-delete': (project, command) => deleteRange(project, command, 'clip'),
		'range/keep': keepRange,
		'range/replace': replaceRange,
		'clipboard/paste': pasteClipboard,
		'punch/replace': punchReplace,
		'edit/insert': insertThreePointEdit,
		'edit/overwrite': overwriteThreePointEdit,
	};
}
