/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	describeVideoSourceReprobeError,
	describeVideoSourceReprobeResult,
} from '../src/common/editor/source-reprobe-outcome.ts';
import { VideoSourceUpgradeRefusedError } from '../src/common/editor/video-source-upgrade.ts';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

test('an upgrade names what moved and what it could not keep whole', () => {
	assert.deepEqual(describeVideoSourceReprobeResult({
		upgraded: true,
		changedFields: ['frameRate', 'sourceFrameCount'],
		clampedClipIds: ['clip-a', 'clip-b'],
	}), {
		state: 'upgraded',
		copyKey: 'reprobeUpgraded',
		changedFields: ['frameRate', 'sourceFrameCount'],
		clampedCount: 2,
	});
});

test('a re-read that agrees is reported as agreement, not as a failure', () => {
	assert.deepEqual(describeVideoSourceReprobeResult({
		upgraded: false,
		changedFields: [],
		clampedClipIds: [],
	}), {
		state: 'unchanged',
		copyKey: 'reprobeUnchanged',
		changedFields: [],
		clampedCount: 0,
	});
});

test('every refusal the contract defines has its own sentence', () => {
	const reasons = [
		'media-unavailable',
		'content-changed',
		'probe-unavailable',
		'timing-regressed',
		'timing-asset-missing',
		'timing-asset-mismatch',
	] as const;
	for (const reason of reasons) {
		const view = describeVideoSourceReprobeError(new VideoSourceUpgradeRefusedError(reason, 'refused'));
		assert.equal(view.state, reason, `${reason} keeps its own state`);
		assert.equal(typeof ENGLISH_COPY[view.copyKey], 'string', `${reason} has English copy`);
		assert.equal(typeof GERMAN_COPY[view.copyKey], 'string', `${reason} has German copy`);
	}
});

test('an error the contract does not define stays a plain failure', () => {
	assert.deepEqual(describeVideoSourceReprobeError(new Error('storage exploded')), {
		state: 'failed',
		copyKey: 'reprobeFailed',
		changedFields: [],
		clampedCount: 0,
	});
	assert.equal(describeVideoSourceReprobeError(null).state, 'failed');
});
