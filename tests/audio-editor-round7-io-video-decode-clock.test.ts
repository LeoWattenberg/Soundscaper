/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { createImportVideoFile } from '../src/common/editor/controller/import/internal/source-import.ts';
import { createFixture, videoFile } from './helpers/audio-editor-source-import-fixture.ts';

function decodedBuffer(sampleRate: number) {
	const channels = [Float32Array.of(0, 0.1, 0.2, 0.3, 0.4, 0.3, 0.2, 0.1)];
	return {
		sampleRate, length: channels[0]!.length, numberOfChannels: channels.length,
		getChannelData: (channel: number) => channels[channel]!,
	};
}

async function importAtDeviceClock(deviceRate: number, refuseOffline = false) {
	const decodedRates: number[] = [];
	const materializedRates: number[] = [];
	class RealtimeContext {
		sampleRate = deviceRate;
		state = 'running';
		destination = {};
		async decodeAudioData() {
			decodedRates.push(this.sampleRate);
			return decodedBuffer(this.sampleRate);
		}
		async close() { this.state = 'closed'; }
	}
	class OfflineContext {
		readonly sampleRate: number;
		constructor(channels: number | Readonly<{ sampleRate: number }>, _length?: number, rate?: number) {
			this.sampleRate = typeof channels === 'object' ? channels.sampleRate : rate!;
		}
		async decodeAudioData() {
			if (refuseOffline) throw new Error('Native offline decoding is unavailable.');
			decodedRates.push(this.sampleRate);
			return decodedBuffer(this.sampleRate);
		}
	}
	const engine = createAudioEditorEngine({
		audioContextFactory: (() => new RealtimeContext()) as never,
		offlineAudioContextFactory: OfflineContext as never,
	});
	const fixture = createFixture();
	const buildBuffer = fixture.runtime.bufferFromChannels;
	const runtime = {
		...fixture.runtime,
		engine: {
			...fixture.runtime.engine,
			decodeAudioData: engine.decodeAudioData.bind(engine),
		},
		bufferFromChannels: (...args: Parameters<typeof buildBuffer>) => {
			materializedRates.push(args[1]);
			return buildBuffer(...args);
		},
	};
	try {
		const result = await createImportVideoFile(runtime)(videoFile('Camera take.mov'));
		assert.ok(result.audioSourceId, 'the normal video import publishes its linked audio');
		assert.equal(fixture.addedSources.find(({ kind }) => kind === 'audio')?.sampleRate, 48_000);
		return { decodedRates, materializedRates };
	} finally {
		await engine.dispose();
	}
}

test('48 kHz camera import decodes directly at the project clock on a 44.1 kHz output device', async () => {
	assert.deepEqual(await importAtDeviceClock(44_100), {
		decodedRates: [48_000], materializedRates: [48_000],
	}, 'an intermediate device-rate decode would discard source bands before canonicalization');
});

test('camera import keeps its native decode when the device and project clocks match', async () => {
	assert.deepEqual(await importAtDeviceClock(48_000), {
		decodedRates: [48_000], materializedRates: [48_000],
	});
});

test('camera import preserves the existing native fallback when offline decoding is unavailable', async () => {
	assert.deepEqual(await importAtDeviceClock(44_100, true), {
		decodedRates: [44_100], materializedRates: [44_100],
	});
});
