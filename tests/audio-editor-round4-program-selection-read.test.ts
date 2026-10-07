/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroScriptHost } from '../src/common/editor/controller/effects/internal/macro/macro-script-host.ts';

function fixture(clipIds: readonly string[], startFrame = 0, endFrame = 0) {
	const project = {
		id: 'session', sampleRate: 48_000,
		tracks: [{ id: 'voice', type: 'audio', clipIds: ['first'] }, { id: 'music', type: 'audio', clipIds: ['second'] }],
		clips: [
			{ id: 'first', kind: 'audio', timelineStartFrame: 48_000, durationFrames: 24_000 },
			{ id: 'second', kind: 'audio', timelineStartFrame: 96_000, durationFrames: 48_000 },
		],
		selection: { startFrame, endFrame, clipIds, trackIds: ['voice'] },
	};
	const original = structuredClone(project);
	let mutations = 0;
	const host = createMacroScriptHost({
		getProject: () => project,
		projectSampleRate: () => project.sampleRate,
		runEffectMacro: async () => { mutations++; },
		runMacroCommand: () => { mutations++; },
		setExactSelection: () => { mutations++; },
		listSavedMacros: () => [],
		beginMacroTransaction: () => ({ assertCurrent() {}, commit() {}, rollback() {} }),
	});
	return { dispatch: host.createDispatch(), project, original, mutations: () => mutations };
}

test('a macro selection read reports the clip-header time range without changing the document', async () => {
	const { dispatch, project, original, mutations } = fixture(['first']);
	assert.deepEqual(await dispatch('project.selection', []), { startFrame: 48_000, endFrame: 72_000, trackIds: ['voice'] });
	assert.deepEqual(project, original);
	assert.equal(mutations(), 0);
});

test('a macro snapshot brackets disjoint selected clips and their owning tracks', async () => {
	const { dispatch } = fixture(['first', 'second']);
	assert.deepEqual(await dispatch('project.selection', []), { startFrame: 48_000, endFrame: 144_000, trackIds: ['voice', 'music'] });
	const snapshot = await dispatch('project.snapshot', []);
	assert.ok(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot));
	assert.deepEqual(snapshot.selection, { startFrame: 48_000, endFrame: 144_000, trackIds: ['voice', 'music'] });
});

test('an explicit time selection stays authoritative and an empty selection stays empty', async () => {
	assert.deepEqual(await fixture(['first'], 100, 200).dispatch('project.selection', []),
		{ startFrame: 100, endFrame: 200, trackIds: ['voice'] });
	assert.deepEqual(await fixture([]).dispatch('project.selection', []),
		{ startFrame: 0, endFrame: 0, trackIds: ['voice'] });
});
