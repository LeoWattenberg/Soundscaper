/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioWarpActionFacade } from '../src/common/editor/controller/audio-warp-action-facade.ts';

test('audio warp facade exposes every selected-clip workflow operation behind one capability', async () => {
	const calls: string[] = [];
	const service = Object.fromEntries([
		'view', 'analyzeSelected', 'createIdentityMapSelected', 'quantizeSelected',
		'applyGrooveSelected', 'clearSelected',
	].map((name) => [name, (..._args: readonly unknown[]) => {
		calls.push(name);
		return name;
	}]));
	const actions = createAudioWarpActionFacade({
		enabled: true, productName: 'Soundscaper', service,
	});

	assert.equal(actions.view(), 'view');
	assert.equal(await actions.analyze(), 'analyzeSelected');
	assert.equal(actions.createIdentityMap(), 'createIdentityMapSelected');
	assert.equal(await actions.quantize({}), 'quantizeSelected');
	assert.equal(await actions.applyGroove({}), 'applyGrooveSelected');
	assert.equal(actions.clear(), 'clearSelected');
	assert.deepEqual(calls, [
		'view', 'analyzeSelected', 'createIdentityMapSelected', 'quantizeSelected',
		'applyGrooveSelected', 'clearSelected',
	]);
	assert.equal(Object.isFrozen(actions), true);
});

test('audio warp facade fails closed for Framescaper without a fallback implementation', () => {
	const actions = createAudioWarpActionFacade({
		enabled: false, productName: 'Framescaper', service: {},
	});
	for (const action of Object.values(actions)) {
		assert.throws(() => action(), /Framescaper does not support audioWarp/u);
	}
});
