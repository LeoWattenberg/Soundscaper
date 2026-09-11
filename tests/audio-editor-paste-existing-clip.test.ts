/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyEditorCommand,
	preparePasteCommand,
} from '../src/common/editor/commands.js';
import type {
	AudioEditorClipboard,
	AudioEditorCommand,
} from '../src/common/editor/commands/protocol.ts';
import {
	createClipboardEditService,
	type ClipboardEditProject,
} from '../src/common/editor/controller/edit/internal/clipboard-edit-service.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { projectForCommand } from '../src/common/editor/project-command-projection.ts';

const NOW = '2026-09-10T12:00:00.000Z';

function clipboard(sourceStartFrame = 20): AudioEditorClipboard {
	return {
		schemaVersion: 2,
		sampleRate: 8_000,
		durationFrames: 20,
		tracks: [{
			sourceTrackId: 'track',
			sourceTrackName: 'Audio',
			sourceTrackType: 'audio',
			clips: [{
				key: 'copied',
				kind: 'audio',
				sourceId: 'source',
				offsetFrame: 0,
				sourceStartFrame,
				durationFrames: 20,
			}],
		}],
	};
}

function project() {
	const source = createAudioSource({
		id: 'source',
		frameCount: 100,
		channelCount: 1,
		sampleRate: 8_000,
		originalSampleRate: 8_000,
	});
	const clip = createAudioClip({
		id: 'existing',
		sourceId: source.id,
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		sourceDurationFrames: 20,
		durationFrames: 20,
	}, {
		projectSampleRate: 8_000,
		tempoMap: {
			mode: 'musical',
			events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
		},
	});
	return createCurrentAudioEditorProject({
		id: 'paste-existing-clip',
		now: NOW,
		sampleRate: 8_000,
		sources: [source],
		clips: [clip],
		tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] }, 8_000)],
	});
}

function paste(options: Readonly<{
	pasteAsNewClip?: boolean;
	sourceStartFrame?: number;
	mode?: 'reject' | 'insert-all';
}> = {}) {
	const document = project();
	const command = preparePasteCommand(
		clipboard(options.sourceStartFrame),
		{
			atFrame: 20,
			mode: options.mode,
			pasteAsNewClip: options.pasteAsNewClip,
			project: projectForCommand(document as unknown as Record<string, unknown>),
		},
		() => 'pasted',
	) as AudioEditorCommand;
	return {
		command,
		result: applyEditorCommand(document, command, { now: NOW }),
	};
}

test('paste-as-new remains the default and keeps the pasted audio clip distinct', () => {
	const { command, result } = paste();

	assert.equal(command.type, 'clipboard/paste');
	if (command.type !== 'clipboard/paste') return;
	assert.equal(command.pasteIntoExistingClip, undefined);
	assert.deepEqual(result.tracks[0]?.clipIds, ['existing', 'pasted']);
});

test('disabling paste-as-new keeps an exact-end paste distinct like Audacity', () => {
	const { command, result } = paste({ pasteAsNewClip: false });

	assert.equal(command.type, 'clipboard/paste');
	if (command.type !== 'clipboard/paste') return;
	assert.equal(command.pasteIntoExistingClip, true);
	assert.deepEqual(result.tracks[0]?.clipIds, ['existing', 'pasted']);
	assert.deepEqual(
		result.clips.map(({ id, sourceStartFrame, sourceDurationFrames, durationFrames }) => ({
			id, sourceStartFrame, sourceDurationFrames, durationFrames,
		})),
		[
			{ id: 'existing', sourceStartFrame: 0, sourceDurationFrames: 20, durationFrames: 20 },
			{ id: 'pasted', sourceStartFrame: 20, sourceDurationFrames: 20, durationFrames: 20 },
		],
	);
});

test('paste-into-existing keeps incompatible source regions as separate clips', () => {
	const { result } = paste({ pasteAsNewClip: false, sourceStartFrame: 40 });

	assert.deepEqual(result.tracks[0]?.clipIds, ['existing', 'pasted']);
});

test('all-track insert always preserves a fresh clip like Audacity', () => {
	const { command, result } = paste({ pasteAsNewClip: false, mode: 'insert-all' });

	assert.equal(command.type, 'clipboard/paste');
	if (command.type !== 'clipboard/paste') return;
	assert.equal(command.pasteIntoExistingClip, undefined);
	assert.deepEqual(result.tracks[0]?.clipIds, ['existing', 'pasted']);
});

test('the controller paste seam forwards the explicit paste-as-new preference', () => {
	const document = project();
	const descriptor = clipboard();
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const service = createClipboardEditService({
		lifetime,
		state: { selectedTrackId: 'track', selectedClipId: 'existing', clipboard: descriptor },
		copy: { noSilencesFound: 'No silences found.', track: 'Track' },
		session: {
			setClipboard: (value) => ({ clipboard: { descriptor: value, sources: [] } }),
			clipboardForProject: () => ({ descriptor, sources: [] }),
		},
		sourceBuffers: new Map(),
		getProject: () => projectForCommand(
			document as unknown as Record<string, unknown>,
		) as unknown as ClipboardEditProject,
		editingBlocked: () => false,
		getPositionFrames: () => 20,
		normalizeFrame: Number,
		snapFrame: Number,
		createId: () => 'pasted',
		commit: () => undefined,
		setStatus: () => undefined,
	});

	const command = service.prepareControllerPaste('reject', 20, false);

	assert.equal(command.type, 'clipboard/paste');
	if (command.type !== 'clipboard/paste') return;
	assert.equal(command.pasteIntoExistingClip, true);
});
