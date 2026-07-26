/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSettingPersistence } from '../src/common/editor/controller/setting-persistence.ts';

test('best-effort setting writes resolve with a controlled warning', async () => {
	const failure = new Error('quota');
	const warnings: unknown[] = [];
	const persistence = createSettingPersistence({
		write: async () => { throw failure; },
		onWarning: (error, key) => warnings.push({ error, key }),
	});
	assert.equal(await persistence.persist('workspace', { dock: 'right' }), null);
	assert.deepEqual(warnings, [{ error: failure, key: 'workspace' }]);
});

test('required setting writes preserve the storage rejection', async () => {
	const failure = new Error('closed');
	const persistence = createSettingPersistence({
		write: async () => { throw failure; },
	});
	await assert.rejects(
		persistence.persist('recording-routing', {}, { policy: 'required' }),
		(error) => error === failure,
	);
});

test('late setting failures after disposal do not publish warnings', async () => {
	const warnings: unknown[] = [];
	const persistence = createSettingPersistence({
		write: async () => { throw new Error('late'); },
		isInactive: () => true,
		onWarning: (error) => warnings.push(error),
	});
	assert.equal(await persistence.persist('meter', 1), null);
	assert.deepEqual(warnings, []);
});
