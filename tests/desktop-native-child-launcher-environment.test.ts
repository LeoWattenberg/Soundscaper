/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { nativeChildLauncherEnvironment } from '../desktop/native-child-launcher-environment.ts';

const BASE = Object.freeze({ LANG: 'C', LC_ALL: 'C', PATH: '', HOME: '/nonexistent' });

test('native child launch keeps non-Windows environments closed', () => {
	assert.deepEqual(nativeChildLauncherEnvironment('linux-x64', {
		SECRET: 'not inherited', SystemRoot: 'C:\\Windows',
	}), BASE);
});

test('Windows launch admits only its three required substrate paths', () => {
	const environment = nativeChildLauncherEnvironment('win-arm64', {
		systemroot: 'C:\\Windows', SYSTEMDRIVE: 'C:', LocalAppData: 'C:\\Users\\runner\\AppData\\Local',
		SECRET: 'not inherited',
	});
	assert.deepEqual(environment, {
		...BASE,
		SystemRoot: 'C:\\Windows',
		SystemDrive: 'C:',
		LOCALAPPDATA: 'C:\\Users\\runner\\AppData\\Local',
	});
	assert.equal(Object.isFrozen(environment), true);
});

test('Windows launch fails closed when substrate paths are unavailable', () => {
	for (const source of [
		{ SystemDrive: 'C:', LOCALAPPDATA: 'C:\\Users\\runner\\AppData\\Local' },
		{ SystemRoot: 'C:\\Windows', SystemDrive: 'C:', LOCALAPPDATA: '' },
	]) {
		assert.throws(() => nativeChildLauncherEnvironment('win-x64', source),
			/Windows native child substrate environment is incomplete/iu);
	}
});
