/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyEditorCommand,
	createAddClipCommand,
	createAddSourceCommand,
	createAddTrackCommand,
	prepareSplitCommand,
} from '../src/common/editor/commands.js';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	createCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';

const CREATED_AT = '2026-07-12T00:00:00.000Z';
const EDITED_AT = '2026-07-13T00:00:00.000Z';

function apply(project, command) {
	return applyEditorCommand(project, command, { now: EDITED_AT });
}

test('the command boundary synchronously rejects retired schema wire', () => {
	const retiredV2Wire = {
		schemaVersion: 2,
		id: 'retired-v2',
		title: 'Retired V2',
	};
	assert.throws(
		() => apply(retiredV2Wire, { type: 'project/rename', title: 'Cannot migrate by editing' }),
		/current audio editor project/iu,
	);
});

test('current commands normalize media leaves and preserve nondestructive clip properties', () => {
	let project = createCurrentAudioEditorProject({
		id: 'current-command-project',
		title: 'Current commands',
		sampleRate: 44_100,
		now: CREATED_AT,
	});
	project = apply(project, createAddSourceCommand({
		id: 'source',
		storageKey: 'source',
		name: 'Source',
		frameCount: 96_000,
		channelCount: 2,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
	}));
	project = apply(project, createAddTrackCommand({ id: 'track', name: 'Music' }));
	project = apply(project, createAddClipCommand('track', {
		id: 'clip',
		sourceId: 'source',
		title: 'Verse',
		timelineStartFrame: 1_000,
		sourceStartFrame: 4_000,
		sourceDurationFrames: 48_000,
		durationFrames: 44_100,
		pitchCents: 300,
		speedRatio: 0.9,
		preserveFormants: true,
		color: 'blue',
	}));
	project = apply(project, prepareSplitCommand('clip', 23_050, () => 'clip-right'));

	assert.equal(project.schemaVersion, AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION);
	assert.equal(project.sampleRate, 44_100);
	assert.equal(project.sources[0].kind, 'audio');
	assert.equal(project.tracks[0].locked, false);
	assert.deepEqual(project.tracks[0].clipIds, ['clip', 'clip-right']);
	assert.equal(project.clips[1].sourceStartFrame, 28_000);
	assert.equal(project.clips[1].pitchCents, 300);
	assert.equal(project.clips[1].speedRatio, 0.9);
	assert.equal(project.clips[1].preserveFormants, true);
	assert.equal(validateCurrentAudioEditorProject(project), true);
});

test('a failed current command is atomic', () => {
	const project = createCurrentAudioEditorProject({ id: 'atomic-current-command', now: CREATED_AT });
	const snapshot = structuredClone(project);
	assert.throws(
		() => apply(project, createAddClipCommand('missing-track', {
			id: 'missing-clip', sourceId: 'missing-source', durationFrames: 1,
		})),
		/Unknown track|missing source/iu,
	);
	assert.deepEqual(project, snapshot);
});
