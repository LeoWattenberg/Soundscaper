/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperBrowserAudioRecorder } from '../src/common/editor/controller/capture/internal/browser/framescaper-browser-audio-recorder.ts';

function fixture(sampleRate: number, contextRate: number, failSetup = false) {
	const events: string[] = [];
	const context = { sampleRate: contextRate };
	const owned = { sampleRate, resume: async () => { events.push('resume'); },
		close: async () => { events.push('close'); } };
	const options = {
		role: 'microphone' as const,
		track: { kind: 'audio', getSettings: () => ({ sampleRate, channelCount: 1 }) },
		stream: {}, context, MediaStreamTrackProcessor: null, monitoring: true,
		createAudioContext: (rate: number) => { events.push(`create:${rate}`); return owned; },
		recordingControllerFactory: (input: Readonly<{ context: unknown }>) => {
			assert.equal(input.context, sampleRate === contextRate ? context : owned);
			events.push('setup');
			if (failSetup) throw new Error('Recorder setup failed');
			return { start: () => { events.push('start'); }, pause: () => true, resume: () => true,
				stop: async () => { events.push('stop'); }, detach: async () => { events.push('detach'); } };
		},
		onChunk: () => undefined,
	};
	return { options, events };
}

test('a monitored microphone retains its native rate when the shared editor context differs', async () => {
	for (const [rate, contextRate] of [[48_000, 44_100], [44_100, 48_000], [96_000, 48_000]]) {
		const harness = fixture(rate!, contextRate!);
		const recorder = await createFramescaperBrowserAudioRecorder(harness.options);
		assert.equal(recorder.sampleRate, rate);
		assert.equal(recorder.backend, 'audio-worklet');
		assert.deepEqual(harness.events, [`create:${String(rate)}`, 'resume', 'setup']);
		await recorder.start();
		await recorder.stop();
		await recorder.dispose();
		await recorder.dispose();
		assert.deepEqual(harness.events, [`create:${String(rate)}`, 'resume', 'setup', 'start', 'stop', 'detach', 'close']);
	}
});

test('matching native rates keep the borrowed editor context alive', async () => {
	const harness = fixture(48_000, 48_000);
	const recorder = await createFramescaperBrowserAudioRecorder(harness.options);
	await recorder.start();
	await recorder.dispose();
	assert.deepEqual(harness.events, ['setup', 'start', 'stop', 'detach']);
});

test('failed recorder preparation retires its owned source-rate context', async () => {
	const harness = fixture(48_000, 44_100, true);
	await assert.rejects(createFramescaperBrowserAudioRecorder(harness.options), /Recorder setup failed/u);
	assert.deepEqual(harness.events, ['create:48000', 'resume', 'setup', 'close']);
});

test('a context constructor that cannot retain the selected source rate is refused and retired', async () => {
	const harness = fixture(48_000, 44_100);
	harness.options.createAudioContext = () => ({ sampleRate: 44_100,
		resume: async () => { harness.events.push('resume'); },
		close: async () => { harness.events.push('close'); } });
	await assert.rejects(createFramescaperBrowserAudioRecorder(harness.options), /retain the source track sample rate/u);
	assert.deepEqual(harness.events, ['close']);
});

test('failed context activation closes the owned context before any recorder starts', async () => {
	const harness = fixture(48_000, 44_100);
	harness.options.createAudioContext = () => ({ sampleRate: 48_000,
		resume: async () => { throw new Error('Audio context activation failed'); },
		close: async () => { harness.events.push('close'); } });
	await assert.rejects(createFramescaperBrowserAudioRecorder(harness.options), /Audio context activation failed/u);
	assert.deepEqual(harness.events, ['close']);
});
