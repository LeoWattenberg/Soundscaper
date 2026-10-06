/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioGeneratorService } from '../src/common/editor/controller/edit/generator-service.ts';
import { createFixture } from './helpers/audio-editor-generator-service-fixture.ts';

test('generated source, success status and released busy state share one synchronous presentation batch', async () => {
	let batch = 0; let nextBatch = 0;
	const observed: Array<{ kind: string; batch: number }> = [];
	const fixture = createFixture({
		batchPresentation(operation) {
			const prior = batch; batch = ++nextBatch;
			try { operation(); } finally { batch = prior; }
		},
		commit() { observed.push({ kind: 'commit', batch }); },
		setStatus(_status, state) { if (state === 'success') observed.push({ kind: 'success', batch }); },
		setEffectProcessing(processing) {
			fixture.state.audacityEffectProcessing = processing;
			if (!processing) observed.push({ kind: 'idle', batch });
		},
	});
	const service = createAudioGeneratorService(fixture.dependencies);
	await service.generateSignal('tone', { durationSeconds: 0.01 });
	assert.deepEqual(observed.map(value => value.kind), ['commit', 'success', 'idle']);
	assert.ok(observed[0]!.batch > 0);
	assert.equal(new Set(observed.map(value => value.batch)).size, 1);
	assert.equal(fixture.state.audacityEffectProcessing, false);
});
