/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundActivatedRecordingCaptureSession } from '../src/common/editor/controller/recording/internal/sound-activation/sound-activated-recording-capture-session.ts';

const source = Object.freeze({ sourceKey: 'device:default', kind: 'device' as const, sampleRate: 48_000, channelCount: 1 });
const settings = Object.freeze({ thresholdDb: -40, hysteresisDb: 6, holdFrames: 12_000 });

for (const enabled of [true, false]) {
	test(`${enabled ? 'activated' : 'ordinary'} recording preserves the worklet's final audible Stop flush`, async () => {
		const session = createSoundActivatedRecordingCaptureSession(enabled ? {
			getSettings: () => settings,
			setState() {},
		} : undefined, source, () => true);
		const saved: number[] = [];
		const append = (start: number, samples: Float32Array): void => {
			for (const segment of session.process({ frameStart: start, frames: samples.length, channels: [samples] })) {
				saved.push(...segment.channels[0]!);
			}
		};
		const controller = session.wrapController({
			start() {}, pause: () => true, resume: () => true,
			async stop() {
				// The real worklet posts its partial audio-chunk before stopped;
				// the recording controller drains that write before resolving Stop.
				await Promise.resolve();
				append(4_096, Float32Array.of(0.125, 0.25, 0.375));
			},
			setMonitoring() {}, setInputGain() {},
		});
		controller.start();
		append(0, new Float32Array(4_096).fill(0.125));
		await controller.stop();
		assert.equal(saved.length, 4_099);
		assert.deepEqual(saved.slice(-3), [0.125, 0.25, 0.375]);
		assert.equal(session.state, enabled ? 'cancelled' : null);
	});
}

test('a rejected recorder Stop retires the sound-activation session after preserving the original failure', async () => {
	const session = createSoundActivatedRecordingCaptureSession({ getSettings: () => settings, setState() {} }, source, () => true);
	const failure = new Error('Input device stopped responding');
	const controller = session.wrapController({
		start() {}, pause: () => true, resume: () => true,
		stop: () => Promise.reject(failure), setMonitoring() {}, setInputGain() {},
	});
	controller.start();
	await assert.rejects(Promise.resolve(controller.stop()), error => error === failure);
	assert.equal(session.state, 'cancelled');
});
