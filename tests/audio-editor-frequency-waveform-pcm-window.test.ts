/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSourceLifecycleFixture } from './helpers/audio-editor-source-lifecycle-fixture.ts';

test('resident source buffers provide bounded padded waveform PCM windows', async () => {
	const fixture = createSourceLifecycleFixture();
	const samples = Float32Array.from({ length: 100 }, (_, frame) => frame);
	fixture.cachedBuffers.set('source', { channels: [samples] });

	const window = await fixture.service.requestWaveformPcmWindow('clip', {
		startFrame: 20,
		endFrame: 30,
		sourcePaddingFrames: 8,
	});

	assert.equal(window?.startFrame, 12);
	assert.equal(window?.endFrame, 38);
	assert.equal(window?.visibleStartFrame, 20);
	assert.equal(window?.visibleEndFrame, 30);
	assert.deepEqual(window?.channels[0], samples.subarray(12, 38));
	assert.notEqual(window?.channels[0]?.buffer, samples.buffer);
	assert.equal(fixture.clipWaveformPcmWindows.get('clip')?.startFrame, 12);
	assert.equal(fixture.publishes(), 1);
});

test('ordinary waveform PCM windows retain their cached identity without frequency-only fields', async () => {
	const fixture = createSourceLifecycleFixture({ reuseContainedWaveformRequests: true });
	fixture.cachedBuffers.set('source', { channels: [new Float32Array(100)] });

	const first = await fixture.service.requestWaveformPcmWindow('clip', {
		startFrame: 20,
		endFrame: 30,
	});
	const cached = await fixture.service.requestWaveformPcmWindow('clip', {
		startFrame: 22,
		endFrame: 28,
	});

	assert.equal(first, fixture.clipWaveformPcmWindows.get('clip'));
	assert.equal(cached, first);
	assert.equal('visibleStartFrame' in (first ?? {}), false);
});

test('contained waveform PCM requests reuse an unsignaled read without sharing observer cancellation', async () => {
	const fixture = createSourceLifecycleFixture({ reuseContainedWaveformRequests: true });
	const observer = new AbortController();
	const first = fixture.service.requestWaveformPcmWindow('clip', {
		startFrame: 10,
		endFrame: 40,
	});
	const contained = fixture.service.requestWaveformPcmWindow('clip', {
		startFrame: 20,
		endFrame: 30,
		signal: observer.signal,
	});

	assert.equal(fixture.waveformPcmReads(), 1);
	assert.equal(fixture.waveformPcmReadSignals[0], undefined);
	observer.abort(new DOMException('Observer stopped waiting.', 'AbortError'));
	await assert.rejects(contained, { name: 'AbortError' });

	fixture.resolveRead([new Float32Array(30)]);
	assert.equal((await first)?.startFrame, 10);
});

test('an ordinary contained request does not inherit a frequency-owned read cancellation', async () => {
	const fixture = createSourceLifecycleFixture({ reuseContainedWaveformRequests: true });
	const owner = new AbortController();
	const frequencyRead = fixture.service.requestWaveformPcmWindow('clip', {
		startFrame: 10,
		endFrame: 40,
		signal: owner.signal,
	});
	const ordinaryRead = fixture.service.requestWaveformPcmWindow('clip', {
		startFrame: 20,
		endFrame: 30,
	});

	assert.equal(fixture.waveformPcmReads(), 2);
	assert.equal(fixture.waveformPcmReadSignals[1], undefined);
	owner.abort(new DOMException('Frequency window superseded.', 'AbortError'));
	await assert.rejects(frequencyRead, { name: 'AbortError' });
	fixture.resolveRead([new Float32Array(10)]);
	assert.equal((await ordinaryRead)?.startFrame, 20);
});

test('a contained request restarts an aborted owner read before its rejection settles', async () => {
	const fixture = createSourceLifecycleFixture({ reuseContainedWaveformRequests: true });
	const owner = new AbortController();
	const first = fixture.service.requestWaveformPcmWindow('clip', {
		startFrame: 10,
		endFrame: 40,
		signal: owner.signal,
	});

	owner.abort(new DOMException('Window superseded.', 'AbortError'));
	const replacement = fixture.service.requestWaveformPcmWindow('clip', {
		startFrame: 20,
		endFrame: 30,
	});

	assert.equal(fixture.waveformPcmReads(), 2);
	assert.equal(fixture.waveformPcmReadSignals[1], undefined);
	await assert.rejects(first, { name: 'AbortError' });
	fixture.resolveRead([new Float32Array(10)]);
	assert.equal((await replacement)?.startFrame, 20);
});
