/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { applyAudacityTrackMixerAction } from '../src/common/editor/audacity-shortcut-actions/track-mixer.ts';
import type {
	ControllerProject,
	ControllerTrack,
} from '../src/common/editor/controller/track-domain-types.ts';

const ACTIONS = [
	'mute-tracks', 'unmute-tracks', 'track-pan-left', 'track-pan-right',
	'track-gain-inc', 'track-gain-dec', 'track-mute', 'track-solo',
] as const;

test('selected mute actions use one batch and durable-selection ownership', () => {
	const state = snapshot();
	const commits: AudioEditorCommand[] = [];
	const commit = (command: AudioEditorCommand) => { commits.push(command); return command; };

	applyAudacityTrackMixerAction(ACTIONS[0], state, commit);
	applyAudacityTrackMixerAction(ACTIONS[1], state, commit);
	assert.deepEqual(commits, [
		{
			type: 'batch',
			commands: [
				{ type: 'track/update', trackId: 'selected-audio', changes: { mute: true } },
				{ type: 'track/update', trackId: 'focused-video', changes: { mute: true } },
			],
		},
		{
			type: 'batch',
			commands: [{ type: 'track/update', trackId: 'selected-muted', changes: { mute: false } }],
		},
	]);

	commits.length = 0;
	state.project.selection.trackIds = ['labels'];
	assert.equal(applyAudacityTrackMixerAction(ACTIONS[0], state, commit), null, 'label selection never falls through to focus');
	state.project.selection.trackIds = [];
	applyAudacityTrackMixerAction(ACTIONS[0], state, commit);
	assert.deepEqual(commits, [{
		type: 'batch', commands: [{ type: 'track/update', trackId: 'focused-audio', changes: { mute: true } }],
	}]);
});

test('focused mixer actions use exact Audacity steps and explicit focus only', () => {
	const state = snapshot();
	const commits: AudioEditorCommand[] = [];
	const commit = (command: AudioEditorCommand) => { commits.push(command); return command; };

	for (const action of ACTIONS.slice(2)) applyAudacityTrackMixerAction(action, state, commit);
	assert.deepEqual(commits.slice(0, 2), [
		{ type: 'track/update', trackId: 'focused-audio', changes: { pan: 0.17 } },
		{ type: 'track/update', trackId: 'focused-audio', changes: { pan: 0.37 } },
	]);
	const gainUp = commits[2];
	const gainDown = commits[3];
	if (gainUp?.type !== 'track/update' || gainDown?.type !== 'track/update') assert.fail('Expected gain updates.');
	assert.ok(Math.abs(Number(gainUp.changes.gain) - 10 ** (1 / 20)) < 1e-12);
	assert.ok(Math.abs(Number(gainDown.changes.gain) - 10 ** (-1 / 20)) < 1e-12);
	assert.deepEqual(commits.slice(4), [
		{ type: 'track/update', trackId: 'focused-audio', changes: { mute: true } },
		{ type: 'track/update', trackId: 'focused-audio', changes: { solo: false } },
	]);

	commits.length = 0;
	state.selectedTrackId = 'focused-video';
	assert.equal(applyAudacityTrackMixerAction(ACTIONS[2], state, commit), null);
	applyAudacityTrackMixerAction(ACTIONS[6], state, commit);
	assert.deepEqual(commits, [{ type: 'track/update', trackId: 'focused-video', changes: { mute: true } }]);
	state.selectedTrackId = 'labels';
	assert.equal(applyAudacityTrackMixerAction(ACTIONS[7], state, commit), null);
});

test('gain and pan boundaries add no history while zero gain increases from -60 dB', () => {
	for (const [changes, action] of [
		[{ pan: -1 }, ACTIONS[2]], [{ pan: 1 }, ACTIONS[3]],
		[{ gain: 4 }, ACTIONS[4]], [{ gain: 0 }, ACTIONS[5]],
	] as const) {
		const state = snapshot();
		Object.assign(state.project.tracks[0], changes);
		assert.equal(applyAudacityTrackMixerAction(action, state, () => assert.fail('boundary must not commit')), null);
	}
	const state = snapshot();
	Object.assign(state.project.tracks[0], { gain: 0 });
	const commands: AudioEditorCommand[] = [];
	applyAudacityTrackMixerAction(ACTIONS[4], state, (value) => { commands.push(value); return value; });
	const command = commands[0];
	if (command?.type !== 'track/update') assert.fail('Expected a gain update.');
	assert.ok(Math.abs(Number(command.changes.gain) - 10 ** (-59 / 20)) < 1e-12);
	assert.equal(applyAudacityTrackMixerAction('not-an-action', state, () => assert.fail('invalid action must not commit')), null);
});

interface MutableSnapshot {
	project: ControllerProject & {
		tracks: ControllerTrack[];
		selection: { startFrame: number; endFrame: number; trackIds: string[]; clipIds: string[] };
	};
	selectedTrackId: string | null;
}

function snapshot(): MutableSnapshot {
	return {
		project: {
			schemaVersion: 1, id: 'project', title: 'Project', sampleRate: 48_000,
			tracks: [
				track('focused-audio', 'audio', { gain: 1, pan: 0.27, mute: false, solo: true, locked: true }),
				track('selected-audio', 'audio', { mute: false }),
				track('selected-muted', 'audio', { mute: true }),
				track('focused-video', 'video', { mute: false }),
				track('labels', 'label'),
			],
			clips: [], sources: [], mixer: { groups: [], sends: [], routes: {} },
			selection: {
				startFrame: 0, endFrame: 0,
				trackIds: ['selected-audio', 'selected-muted', 'focused-video', 'labels'], clipIds: [],
			},
		},
		selectedTrackId: 'focused-audio',
	};
}

function track(
	id: string,
	type: ControllerTrack['type'],
	overrides: Partial<ControllerTrack> = {},
): ControllerTrack {
	return { id, name: id, type, clipIds: [], ...overrides };
}
