/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createMacroScriptHost } from '../src/common/editor/controller/macro-script-host.ts';

function createHarness() {
	const events: string[] = [];
	let settled: string | null = null;
	const project = {
		durationFrames: 1_000,
		tracks: [
			{ id: 'track-a', name: 'Voice', type: 'audio', clipIds: ['clip-a'] },
			{ id: 'track-b', name: 'Music', type: 'audio', mute: true, clipIds: [] },
		],
		clips: [{ id: 'clip-a', title: 'Take 1', timelineStartFrame: 0, durationFrames: 400 }],
		selection: { startFrame: 100, endFrame: 200, trackIds: ['track-a'] },
	};
	const host = createMacroScriptHost({
		getProject: () => project,
		projectSampleRate: () => 100,
		runEffectMacro: async ({ name, effects }) => {
			events.push(`effects:${name}:${effects.map((step) => String(step.type)).join('+')}`);
			return true;
		},
		runMacroCommand: (step) => {
			events.push(`command:${String(step.command)}:${JSON.stringify(step.params)}`);
		},
		setExactSelection: (startFrame, endFrame, details) => {
			events.push(`selection:${startFrame}-${endFrame}:${JSON.stringify(details?.trackIds ?? null)}`);
			project.selection = {
				startFrame, endFrame, trackIds: (details?.trackIds as string[]) ?? [],
			};
			return project;
		},
		listSavedMacros: () => [{
			id: 'macro-a',
			name: 'Cleanup',
			effects: [
				{ kind: 'command', id: 's', enabled: true, command: 'SelectTime', params: { start: 0 } },
				{ id: 'e', type: 'audacity-invert', enabled: true, params: {} },
			],
		}],
		beginMacroTransaction: () => Object.freeze({
			commit: () => { settled = 'commit'; },
			rollback: () => { settled = 'rollback'; },
		}),
	});
	return { events, host, project, settled: () => settled, dispatch: host.createDispatch() };
}

test('a program can read the project without changing it', async () => {
	const harness = createHarness();
	assert.deepEqual(await harness.dispatch('project.tracks', []), [
		{ id: 'track-a', name: 'Voice', kind: 'audio', index: 0, muted: false, solo: false },
		{ id: 'track-b', name: 'Music', kind: 'audio', index: 1, muted: true, solo: false },
	]);
	assert.deepEqual(await harness.dispatch('project.selection', []),
		{ startFrame: 100, endFrame: 200, trackIds: ['track-a'] });
	assert.deepEqual(await harness.dispatch('project.clips', ['track-a']),
		[{ id: 'clip-a', name: 'Take 1', startFrame: 0, durationFrames: 400 }]);
	assert.deepEqual(await harness.dispatch('project.clips', ['track-b']), []);
	assert.deepEqual(harness.events, [], 'reading must change nothing');
});

test('the selection verbs reach the same command tier a step list reaches', async () => {
	const harness = createHarness();
	await harness.dispatch('select.time', [0, 1, { relativeTo: 'project-end' }]);
	await harness.dispatch('select.tracks', [{ track: 1, trackCount: 2, mode: 'add' }]);
	await harness.dispatch('select.frequencies', [{ low: 100, high: 8_000 }]);
	assert.deepEqual(harness.events, [
		'command:SelectTime:{"start":0,"end":1,"relativeTo":"project-end"}',
		'command:SelectTracks:{"track":1,"trackCount":2,"mode":"add"}',
		'command:SelectFrequencies:{"low":100,"high":8000}',
	]);

	// Frames go straight through, because a program asking for a frame means it.
	const frames = createHarness();
	await frames.dispatch('select.frames', [10, 20]);
	assert.deepEqual(frames.events, ['selection:10-20:["track-a"]']);
	await frames.dispatch('select.all', []);
	assert.equal(frames.events.at(-1), 'selection:0-1000:["track-a","track-b"]');
	await frames.dispatch('select.none', []);
	assert.equal(frames.events.at(-1), 'selection:0-0:[]');
});

test('effects and saved macros run through the paths a step list uses', async () => {
	const harness = createHarness();
	await harness.dispatch('effect.apply', ['audacity-invert', {}]);
	await harness.dispatch('effect.chain', [[{ type: 'audacity-amplify', params: { gainDb: 2 } }, { type: 'audacity-invert' }]]);
	// A saved macro may itself hold commands, so it takes the same split.
	await harness.dispatch('macro.runSaved', ['Cleanup']);

	assert.deepEqual(harness.events, [
		'effects:audacity-invert:audacity-invert',
		'effects:audacity-amplify:audacity-amplify+audacity-invert',
		'command:SelectTime:{"start":0}',
		'effects:Cleanup:audacity-invert',
	]);
	await assert.rejects(() => harness.dispatch('macro.runSaved', ['Nothing']), /no saved macro/u);
	await assert.rejects(() => harness.dispatch('effect.chain', [[]]), /at least one effect/u);
});

test('anything outside the table is refused by name', async () => {
	const harness = createHarness();
	for (const method of [
		'project.save', 'project.open', 'export.start', 'preferences.update',
		'recording.start', 'storage.cleanup', 'nyquist.evaluate', 'edit.commit', 'fetch',
	]) {
		await assert.rejects(
			() => harness.dispatch(method, []),
			(error: Error & { code?: string }) => {
				assert.equal(error.code, 'MACRO_UNKNOWN_METHOD');
				assert.equal(error.message, `A macro cannot ask the editor for ${method}.`);
				return true;
			},
			method,
		);
	}
	assert.deepEqual(harness.events, []);
});

test('a whole program is one history entry, and a thrown program is none', async () => {
	const committed = createHarness();
	await committed.host.runMacroScript({
		name: 'Level everything',
		run: async (dispatch) => {
			await dispatch('select.all', []);
			await dispatch('effect.apply', ['audacity-normalize', {}]);
		},
	});
	assert.equal(committed.settled(), 'commit');

	const failed = createHarness();
	await assert.rejects(() => failed.host.runMacroScript({
		name: 'Broken',
		run: async (dispatch) => {
			await dispatch('effect.apply', ['audacity-invert', {}]);
			throw new Error('the program threw');
		},
	}), /the program threw/u);
	assert.equal(failed.settled(), 'rollback');
});
