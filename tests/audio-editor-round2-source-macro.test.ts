/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness } from './helpers/effect-macro-service-fixture.ts';

test('a leading realtime source-editor macro stages its source PCM on the native clock', async () => {
	const fixture = createHarness({ sourceSampleRate: 44_100, memoryLimitBytes: 64 * 1024 ** 2 });
	assert.equal(await fixture.service.runEffectMacro({ effects: [{ id: 'invert', type: 'audacity-invert', params: {} }] }), true);
	assert.deepEqual(fixture.dryRanges, [['source-editor:source-a', 100, 300]]);
	assert.equal(fixture.snapshots.length, 0);
	assert.equal(fixture.stagedProjects.length, 1);
	assert.equal(fixture.stagedProjects[0]!.sampleRate, 44_100);
	assert.deepEqual(fixture.bufferSampleRates, [44_100]);
	assert.equal(fixture.persisted.length, 1);
});

test('an offline source-editor macro gives its effect worker the native sample rate', async () => {
	const fixture = createHarness({ sourceSampleRate: 44_100, memoryLimitBytes: 64 * 1024 ** 2 });
	assert.equal(await fixture.service.runEffectMacro({ effects: [{ id: 'amplify', type: 'audacity-amplify', params: { gainDb: 3 } }] }), true);
	assert.equal(fixture.selectionEffectCalls[0]!.sampleRate, 44_100);
});
