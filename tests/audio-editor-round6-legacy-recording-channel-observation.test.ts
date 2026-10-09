/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLegacyRecordingCaptureService } from '../src/common/editor/controller/recording/internal/legacy-recording-capture-service.ts';
import type { RecordingCaptureCommonRuntime } from '../src/common/editor/controller/recording/recording-transaction-types.ts';
import { createRecordingCaptureFixture, createScope, deferred } from './fixtures/recording-capture-fixture.ts';

function nativeInput(options: Readonly<{ settingsWidth?: number; observedWidth: number; deferred?: boolean }>) {
	const descriptors = new Map(['AudioContext', 'AudioWorkletNode', 'MediaStream']
		.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	const probeRequested = deferred<void>();
	const nodes: NativeProbeNode[] = [];
	const sources: Array<{ disconnects: number }> = [];
	class NativeStream {
		stopCalls = 0;
		track = {
			readyState: 'live',
			getSettings: () => options.settingsWidth === undefined ? { latency: 0 } : { channelCount: options.settingsWidth, latency: 0 },
			stop: () => { this.stopCalls += 1; },
		};
		getAudioTracks() { return [this.track]; }
		getTracks() { return [this.track]; }
	}
	class NativeContext {
		sampleRate = 48_000; currentTime = 4; state = 'running'; destination = {};
		modules: string[] = [];
		audioWorklet = { addModule: async (url: string) => { this.modules.push(url); } };
		async resume() { this.state = 'running'; }
		createMediaStreamSource(stream: unknown) {
			assert.ok(stream instanceof NativeStream);
			const source = { disconnects: 0, connect() {}, disconnect() { this.disconnects += 1; } };
			sources.push(source);
			return source;
		}
	}
	class NativeProbeNode {
		disconnects = 0;
		onprocessorerror: (() => void) | null = null;
		port = {
			onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
			closed: 0,
			postMessage(message: unknown) {
				assert.deepEqual(message, { type: 'inspect-input-channel-count' });
				probeRequested.resolve();
			},
			close() { this.closed += 1; },
		};
		constructor(context: unknown, name: string, nodeOptions: AudioWorkletNodeOptions) {
			assert.ok(context instanceof NativeContext);
			assert.equal(name, 'kw-audio-recorder');
			assert.equal(nodeOptions.channelCountMode, 'max');
			nodes.push(this);
		}
		connect() {
			if (!options.deferred) queueMicrotask(() => { this.report(options.observedWidth); });
		}
		report(width: number) {
			this.port.onmessage?.(new MessageEvent('message', { data: { type: 'input-channel-count', channelCount: width } }));
		}
		disconnect() { this.disconnects += 1; }
	}
	for (const [key, value] of [['AudioContext', NativeContext], ['AudioWorkletNode', NativeProbeNode], ['MediaStream', NativeStream]] as const) {
		Object.defineProperty(globalThis, key, { value, configurable: true });
	}
	return {
		context: new NativeContext(), stream: new NativeStream(), sources, nodes, probeRequested,
		restore() {
			for (const [key, descriptor] of descriptors) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else Reflect.deleteProperty(globalThis, key);
			}
		},
	};
}

function captureFixture(input: ReturnType<typeof nativeInput>) {
	const fixture = createRecordingCaptureFixture();
	const metadata: Array<Readonly<Record<string, unknown>>> = [];
	const reservations: number[] = [];
	const previewWidths: number[] = [];
	const resamplerWidths: number[] = [];
	const runtime: RecordingCaptureCommonRuntime = {
		...fixture.runtime,
		engine: { ...fixture.runtime.engine, getAudioContext: async () => input.context },
		capturePool: { ...fixture.runtime.capturePool, acquireHardware: async () => input.stream },
		openSourceWriter: async (id, record) => {
			metadata.push(record);
			return fixture.runtime.openSourceWriter(id, record);
		},
		preflightStorage: async bytes => { reservations.push(bytes); },
		createPreview: options => {
			previewWidths.push(options.channelCount);
			return fixture.runtime.createPreview(options);
		},
		createPreviewResampler: (inputRate, outputRate, width) => {
			resamplerWidths.push(width);
			return fixture.runtime.createPreviewResampler(inputRate, outputRate, width);
		},
	};
	return { ...fixture, runtime, metadata, reservations, previewWidths, resamplerWidths };
}

test('legacy capture observes omitted stereo metadata before reserving and storing its two PCM planes', async () => {
	const input = nativeInput({ observedWidth: 2 });
	try {
		const fixture = captureFixture(input);
		await createLegacyRecordingCaptureService(fixture.runtime).capture({ trackId: 'track-1' }, createScope(() => true));
		assert.equal(fixture.recorderOptions()?.channelCount, 2);
		assert.equal(fixture.metadata[0]?.channelCount, 2);
		assert.deepEqual(fixture.reservations, [48_000 * 2 * 4 * 60]);
		assert.deepEqual(fixture.previewWidths, [2]);
		assert.deepEqual(fixture.resamplerWidths, [2]);
		const capture = fixture.recorderOptions(); assert.ok(capture);
		const left = Float32Array.from([.8, -.8]); const right = new Float32Array(2);
		await capture.onChunk({ frameStart: 0, frames: 2, channels: [left, right] });
		assert.deepEqual(fixture.writerRecords[0]?.writes, [[left, right]]);
		assert.equal(fixture.startCalls(), 1);
		assert.equal(fixture.state.recordingSampleRate, 48_000);
		assert.equal(input.sources[0]?.disconnects, 1);
		assert.equal(input.nodes[0]?.port.closed, 1);
		assert.equal(input.stream.stopCalls, 0);
	} finally { input.restore(); }
});

for (const width of [1, 2, 8]) {
	test(`legacy explicit ${String(width)}-channel metadata retains its capped width without a native probe`, async () => {
		const input = nativeInput({ settingsWidth: width, observedWidth: 32 });
		try {
			const fixture = captureFixture(input);
			await createLegacyRecordingCaptureService(fixture.runtime).capture({ trackId: 'track-1' }, createScope(() => true));
			assert.equal(fixture.recorderOptions()?.channelCount, Math.min(2, width));
			assert.equal(fixture.metadata[0]?.channelCount, Math.min(2, width));
			assert.equal(input.nodes.length, 0);
			assert.equal(input.context.modules.length, 0);
		} finally { input.restore(); }
	});
}

for (const width of [1, 8]) {
	test(`legacy omitted metadata observes ${String(width)} native channels and preserves its two-channel cap`, async () => {
		const input = nativeInput({ observedWidth: width });
		try {
			const fixture = captureFixture(input);
			await createLegacyRecordingCaptureService(fixture.runtime).capture({ trackId: 'track-1' }, createScope(() => true));
			assert.equal(fixture.recorderOptions()?.channelCount, Math.min(2, width));
			assert.equal(input.nodes.length, 1);
			assert.equal(input.nodes[0]?.port.closed, 1);
		} finally { input.restore(); }
	});
}

test('superseding legacy capture during native width observation releases inspection without creating a source', async () => {
	const input = nativeInput({ observedWidth: 2, deferred: true });
	try {
		const fixture = captureFixture(input);
		let current = true;
		const operation = createLegacyRecordingCaptureService(fixture.runtime).capture(
			{ trackId: 'track-1' }, createScope(() => current),
		);
		await Promise.race([input.probeRequested.promise, operation]);
		assert.equal(input.nodes.length, 1);
		assert.deepEqual(fixture.metadata, []);
		current = false;
		input.nodes[0]?.report(2);
		await operation;
		assert.equal(fixture.recorderCreations(), 0);
		assert.deepEqual(fixture.reservations, []);
		assert.deepEqual(fixture.metadata, []);
		assert.equal(fixture.releases(), 1);
		assert.equal(input.sources[0]?.disconnects, 1);
		assert.equal(input.nodes[0]?.port.closed, 1);
		assert.equal(input.stream.stopCalls, 0);
	} finally { input.restore(); }
});

test('legacy native width inspection failure releases inputs before storage or recorder creation', async () => {
	const input = nativeInput({ observedWidth: 0 });
	try {
		const fixture = captureFixture(input);
		await assert.rejects(createLegacyRecordingCaptureService(fixture.runtime).capture(
			{ trackId: 'track-1' }, createScope(() => true),
		), /observed channel count/iu);
		assert.equal(fixture.state.recordingStarting, false);
		assert.equal(fixture.recorderCreations(), 0);
		assert.deepEqual(fixture.metadata, []);
		assert.equal(fixture.releases(), 1);
		assert.equal(input.sources[0]?.disconnects, 1);
		assert.equal(input.nodes[0]?.port.closed, 1);
		assert.equal(input.stream.stopCalls, 0);
	} finally { input.restore(); }
});
