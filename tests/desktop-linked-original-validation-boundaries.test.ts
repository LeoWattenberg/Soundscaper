/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	absoluteLinkedOriginalPath,
	linkedOriginalReadTimestamp,
} from '../desktop/linked-original-locator-validation.ts';
import { LocalModelCapacity } from '../desktop/local-model-capacity.ts';
import {
	normalizeReadCapabilityFileIdentity,
	safeReadCapabilityTimestamp,
} from '../desktop/read-capability-support.js';

test('linked-original paths reject embedded NUL before filesystem access', () => {
	assert.throws(() => absoluteLinkedOriginalPath('/media/clip\0.wav'), /path/iu);
});

test('linked-original timestamps reject runtime strings instead of coercing them', () => {
	assert.throws(() => linkedOriginalReadTimestamp('12' as never), /time|number/iu);
	assert.equal(linkedOriginalReadTimestamp(12.75), 12);
});

test('read capability timestamps do not coerce non-numeric stat values', () => {
	assert.equal(safeReadCapabilityTimestamp('12'), 0);
	assert.equal(safeReadCapabilityTimestamp(12.75), 12);
});

test('linked-original file identities require exact safe integer device and inode values', () => {
	const baseline = { dev: 1, ino: 2, size: 10, mtimeMs: 1.25, ctimeMs: 2.5 };
	assert.deepEqual({ ...normalizeReadCapabilityFileIdentity(baseline) }, baseline);
	for (const value of [1.5, Number.MAX_SAFE_INTEGER + 1]) {
		assert.throws(() => normalizeReadCapabilityFileIdentity({ ...baseline, dev: value }), /identity/iu);
		assert.throws(() => normalizeReadCapabilityFileIdentity({ ...baseline, ino: value }), /identity/iu);
	}
});

test('local-model capacity rejects NUL paths before statfs', async () => {
	let calls = 0;
	const capacity = new LocalModelCapacity({ statfsImpl: () => {
		calls += 1;
		return { bavail: 10n, bsize: 1n };
	} });
	await assert.rejects(capacity.reserve('/models/clip\0', 1), /destination|path/iu);
	assert.equal(calls, 0);
});
