/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMenuActionFixture } from './helpers/application-menu-fixture.ts';

test('menu action fixtures leave optional runtime ports absent while supplying command callbacks', () => {
	const calls: string[] = [];
	const actions = createMenuActionFixture({}, (name) => { calls.push(name); });
	for (const name of ['parallelStackProcessing', 'soundscaperWorkflow', 'framescaperNativeServices',
		'framescaperCandidateAuthoring', 'soundscaperNativeServices', 'araClipEditing']) {
		assert.equal(actions[name], null, name);
	}
	assert.equal(actions[Symbol.iterator], undefined);
	const openFile = actions.openFile;
	assert.equal(typeof openFile, 'function');
	assert.ok(typeof openFile === 'function');
	openFile();
	assert.deepEqual(calls, ['openFile']);
});

test('menu action fixtures preserve explicit commands and structured runtime ports', () => {
	const openFile = () => 'opened';
	const parallelStackProcessing = {
		preferences: { enabled: false, workerLimit: 'auto', pipelineFrames: 768 },
		status: { state: 'off' }, change: () => undefined,
	};
	const actions = createMenuActionFixture({
		openFile, parallelStackProcessing, araClipEditing: undefined, installApplication: null,
	});
	assert.strictEqual(actions.openFile, openFile);
	assert.strictEqual(actions.parallelStackProcessing, parallelStackProcessing);
	assert.equal(actions.araClipEditing, undefined);
	assert.equal(actions.installApplication, null);
});
