/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAddClipCommand,
	createAddLabelCommand,
	createAddLabelTrackCommand,
	createAddSourceCommand,
	createAddTrackCommand,
	createAddVideoEffectCommand,
	createBypassVideoEffectCommand,
	createRemoveVideoEffectCommand,
	createReorderVideoEffectCommand,
	createReplaceClipSourceCommand,
	createUpdateVideoEffectCommand,
} from '../src/common/editor/commands/factories.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

test('typed command factories prepare serializable domain commands with caller-owned IDs', () => {
	const commands = [
		createAddSourceCommand({ id: 'source', storageKey: 'source', name: 'Source', frameCount: 10, channelCount: 1 }),
		createAddTrackCommand({ id: 'track', name: 'Track' }),
		createAddClipCommand('track', { id: 'clip', sourceId: 'source', durationFrames: 10 }),
		createAddLabelTrackCommand({ id: 'labels', name: 'Labels' }),
		createAddLabelCommand('labels', { id: 'label', title: 'Marker', startFrame: 0, endFrame: 0 }),
		createReplaceClipSourceCommand('clip', 'source-2'),
		createAddVideoEffectCommand('video', 'vignette', { id: 'video-effect', index: 0 }),
		createUpdateVideoEffectCommand('video', 'video-effect', { enabled: false }),
		createBypassVideoEffectCommand('video', 'video-effect'),
		createReorderVideoEffectCommand('video', 'video-effect', 1),
		createRemoveVideoEffectCommand('video', 'video-effect'),
	] satisfies readonly AudioEditorCommand[];

	assert.deepEqual(commands.map((command) => command.type), [
		'source/add', 'track/add', 'clip/add', 'track/add', 'label/add',
		'clip/replace-source', 'video-effect/add', 'video-effect/update',
		'video-effect/update', 'video-effect/reorder', 'video-effect/remove',
	]);
	assert.equal(commands[6].type === 'video-effect/add' && commands[6].effect?.id, 'video-effect');
});

test('typed command factories reject unstable IDs and invalid destinations at preparation time', () => {
	assert.throws(() => createReplaceClipSourceCommand('', 'source'), /clip/);
	assert.throws(() => createReorderVideoEffectCommand('video', 'effect', -1), /non-negative/);
	assert.throws(() => createBypassVideoEffectCommand('video', 'effect', 'yes' as unknown as boolean), /boolean/);
});
