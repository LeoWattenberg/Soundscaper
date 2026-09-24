/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	modelTestCleanupDiagnostic, withModelTestElectron,
} from './electron/local-assistance-models/model-test-lifecycle.js';

test('model step failure remains primary when coverage cleanup also fails', async () => {
	const stepFailure = new Error('Kokoro installation failed');
	const cleanupFailure = new Error('Coverage found no preload');
	const reported = [];
	await assert.rejects(withModelTestElectron({ close: async () => { throw cleanupFailure; } },
		async () => { throw stepFailure; }, async (error) => { reported.push(error); }),
		(error) => error === stepFailure);
	assert.deepEqual(reported, [cleanupFailure]);
});

test('coverage cleanup failure remains a failure when model step succeeds', async () => {
	const cleanupFailure = new Error('Coverage found no preload');
	await assert.rejects(withModelTestElectron({ close: async () => { throw cleanupFailure; } },
		async () => 'model complete'), (error) => error === cleanupFailure);
});

test('reporting failure cannot replace the model step failure', async () => {
	const stepFailure = new Error('Model operation failed');
	await assert.rejects(withModelTestElectron({ close: async () => { throw new Error('Coverage failed'); } },
		async () => { throw stepFailure; }, async () => { throw new Error('Attachment failed'); }),
		(error) => error === stepFailure);
});

test('cleanup evidence retains a pathless failure without exposing profile paths', () => {
	assert.deepEqual(modelTestCleanupDiagnostic(new Error('Coverage found no preload')),
		{ name: 'Error', message: 'Coverage found no preload' });
	assert.deepEqual(modelTestCleanupDiagnostic(new Error('ENOENT C:\\Users\\someone\\profile')),
		{ name: 'Error', message: '[path-bearing message omitted]' });
});
