/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { selectTauriPrototypeBuildTargets } from '../prototypes/tauri/build-targets.mjs';

const windowsTarget = { runner: 'windows-2025', platform: 'win', arch: 'x64', node_arch: 'x64' };

test('all prototype targets use native Windows, macOS, and Linux runners', () => {
	assert.deepEqual(selectTauriPrototypeBuildTargets('all'), [
		windowsTarget,
		{ runner: 'macos-15', platform: 'mac', arch: 'arm64', node_arch: 'arm64' },
		{ runner: 'ubuntu-22.04', platform: 'linux', arch: 'x64', node_arch: 'x64' },
	]);
});

test('both Windows workflow choices select the supported x64 prototype', () => {
	for (const selection of ['windows', 'win-x64']) {
		assert.deepEqual(selectTauriPrototypeBuildTargets(selection), [windowsTarget]);
	}
});

test('prototype target selections reject unsupported and absent inputs', () => {
	for (const selection of ['mac', 'linux', 'win-arm64', '', 'ALL', undefined, null, false, 1]) {
		assert.throws(() => selectTauriPrototypeBuildTargets(selection), /Unknown Tauri prototype target selection:/u);
	}
});

test('prototype target matrices are fresh immutable snapshots', () => {
	const first = selectTauriPrototypeBuildTargets('all');
	const second = selectTauriPrototypeBuildTargets('all');
	const windows = selectTauriPrototypeBuildTargets('windows');
	assert.notEqual(first, second);
	assert.notEqual(first[0], second[0]);
	assert.notEqual(first[0], windows[0]);
	assert.equal(Object.isFrozen(first), true);
	for (const target of first) assert.equal(Object.isFrozen(target), true);
	assert.throws(() => Object.assign(first, { 0: windowsTarget }), TypeError);
	assert.throws(() => Object.assign(first[0]!, { runner: 'ubuntu-24.04' }), TypeError);
	assert.deepEqual(selectTauriPrototypeBuildTargets('all'), second);
});
