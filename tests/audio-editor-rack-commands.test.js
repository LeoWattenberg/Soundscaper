import test from 'node:test';
import assert from 'node:assert/strict';

import {
	applyEditorCommand,
	createAddTrackCommand,
} from '../src/lib/tools/audio-editor/commands.js';
import { createEffect } from '../src/lib/tools/audio-editor/effects.js';
import {
	createEditorHistory,
	executeEditorCommand,
	undoEditorCommand,
} from '../src/lib/tools/audio-editor/history.js';
import {
	createAudioEditorProject,
	findTrack,
} from '../src/lib/tools/audio-editor/project.js';

const NOW = '2026-07-13T12:00:00.000Z';

function apply(project, command) {
	return applyEditorCommand(project, command, { now: NOW });
}

function createRackFixture() {
	let project = createAudioEditorProject({ id: 'rack-project', now: NOW });
	for (const [id, name] of [['track-a', 'Target A'], ['track-b', 'Control'], ['track-c', 'Target C']]) {
		project = apply(project, createAddTrackCommand({ id, name }));
	}
	return project;
}

test('removing a control track disables and clears every dependent Auto Duck rack effect', () => {
	let project = createRackFixture();
	project = apply(project, {
		type: 'effect/add', scope: 'track', trackId: 'track-a',
		effect: createEffect('audacity-auto-duck', {
			id: 'track-duck',
			context: { controlTrackId: 'track-b', range: { startFrame: 10, endFrame: 20 } },
			state: { cache: { key: 'track-duck-cache' } },
		}),
	});
	project = apply(project, {
		type: 'effect/add', scope: 'master',
		effect: createEffect('audacity-auto-duck', {
			id: 'master-duck',
			context: { controlTrackId: 'track-b', profile: { threshold: -30 } },
		}),
	});
	project = apply(project, {
		type: 'effect/add', scope: 'track', trackId: 'track-c',
		effect: createEffect('audacity-auto-duck', {
			id: 'unrelated-duck', context: { controlTrackId: 'track-a' },
		}),
	});
	project = apply(project, {
		type: 'effect/add', scope: 'track', trackId: 'track-c',
		effect: createEffect('delay', {
			id: 'non-duck', context: { controlTrackId: 'track-b' },
		}),
	});

	const beforeRemoval = project;
	const history = executeEditorCommand(createEditorHistory(project), {
		type: 'track/remove', trackId: 'track-b',
	}, { now: NOW });
	project = history.present;

	assert.equal(findTrack(project, 'track-b'), null);
	const trackDuck = findTrack(project, 'track-a').effects.find((effect) => effect.id === 'track-duck');
	assert.equal(trackDuck.enabled, false);
	assert.equal(trackDuck.context.controlTrackId, null);
	assert.deepEqual(trackDuck.context.range, { startFrame: 10, endFrame: 20 });
	assert.deepEqual(trackDuck.state, { cache: { key: 'track-duck-cache' } });

	const masterDuck = project.master.effects.find((effect) => effect.id === 'master-duck');
	assert.equal(masterDuck.enabled, false);
	assert.equal(masterDuck.context.controlTrackId, null);
	assert.deepEqual(masterDuck.context.profile, { threshold: -30 });

	const unrelatedDuck = findTrack(project, 'track-c').effects.find((effect) => effect.id === 'unrelated-duck');
	assert.equal(unrelatedDuck.enabled, true);
	assert.equal(unrelatedDuck.context.controlTrackId, 'track-a');
	const nonDuck = findTrack(project, 'track-c').effects.find((effect) => effect.id === 'non-duck');
	assert.equal(nonDuck.enabled, true);
	assert.equal(nonDuck.context.controlTrackId, 'track-b');

	assert.equal(findTrack(beforeRemoval, 'track-b')?.id, 'track-b');
	assert.equal(findTrack(beforeRemoval, 'track-a').effects[0].enabled, true);
	assert.equal(findTrack(beforeRemoval, 'track-a').effects[0].context.controlTrackId, 'track-b');

	const restored = undoEditorCommand(history, { now: NOW }).present;
	assert.equal(findTrack(restored, 'track-b')?.id, 'track-b');
	assert.equal(findTrack(restored, 'track-a').effects[0].enabled, true);
	assert.equal(findTrack(restored, 'track-a').effects[0].context.controlTrackId, 'track-b');
	assert.equal(restored.master.effects[0].enabled, true);
	assert.equal(restored.master.effects[0].context.controlTrackId, 'track-b');
});

test('track/add normalizes preconfigured racks and rejects effect ID collisions', () => {
	let project = createRackFixture();
	project = apply(project, {
		type: 'effect/add', scope: 'track', trackId: 'track-a',
		effect: createEffect('audacity-invert', { id: 'shared-effect' }),
	});
	const before = structuredClone(project);

	assert.throws(() => apply(project, createAddTrackCommand({
		id: 'duplicate-track',
		effects: [createEffect('audacity-invert', { id: 'shared-effect' })],
	})), /Duplicate effect ID: shared-effect/);
	assert.deepEqual(project, before);

	assert.throws(() => apply(project, createAddTrackCommand({
		id: 'internally-duplicated-track',
		effects: [
			createEffect('audacity-invert', { id: 'same-effect' }),
			createEffect('audacity-echo', { id: 'same-effect' }),
		],
	})), /Duplicate effect ID: same-effect/);

	const rawContext = { controlTrackId: 'track-b', range: { startFrame: 0, endFrame: 100 } };
	project = apply(project, createAddTrackCommand({
		id: 'configured-track',
		effects: [createEffect('audacity-auto-duck', {
			id: 'configured-duck', context: rawContext,
		})],
	}));
	rawContext.controlTrackId = 'mutated';
	const configured = findTrack(project, 'configured-track').effects[0];
	assert.equal(configured.type, 'audacity-auto-duck');
	assert.equal(configured.context.controlTrackId, 'track-b');
	assert.deepEqual(configured.context.range, { startFrame: 0, endFrame: 100 });
});
