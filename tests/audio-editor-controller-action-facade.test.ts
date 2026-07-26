/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createGroupedEditorActions,
	type EditorActionRuntime,
} from '../src/common/editor/controller/action-facade.ts';

const EXPECTED_ACTION_GROUPS = Object.freeze([
	'analysis',
	'audioDevices',
	'clip',
	'edit',
	'effects',
	'export',
	'generators',
	'labels',
	'macros',
	'metadata',
	'metering',
	'mixer',
	'nyquist',
	'preferences',
	'project',
	'projectBin',
	'recording',
	'sampleEdit',
	'spectral',
	'timeline',
	'track',
	'transport',
	'video',
]);

function createRuntime(capability = true): EditorActionRuntime {
	const callable = () => undefined;
	const runtime = new Proxy<Record<string, unknown>>({}, {
		get(_target, name) {
			if (name === 'capabilities') return new Proxy({}, { get: () => capability });
			if (name === 'product') return { name: 'Soundscaper' };
			if (name === 'copy') return { projectNotFound: 'Not found', localSourcesMissing: 'Missing', audioClipNotFound: 'Missing' };
			if (name === 'project') return { tracks: [], clips: [] };
			if (name === 'state') return {
				recentProjectIds: [],
				projects: [],
				preferences: { recording: {} },
				audacityEffectType: 'amplify',
				effectPresets: {},
			};
			if (name === 'engine' || name === 'analysisService' || name === 'store') {
				return new Proxy({}, { get: () => callable });
			}
			if (name === 'AUDIO_EDITOR_DEFAULT_SHORTCUTS') return {};
			return callable;
		},
	});
	return runtime as EditorActionRuntime;
}

test('controller action facade exposes stable frozen responsibility groups', () => {
	const actions = createGroupedEditorActions(createRuntime());
	assert.deepEqual(Object.keys(actions).sort(), EXPECTED_ACTION_GROUPS);
	assert.equal(Object.isFrozen(actions), true);
	for (const group of Object.values(actions)) assert.equal(Object.isFrozen(group), true);
});

test('controller action facade enforces product capabilities at invocation', () => {
	const actions = createGroupedEditorActions(createRuntime(false));
	const addEffect = actions.effects.add;
	assert.equal(typeof addEffect, 'function');
	if (typeof addEffect !== 'function') throw new TypeError('The effects action must be callable.');
	assert.throws(() => addEffect(), /does not support audioEffects/u);
});
