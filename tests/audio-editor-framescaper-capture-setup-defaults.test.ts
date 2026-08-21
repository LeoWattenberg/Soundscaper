/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperCaptureSetupDefaults,
	normalizeFramescaperCaptureSetupDefaults,
} from '../src/common/editor/controller/framescaper-capture-setup-defaults.ts';

test('capture setup defaults are controller-owned, closed, frozen, and observable', () => {
	let changes = 0;
	const defaults = createFramescaperCaptureSetupDefaults(() => { changes += 1; });
	assert.deepEqual(defaults.snapshot, { destination: 'both', countdownMs: 3_000 });
	assert.equal(Object.isFrozen(defaults.snapshot), true);

	defaults.update({ destination: 'project-bin' });
	defaults.update({ countdownMs: 0 });
	assert.deepEqual(defaults.snapshot, { destination: 'project-bin', countdownMs: 0 });
	assert.equal(changes, 2);
	assert.throws(() => defaults.update({ extra: true } as never), /closed shape/iu);
	assert.throws(() => normalizeFramescaperCaptureSetupDefaults({
		destination: 'both', countdownMs: 1_000,
	}), /unsupported/iu);
});
