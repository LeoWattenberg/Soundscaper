/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	NATIVE_HELPER_ROLES,
	createNativeHelperWorker,
	nativeHelperRole,
} from '../desktop/native-helper-process.js';

test('Vamp analysis owns a dedicated plugin-analyzer helper role and subcontract', () => {
	assert.deepEqual(NATIVE_HELPER_ROLES['plugin-analyzer'], {
		kind: 'plugin-analyze', serviceName: 'soundscaper-native-plugin-analyzer',
	});
	assert.equal(nativeHelperRole('plugin-analyzer').kind, 'plugin-analyze');
	const posted = [];
	const worker = createNativeHelperWorker({
		role: 'plugin-analyzer', post: (message) => posted.push(message),
		runHostJob: () => { throw new Error('effect host must remain unreachable'); },
		runAnalyzerJob: () => ({ completion: Promise.resolve({ format: 'vamp' }), cancel: async () => {} }),
		setIntervalImpl: () => 1, clearIntervalImpl: () => {},
	});
	assert.ok(worker);
	assert.equal(posted[0].type, 'hello');
	assert.deepEqual(posted[0].kinds, ['plugin-analyze']);
});

test('main admits plugin-analyzer as a professional native helper supervisor role', async () => {
	const source = await readFile(new URL('../desktop/native-helper-registration.mjs', import.meta.url), 'utf8');
	assert.match(source, /'plugin-analyzer'/u);
});
