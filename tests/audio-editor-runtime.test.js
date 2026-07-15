import test from 'node:test';
import assert from 'node:assert/strict';

import {
	PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT_BYTES,
	buildProjectGraph,
	createAudioEditorEngine,
	estimatePlayAtSpeedStaffPadPeakBytes,
	getProjectDurationFrames,
	projectGraphLatencyFrames,
} from '../src/lib/tools/audio-editor/engine.js';
import { createRecordingController } from '../src/lib/tools/audio-editor/recording.js';
import { StreamingRecorderProcessor } from '../src/lib/tools/audio-editor/recording-worklet.js';
import { RenderCaptureProcessor } from '../src/lib/tools/audio-editor/render-capture-worklet.js';
import { DynamicsProcessor } from '../src/lib/tools/audio-editor/dynamics-worklet.js';
import {
	createStreamingLinearResampler,
	createStreamingWindowedSincResampler,
} from '../src/lib/tools/audio-editor/resample.js';
import { createProjectStore } from '../src/lib/tools/audio-editor/storage.js';
import { createWavStreamEncoder, encodeWav } from '../src/lib/tools/audio-editor/wav.js';

function concatenateFloat32(parts) {
	const output = new Float32Array(parts.reduce((length, part) => length + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.length;
	}
	return output;
}

test('WAV encoder writes valid PCM and float headers and supports chunk emission', async () => {
	const pcm = encodeWav([Float32Array.from([-1, 0, 1])], {
		sampleRate: 48000,
		bitDepth: 16,
		dither: false,
	});
	const view = new DataView(pcm.buffer);
	assert.equal(textAt(pcm, 0, 4), 'RIFF');
	assert.equal(textAt(pcm, 8, 4), 'WAVE');
	assert.equal(view.getUint16(20, true), 1);
	assert.equal(view.getUint16(22, true), 1);
	assert.equal(view.getUint32(24, true), 48000);
	assert.equal(view.getUint16(34, true), 16);
	assert.equal(view.getUint32(40, true), 6);
	assert.equal(view.getInt16(44, true), -32768);
	assert.equal(view.getInt16(46, true), 0);
	assert.equal(view.getInt16(48, true), 32767);

	const floating = encodeWav([Float32Array.of(0.25, 1.25)], { float: true, dither: false });
	assert.equal(new DataView(floating.buffer).getUint16(20, true), 3);
	assert.equal(new DataView(floating.buffer).getFloat32(44, true), 0.25);
	assert.equal(new DataView(floating.buffer).getFloat32(48, true), 1.25);

});

test('streaming WAV encoder returns metadata without retaining PCM chunks', async () => {
	const emitted = [];
	const encoder = createWavStreamEncoder({
		totalFrames: 3,
		channelCount: 2,
		bitDepth: 24,
		dither: false,
		onChunk: (chunk, info) => emitted.push({ bytes: chunk.byteLength, ...info }),
	});
	encoder.write([Float32Array.of(0, 0), Float32Array.of(0, 0)]);
	encoder.write([Float32Array.of(0), Float32Array.of(0)]);
	const result = encoder.finalize();
	await encoder.settled();
	assert.equal(result.byteLength, 62);
	assert.equal(result.frames, 3);
	assert.deepEqual(emitted.map((entry) => entry.bytes), [44, 12, 6]);
	assert.deepEqual(emitted.map((entry) => entry.frameOffset), [0, 0, 2]);
	assert.throws(() => encoder.write([Float32Array.of(0), Float32Array.of(0)]), /finalized/);
});

test('streaming resampler is chunk-stable and pads requested tails with silence', () => {
	const input = Float32Array.from({ length: 480 }, (_, index) => Math.sin(index / 17));
	const oneShot = createStreamingLinearResampler(48_000, 44_100, 1);
	const oneShotParts = [oneShot.push([input])[0], oneShot.finish(500)[0]];
	const chunked = createStreamingLinearResampler(48_000, 44_100, 1);
	const chunkedParts = [
		chunked.push([input.subarray(0, 137)])[0],
		chunked.push([input.subarray(137, 391)])[0],
		chunked.push([input.subarray(391)])[0],
		chunked.finish(500)[0],
	];
	const expected = concatenateFloat32(oneShotParts);
	const actual = concatenateFloat32(chunkedParts);
	assert.equal(actual.length, 500);
	assert.deepEqual(actual, expected);
	assert.equal(actual.at(-1), 0);
	assert.equal(actual.at(-20), 0);
});

test('windowed-sinc resampler is deterministic across chunk boundaries and rejects alias energy', () => {
	const input = Float32Array.from({ length: 4_800 }, (_, index) => (
		0.6 * Math.sin(2 * Math.PI * 1_000 * index / 48_000)
		+ 0.4 * Math.sin(2 * Math.PI * 20_000 * index / 48_000)
	));
	const oneShot = createStreamingWindowedSincResampler(48_000, 16_000, 1);
	const expected = concatenateFloat32([oneShot.push([input])[0], oneShot.finish()[0]]);
	const chunked = createStreamingWindowedSincResampler(48_000, 16_000, 1);
	const actual = concatenateFloat32([
		chunked.push([input.subarray(0, 777)])[0],
		chunked.push([input.subarray(777, 3_211)])[0],
		chunked.push([input.subarray(3_211)])[0],
		chunked.finish()[0],
	]);
	assert.equal(actual.length, 1_600);
	assert.equal(chunked.inputFrames, 4_800);
	assert.equal(chunked.outputFrames, 1_600);
	for (let index = 0; index < actual.length; index += 1) {
		assert.ok(Math.abs(actual[index] - expected[index]) < 1e-6);
	}
	const rms = Math.sqrt(actual.reduce((sum, sample) => sum + sample * sample, 0) / actual.length);
	assert.ok(rms > 0.35 && rms < 0.5, `unexpected band-limited RMS ${rms}`);

	const padded = createStreamingWindowedSincResampler(48_000, 16_000, 1);
	const paddedOutput = concatenateFloat32([padded.push([input])[0], padded.finish(1_650)[0]]);
	assert.equal(paddedOutput.length, 1_650);
	assert.deepEqual([...paddedOutput.slice(-50)], [...new Float32Array(50)]);
});

test('memory project store retains revisions and streams immutable source chunks', async () => {
	const store = createProjectStore({ indexedDB: null, databaseName: `test-${Date.now()}-${Math.random()}` });
	assert.equal(store.backend, 'memory');
	await store.saveProject({ id: 'project-1', title: 'First', revision: 1, updatedAt: '2026-01-01' });
	await store.saveProject({ id: 'project-1', title: 'Second', revision: 2, updatedAt: '2026-01-02' });
	assert.equal((await store.loadProject('project-1')).title, 'Second');
	assert.equal((await store.loadProject('project-1', { revision: 1 })).title, 'First');
	assert.deepEqual((await store.listProjectRevisions('project-1')).map((entry) => entry.revision), [2, 1]);

	await store.saveSetting('monitor', false);
	await store.saveAnalysis('mix:1', { lufs: -14 });
	assert.equal(await store.loadSetting('monitor', true), false);
	assert.deepEqual(await store.loadAnalysis('mix:1'), { lufs: -14 });

	const writer = await store.beginSourceWrite('source-1', { sampleRate: 48000 });
	await writer.write([Float32Array.of(0, 0.5), Float32Array.of(1, -1)]);
	await writer.write([Float32Array.of(0.25), Float32Array.of(-0.25)]);
	const metadata = await writer.commit({ name: 'take.wav' });
	assert.equal(metadata.storage, 'indexeddb-chunks');
	assert.equal(metadata.frameLength, 3);
	assert.equal(metadata.channelCount, 2);
	const chunks = [];
	for await (const chunk of store.readSourceChunks('source-1')) chunks.push(chunk);
	assert.deepEqual(chunks.map((chunk) => chunk.frames), [2, 1]);
	assert.deepEqual([...chunks[0].channels[1]], [1, -1]);
	assert.deepEqual((await store.listSources()).map((source) => source.id), ['source-1']);
	const restored = await store.loadSourceAudioBuffer('source-1', {
		createBuffer: (channelCount, frameCount, sampleRate) => new MockAudioBuffer(channelCount, frameCount, sampleRate),
	});
	assert.deepEqual([...restored.getChannelData(0)], [0, 0.5, 0.25]);

	const abandoned = await store.beginSourceWrite('source-2');
	await abandoned.write([Float32Array.of(1)]);
	await abandoned.abort();
	assert.equal(await store.getSourceMetadata('source-2'), null);

	const copy = await store.duplicateProject('project-1', { id: 'project-2', title: 'Copy' });
	assert.equal(copy.id, 'project-2');
	assert.equal((await store.listProjects()).length, 2);
	await store.deleteSource('source-1');
	await assert.rejects(async () => {
		for await (const _chunk of store.readSourceChunks('source-1')) { /* consume */ }
	}, /could not be found/);
	await store.clear();
	assert.deepEqual(await store.listProjects(), []);
});

test('copy-on-write sources share untouched chunks and retain base dependencies through garbage collection', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `copy-on-write-${Date.now()}-${Math.random()}`,
	});
	const writer = await store.beginSourceWrite('cow-base', {
		sampleRate: 48_000,
		channelCount: 1,
		chunkFrames: 65_536,
	});
	await writer.write([Float32Array.from({ length: 65_536 }, (_, frame) => frame / 65_536)]);
	await writer.write([Float32Array.of(0.25, 0.5)]);
	await writer.commit({ chunkFrames: 65_536 });

	const replacement = Float32Array.from({ length: 65_536 }, () => -0.5);
	const derived = await store.writeDerivedSource('cow-derived', 'cow-base', [
		{ index: 0, channels: [replacement] },
	], { sampleRate: 48_000, channelCount: 1, chunkFrames: 65_536 });
	assert.equal(derived.storage, 'copy-on-write');
	assert.equal(derived.overrideChunkCount, 1);
	assert.equal(derived.baseSourceId, 'cow-base');

	const chunks = [];
	for await (const chunk of store.readSourceChunks('cow-derived')) chunks.push(chunk);
	assert.deepEqual(chunks.map((chunk) => chunk.frames), [65_536, 2]);
	assert.equal(chunks[0].channels[0][100], -0.5);
	assert.deepEqual([...chunks[1].channels[0]], [0.25, 0.5]);
	await assert.rejects(() => store.deleteSource('cow-base'), /retained by derived source cow-derived/);

	const future = Date.now() + 2 * 24 * 60 * 60 * 1000;
	let result = await store.pruneUnreferencedSources({
		protectedProjects: [{ clips: [{ sourceId: 'cow-derived' }] }],
		minimumAgeMs: 0,
		now: future,
	});
	assert.deepEqual(result.deletedSourceIds, []);
	assert.deepEqual(new Set(result.retainedSourceIds), new Set(['cow-base', 'cow-derived']));

	result = await store.pruneUnreferencedSources({ minimumAgeMs: 0, now: future });
	assert.deepEqual(new Set(result.deletedSourceIds), new Set(['cow-base', 'cow-derived']));
	assert.equal(await store.getSourceMetadata('cow-base'), null);
	assert.equal(await store.getSourceMetadata('cow-derived'), null);
});

test('project store bounds durable manifest revisions while retaining recovery history', async () => {
	const store = createProjectStore({ indexedDB: null, databaseName: `revision-limit-${Date.now()}-${Math.random()}`, revisionLimit: 4 });
	for (let revision = 0; revision < 7; revision += 1) {
		await store.saveProject({ id: 'bounded', revision, updatedAt: `2026-01-${String(revision + 1).padStart(2, '0')}` });
	}
	assert.deepEqual((await store.listProjectRevisions('bounded')).map((entry) => entry.revision), [6, 5, 4, 3]);
});

test('source pruning preserves live history and retained revisions before removing metadata, peaks, and chunks', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `source-retention-${Date.now()}-${Math.random()}`,
		revisionLimit: 2,
	});
	const sourceIds = ['original', 'effect-1', 'effect-2', 'abandoned'];
	for (const sourceId of sourceIds) {
		const writer = await store.beginSourceWrite(sourceId, { sampleRate: 48_000, name: `${sourceId}.wav` });
		await writer.write([Float32Array.of(0.1, 0.2)]);
		await writer.commit();
		await store.saveAnalysis(`audio-editor-peaks-v1:${sourceId}`, { levels: [sourceId] });
	}
	const project = (revision, sourceId, extraSources = []) => ({
		id: 'retained-project',
		revision,
		updatedAt: `2026-07-13T00:00:0${revision}.000Z`,
		sources: [sourceId, ...extraSources].map((id) => ({ id, frameCount: 2, channelCount: 1 })),
		clips: [{ id: `clip-${revision}`, sourceId }],
	});
	const pruneNow = Date.now() + 2 * 24 * 60 * 60 * 1000;

	await store.saveProject(project(1, 'original', ['abandoned']));
	await store.saveProject(project(2, 'effect-1'));
	assert.equal((await store.getSourceMetadata('original')).pendingProjectUntil, undefined);
	assert.equal((await store.getSourceMetadata('effect-1')).pendingProjectUntil, undefined);
	assert.equal(typeof (await store.getSourceMetadata('effect-2')).pendingProjectUntil, 'string');
	let result = await store.pruneUnreferencedSources({
		protectedProjects: [project(3, 'effect-2')],
		minimumAgeMs: 0,
		now: pruneNow,
	});
	assert.deepEqual(result.deletedSourceIds, ['abandoned']);
	assert.equal(await store.getSourceMetadata('original') != null, true);
	assert.equal(await store.getSourceMetadata('effect-1') != null, true);
	assert.equal(await store.getSourceMetadata('effect-2') != null, true);
	assert.equal(await store.getSourceMetadata('abandoned'), null);
	assert.equal(await store.loadAnalysis('audio-editor-peaks-v1:abandoned'), null);
	assert.deepEqual((await store.loadProject('retained-project', { revision: 1 })).sources.map((source) => source.id), ['original']);

	await store.saveProject(project(3, 'effect-2'));
	assert.deepEqual((await store.listProjectRevisions('retained-project')).map((entry) => entry.revision), [3, 2]);
	result = await store.pruneUnreferencedSources({ minimumAgeMs: 0, now: pruneNow });
	assert.deepEqual(result.deletedSourceIds, ['original']);
	assert.equal(await store.getSourceMetadata('original'), null);
	assert.equal(await store.loadAnalysis('audio-editor-peaks-v1:original'), null);
	await assert.rejects(async () => {
		for await (const _chunk of store.readSourceChunks('original')) { /* consume */ }
	}, /could not be found/);
	const retainedRevision = await store.loadProject('retained-project', { revision: 2 });
	assert.deepEqual(retainedRevision.sources.map((source) => source.id), ['effect-1']);
	const retainedAudio = await store.loadSourceAudioBuffer('effect-1', {
		createBuffer: (channelCount, frameCount, sampleRate) => new MockAudioBuffer(channelCount, frameCount, sampleRate),
	});
	assert.equal(retainedAudio.length, 2);

	await store.saveProject(project(4, 'effect-2'));
	result = await store.pruneUnreferencedSources({ minimumAgeMs: 0, now: pruneNow });
	assert.deepEqual(result.deletedSourceIds, ['effect-1']);
	assert.equal(await store.getSourceMetadata('effect-1'), null);
	assert.equal(await store.getSourceMetadata('effect-2') != null, true);
	assert.deepEqual((await store.loadProject('retained-project', { revision: 3 })).sources.map((source) => source.id), ['effect-2']);
});

test('source pruning durably protects unpublished sources and reports when abandoned writes become eligible', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `source-grace-${Date.now()}-${Math.random()}`,
	});
	const writer = await store.beginSourceWrite('fresh-orphan', { sampleRate: 48_000 });
	await writer.write([Float32Array.of(0.25)]);
	const metadata = await writer.commit();
	const pendingProjectUntil = Date.parse(metadata.pendingProjectUntil);
	let result = await store.pruneUnreferencedSources({ minimumAgeMs: 5_000, now: pendingProjectUntil - 1 });
	assert.deepEqual(result.deletedSourceIds, []);
	assert.deepEqual(result.deferredSourceIds, ['fresh-orphan']);
	assert.equal(result.nextEligibleAt, pendingProjectUntil);
	assert.equal(await store.getSourceMetadata('fresh-orphan') != null, true);

	result = await store.pruneUnreferencedSources({ minimumAgeMs: 5_000, now: pendingProjectUntil });
	assert.deepEqual(result.deletedSourceIds, ['fresh-orphan']);
	assert.equal(result.nextEligibleAt, null);
	assert.equal(await store.getSourceMetadata('fresh-orphan'), null);
});

test('project store prefers OPFS for bounded source writes when it is available', async () => {
	const files = new Map();
	const sourceDirectory = {
		async getFileHandle(path, options = {}) {
			if (!files.has(path) && !options.create) throw new Error('missing');
			if (!files.has(path)) files.set(path, { blob: new Blob() });
			const entry = files.get(path);
			return {
				async createWritable() {
					const parts = [];
					return {
						async write(part) { parts.push(part); },
						async close() { entry.blob = new Blob(parts); },
						async abort() { parts.length = 0; },
					};
				},
				async getFile() { return entry.blob; },
			};
		},
		async removeEntry(path) {
			if (!files.delete(path)) throw new Error('missing');
		},
	};
	const root = { async getDirectoryHandle() { return sourceDirectory; } };
	const store = createProjectStore({
		indexedDB: null,
		databaseName: `opfs-${Date.now()}-${Math.random()}`,
		storageManager: { async getDirectory() { return root; } },
	});
	const writer = await store.beginSourceWrite('opfs-source', { sampleRate: 48000 });
	await writer.write([Float32Array.of(0.1, 0.2)]);
	await writer.write([Float32Array.of(0.3)]);
	const metadata = await writer.commit();
	assert.equal(metadata.storage, 'opfs');
	assert.equal(files.size, 1);
	const chunks = [];
	for await (const chunk of store.readSourceChunks('opfs-source')) chunks.push([...chunk.channels[0]]);
	assert.ok(Math.abs(chunks[0][0] - 0.1) < 1e-6);
	assert.ok(Math.abs(chunks[1][0] - 0.3) < 1e-6);
	await store.deleteSource('opfs-source');
	assert.equal(files.size, 0);
});

test('project store writes AudioBuffers in bounded source chunks', async () => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `buffer-${Date.now()}-${Math.random()}` });
	const buffer = new MockAudioBuffer(1, 5, 48000);
	buffer.getChannelData(0).set([1, 2, 3, 4, 5]);
	const metadata = await store.writeAudioBuffer('buffer-source', buffer, { name: 'buffer' }, { chunkFrames: 2 });
	assert.equal(metadata.chunkCount, 3);
	const frames = [];
	for await (const chunk of store.readSourceChunks('buffer-source')) frames.push(chunk.frames);
	assert.deepEqual(frames, [2, 2, 1]);
});

test('project store demand-loads one immutable chunk and records its fixed layout', async () => {
	const store = createProjectStore({ indexedDB: null, databaseName: `runtime-random-chunk-${Date.now()}` });
	const writer = await store.beginSourceWrite('stream-source', { sampleRate: 48_000, channelCount: 1 });
	await writer.write([new Float32Array(65_536).fill(0.25)]);
	await writer.write([Float32Array.of(0.5, 0.75)]);
	const metadata = await writer.commit();
	assert.equal(metadata.chunkFrames, 65_536);
	assert.equal(metadata.chunkCount, 2);
	const second = await store.readSourceChunk('stream-source', 1);
	assert.equal(second.index, 1);
	assert.equal(second.frames, 2);
	assert.deepEqual([...second.channels[0]], [0.5, 0.75]);
	assert.notEqual(second.channels[0].buffer, (await store.readSourceChunk('stream-source', 1)).channels[0].buffer);
	await assert.rejects(store.readSourceChunk('stream-source', 2), /does not exist/);
});

test('recording worklet emits bounded transferable chunks and monitor output', () => {
	const processor = new StreamingRecorderProcessor({ processorOptions: { channelCount: 1, chunkFrames: 128, monitor: true } });
	const messages = [];
	processor.port.postMessage = (message, transfer = []) => messages.push({ message, transfer });
	processor.port.onmessage({ data: { type: 'start', startFrame: 0, stopFrame: 128 } });
	const input = Float32Array.from({ length: 128 }, (_, index) => index / 128);
	const output = new Float32Array(128);
	processor.process([[input]], [[output]]);
	assert.deepEqual(output, input);
	const chunk = messages.find((entry) => entry.message.type === 'audio-chunk');
	assert.equal(chunk.message.frames, 128);
	assert.equal(chunk.message.channels[0].length, 128);
	assert.equal(chunk.transfer.length, 1);
	assert.equal(messages.at(-1).message.type, 'stopped');
});

test('recording worklet pause omits paused input and extends a bounded punch stop', () => {
	const previousFrame = globalThis.currentFrame;
	globalThis.currentFrame = 0;
	try {
		const processor = new StreamingRecorderProcessor({ processorOptions: { channelCount: 1, chunkFrames: 128 } });
		const messages = [];
		processor.port.postMessage = (message) => messages.push(message);
		processor.port.onmessage({ data: { type: 'start', startFrame: 0, stopFrame: 384 } });
		const block = new Float32Array(128).fill(0.5);
		processor.process([[block]], [[new Float32Array(128)]]);
		processor.port.onmessage({ data: { type: 'pause' } });
		globalThis.currentFrame = 128;
		processor.process([[new Float32Array(128).fill(1)]], [[new Float32Array(128)]]);
		processor.port.onmessage({ data: { type: 'resume' } });
		globalThis.currentFrame = 256;
		processor.process([[block]], [[new Float32Array(128)]]);
		globalThis.currentFrame = 384;
		processor.process([[block]], [[new Float32Array(128)]]);
		const chunks = messages.filter((message) => message.type === 'audio-chunk');
		assert.deepEqual(chunks.map((message) => message.frames), [128, 128, 128]);
		assert.ok(chunks.every((message) => message.channels[0].every((sample) => sample === 0.5)));
		assert.equal(messages.some((message) => message.type === 'paused'), true);
		assert.equal(messages.some((message) => message.type === 'resumed'), true);
		assert.equal(messages.at(-1).type, 'stopped');
	} finally {
		if (previousFrame === undefined) delete globalThis.currentFrame;
		else globalThis.currentFrame = previousFrame;
	}
});

test('dynamics worklet gates quiet input and look-ahead limits overshoot', () => {
	const previousSampleRate = globalThis.sampleRate;
	globalThis.sampleRate = 48_000;
	try {
		const gate = new DynamicsProcessor({ processorOptions: { type: 'gate', params: { threshold: -20, attack: 0, hold: 0, release: 0, rangeDb: -80 } } });
		const gated = [new Float32Array(8)];
		gate.process([[Float32Array.of(0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001)]], [gated]);
		assert.ok(Math.max(...gated[0].map(Math.abs)) < 0.00001);

		const limiter = new DynamicsProcessor({ processorOptions: { type: 'limiter', params: { ceiling: -6, lookahead: 0.001, release: 0.05 } } });
		const input = new Float32Array(128).fill(1);
		const limited = [new Float32Array(128)];
		limiter.process([[input]], [limited]);
		const ceiling = 10 ** (-6 / 20);
		assert.ok(Math.max(...limited[0].map(Math.abs)) <= ceiling + 1e-6);
		assert.ok(limited[0].slice(0, 48).every((sample) => sample === 0));
	} finally {
		if (previousSampleRate === undefined) delete globalThis.sampleRate;
		else globalThis.sampleRate = previousSampleRate;
	}
});

test('realtime render worklet emits bounded stereo chunks at the requested frame range', () => {
	const previousFrame = globalThis.currentFrame;
	globalThis.currentFrame = 0;
	try {
		const processor = new RenderCaptureProcessor({ processorOptions: { startFrame: 64, totalFrames: 160, chunkFrames: 128 } });
		const messages = [];
		processor.port.postMessage = (message, transfer = []) => messages.push({ message, transfer });
		const left = Float32Array.from({ length: 128 }, (_, index) => index / 128);
		const right = Float32Array.from({ length: 128 }, (_, index) => -index / 128);
		assert.equal(processor.process([[left, right]], [[new Float32Array(128), new Float32Array(128)]]), true);
		globalThis.currentFrame = 128;
		assert.equal(processor.process([[left, right]], [[new Float32Array(128), new Float32Array(128)]]), false);
		const chunks = messages.filter(({ message }) => message.type === 'audio-chunk');
		assert.deepEqual(chunks.map(({ message }) => message.frames), [128, 32]);
		assert.equal(chunks[0].message.channels.length, 2);
		assert.equal(chunks[0].transfer.length, 2);
		assert.equal(messages.at(-1).message.type, 'done');
		assert.equal(messages.at(-1).message.frames, 160);
	} finally {
		if (previousFrame === undefined) delete globalThis.currentFrame;
		else globalThis.currentFrame = previousFrame;
	}
});

test('recording controller serializes writes and releases microphone resources', async () => {
	const posted = [];
	const node = new MockNode();
	node.port = {
		onmessage: null,
		start() {},
		postMessage(message) { posted.push(message); },
	};
	let moduleUrl = '';
	let trackStopped = false;
	const mediaSource = new MockNode();
	const context = {
		destination: new MockNode(),
		audioWorklet: { async addModule(url) { moduleUrl = url; } },
		createMediaStreamSource() { return mediaSource; },
	};
	const stream = { getTracks: () => [{ stop() { trackStopped = true; } }] };
	const writes = [];
	const controller = await createRecordingController({
		context,
		stream,
		workletUrl: '/recorder.js',
		nodeFactory: () => node,
		onChunk: async (chunk) => writes.push([...chunk.channels[0]]),
	});
	assert.equal(moduleUrl, '/recorder.js');
	controller.start({ startFrame: 10, stopFrame: 20 });
	node.port.onmessage({ data: { type: 'audio-chunk', frameStart: 10, frames: 2, channels: [Float32Array.of(0.5, -0.5)] } });
	assert.equal(controller.pause(), true);
	assert.equal(controller.state, 'paused');
	node.port.onmessage({ data: { type: 'paused', frame: 12 } });
	assert.equal(controller.resume(), true);
	assert.equal(controller.state, 'recording');
	node.port.onmessage({ data: { type: 'resumed', frame: 14 } });
	const stopped = controller.stop();
	node.port.onmessage({ data: { type: 'stopped', frame: 20 } });
	assert.deepEqual(await stopped, { frame: 20 });
	assert.deepEqual(writes, [[0.5, -0.5]]);
	assert.deepEqual(posted.map((message) => message.type), ['start', 'pause', 'resume', 'stop']);
	await controller.dispose();
	assert.equal(trackStopped, true);
	assert.equal(mediaSource.disconnected, true);
});

test('Web Audio engine schedules canonical clips, transport, reverse, loop, and offline mix', async () => {
	const realtime = new MockAudioContext();
	const offlineContexts = [];
	const project = createProject();
	const source = new MockAudioBuffer(1, 48000, 48000);
	source.getChannelData(0).set([0.1, 0.2, 0.3]);
	const states = [];
	const engine = createAudioEditorEngine({
		audioContextFactory: () => realtime,
		offlineAudioContextFactory: (options) => {
			const context = new MockOfflineAudioContext(options);
			offlineContexts.push(context);
			return context;
		},
		onState: (state) => states.push(state),
		meterInterval: 1000,
	});
	engine.loadProject(project, new Map([['source-1', source]]));
	assert.equal(getProjectDurationFrames(project), 48000);
	await engine.play();
	assert.equal(realtime.bufferSources.length, 1);
	assert.deepEqual(realtime.bufferSources[0].started, [0, 0, 1]);
	realtime.currentTime = 0.5;
	assert.equal(engine.getPositionFrames(), 24000);
	engine.pause();
	assert.equal(engine.getState().positionFrame, 24000);
	engine.seek(12000);
	engine.setLoop({ enabled: true, startFrame: 12000, endFrame: 24000 });
	await engine.play();
	assert.equal(engine.getState().state, 'playing');
	engine.stop();

	project.clips[0].reversed = true;
	const rendered = await engine.renderMix({ startFrame: 0, endFrame: 24000, includeTail: true });
	assert.equal(rendered.numberOfChannels, 2);
	assert.ok(rendered.length > 24000);
	assert.equal(offlineContexts.length, 1);
	assert.ok(Math.abs(offlineContexts[0].bufferSources[0].buffer.getChannelData(0)[47999] - 0.1) < 1e-6);
	assert.ok(offlineContexts[0].nodeKinds.includes('biquad'));
	assert.ok(offlineContexts[0].nodeKinds.includes('compressor'));
	assert.ok(offlineContexts[0].nodeKinds.includes('delay'));
	assert.ok(states.includes('playing'));
	await engine.dispose();
	assert.equal(realtime.closed, true);
});

test('playhead scrubbing auditions independent 50 ms project-time frames', async () => {
	const context = new MockAudioContext();
	const project = createProject();
	const source = new MockAudioBuffer(1, 48_000, 48_000);
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context,
		meterInterval: 1_000,
	});
	engine.loadProject(project, new Map([['source-1', source]]));

	await engine.scrub(12_000);
	assert.equal(engine.getState().state, 'paused');
	assert.equal(engine.getState().positionFrame, 12_000);
	assert.equal(context.bufferSources.length, 1);
	assert.deepEqual(context.bufferSources[0].started, [0, 0.25, 0.05]);

	await engine.scrub(24_000);
	assert.equal(engine.getState().positionFrame, 24_000);
	assert.equal(context.bufferSources.length, 1, 'pointer updates within one frame remain intentionally sampled');
	engine.endScrub();
	assert.equal(engine.getState().positionFrame, 24_000, 'ending a scrub keeps the dragged cursor position');
	assert.equal(context.bufferSources[0].stopped, true);

	await engine.scrub(36_000);
	assert.equal(context.bufferSources.length, 2);
	assert.deepEqual(context.bufferSources[1].started, [0, 0.75, 0.05]);
	engine.endScrub();
	await engine.dispose();
});

test('ending a rapid scrub invalidates pending audio scheduling without resetting the cursor', async () => {
	const context = new MockAudioContext();
	let allowResume;
	const resumeGate = new Promise((resolve) => { allowResume = resolve; });
	context.resume = () => resumeGate;
	const project = createProject();
	const engine = createAudioEditorEngine({ audioContextFactory: () => context });
	engine.loadProject(project, new Map([['source-1', new MockAudioBuffer(1, 48_000, 48_000)]]));

	const pending = engine.scrub(12_000);
	void engine.scrub(24_000);
	engine.endScrub();
	allowResume();
	await pending;

	assert.equal(context.bufferSources.length, 0);
	assert.equal(engine.getState().state, 'paused');
	assert.equal(engine.getState().positionFrame, 24_000);
	await engine.dispose();
});

test('play at speed couples naive interpolation to project-time transport timing', async () => {
	const context = new MockAudioContext();
	const project = createProject();
	const source = new MockAudioBuffer(1, 48_000, 48_000);
	const engine = createAudioEditorEngine({ audioContextFactory: () => context, meterInterval: 1_000 });
	engine.loadProject(project, new Map([['source-1', source]]));

	await engine.playAtSpeed(2);
	assert.equal(engine.getState().playbackMode, 'naive');
	assert.equal(engine.getState().playbackRate, 2);
	assert.equal(context.bufferSources[0].playbackRate.value, 2);
	assert.deepEqual(context.bufferSources[0].started, [0, 0, 1]);
	context.currentTime = 0.25;
	assert.equal(engine.getPositionFrames(), 24_000);

	engine.seek(12_000);
	assert.equal(context.bufferSources[1].playbackRate.value, 2);
	assert.deepEqual(context.bufferSources[1].started, [0.25, 0.25, 0.75]);
	context.currentTime = 0.5;
	assert.equal(engine.getPositionFrames(), 36_000);
	engine.stop();
	await engine.dispose();
});

test('aborting play at speed while AudioContext resume is delayed never schedules audio', async () => {
	const context = new MockAudioContext();
	let allowResume;
	const resumeGate = new Promise((resolve) => { allowResume = resolve; });
	context.resume = () => resumeGate;
	const abort = new AbortController();
	const engine = createAudioEditorEngine({ audioContextFactory: () => context });
	engine.loadProject(createProject(), new Map([['source-1', new MockAudioBuffer(1, 48_000, 48_000)]]));

	const pending = engine.playAtSpeed(2, { signal: abort.signal });
	abort.abort();
	allowResume();
	await assert.rejects(pending, { name: 'AbortError' });
	assert.equal(context.bufferSources.length, 0);
	assert.equal(engine.getState().state, 'stopped');
	await engine.dispose();
});

test('StaffPad play-at-speed preflight rejects unsafe whole-project PCM before offline allocation', async () => {
	const project = createProject();
	const unsafeFrames = Math.floor(PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT_BYTES
		/ (2 * 2 * Float32Array.BYTES_PER_ELEMENT)) + 1;
	project.clips[0].durationFrames = unsafeFrames;
	const estimatedBytes = estimatePlayAtSpeedStaffPadPeakBytes(unsafeFrames, project.sampleRate, 2);
	assert.equal(PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT_BYTES, 256 * 1024 ** 2);
	assert.ok(estimatedBytes > PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT_BYTES);
	let offlineAllocations = 0;
	let pitchPreserverCalls = 0;
	const engine = createAudioEditorEngine({
		audioContextFactory: () => new MockAudioContext(),
		offlineAudioContextFactory: () => {
			offlineAllocations += 1;
			throw new Error('Unsafe OfflineAudioContext allocation must be preflighted.');
		},
	});
	engine.loadProject(project, new Map([['source-1', new MockAudioBuffer(1, 48_000, 48_000)]]));

	await assert.rejects(
		engine.playAtSpeed(2, {
			preservePitch: true,
			async pitchPreserver() {
				pitchPreserverCalls += 1;
				return [new Float32Array(1)];
			},
		}),
		(error) => error instanceof RangeError
			&& error.code === 'PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT'
			&& error.message.includes(String(PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT_BYTES)),
	);
	assert.equal(offlineAllocations, 0);
	assert.equal(pitchPreserverCalls, 0);
	assert.equal(engine.getState().playbackMode, 'normal');
	assert.equal(engine.getState().playbackRate, 1);
	await engine.dispose();
});

test('applyProject keeps active naive play-at-speed timing and stops stale StaffPad playback', async () => {
	const context = new MockAudioContext();
	const project = createProject();
	const source = new MockAudioBuffer(1, 48_000, 48_000);
	const sources = new Map([['source-1', source]]);
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context,
		offlineAudioContextFactory: (options) => new MockOfflineAudioContext(options),
		meterInterval: 1_000,
	});
	engine.loadProject(project, sources);

	await engine.playAtSpeed(1.5);
	context.currentTime = 0.2;
	await engine.applyProject({ ...project, title: 'Naive cache refresh' }, sources);
	assert.equal(engine.getState().state, 'playing');
	assert.equal(engine.getState().playbackMode, 'naive');
	assert.equal(engine.getState().playbackRate, 1.5);
	assert.equal(context.bufferSources.at(-1).playbackRate.value, 1.5);

	engine.stop();
	await engine.playAtSpeed(2, {
		preservePitch: true,
		async pitchPreserver(channels) {
			return channels.map(() => new Float32Array(24_000));
		},
	});
	await engine.applyProject({ ...project, title: 'StaffPad cache refresh' }, sources);
	assert.equal(engine.getState().state, 'stopped');
	assert.equal(engine.getState().playbackMode, 'normal');
	assert.equal(engine.getState().playbackRate, 1);
	await engine.dispose();
});

test('pitch-preserving play at speed schedules a StaffPad-tempo mix at unity source rate', async () => {
	const realtime = new MockAudioContext();
	const offlineContexts = [];
	const project = createProject();
	const source = new MockAudioBuffer(1, 48_000, 48_000);
	const calls = [];
	const engine = createAudioEditorEngine({
		audioContextFactory: () => realtime,
		offlineAudioContextFactory: (options) => {
			const context = new MockOfflineAudioContext(options);
			offlineContexts.push(context);
			return context;
		},
		meterInterval: 1_000,
	});
	engine.loadProject(project, new Map([['source-1', source]]));
	const preservePitch = async (channels, sampleRate, rate) => {
		calls.push({ channelCount: channels.length, frames: channels[0].length, sampleRate, rate });
		return channels.map(() => new Float32Array(24_000));
	};

	await engine.playAtSpeed(2, {
		preservePitch: true,
		pitchPreserver: preservePitch,
	});
	assert.deepEqual(calls, [{ channelCount: 2, frames: 48_000, sampleRate: 48_000, rate: 2 }]);
	assert.equal(offlineContexts.length, 1);
	assert.equal(engine.getState().playbackMode, 'staffpad');
	assert.equal(engine.getState().playbackRate, 2);
	assert.equal(realtime.bufferSources[0].buffer.length, 24_000);
	assert.equal(realtime.bufferSources[0].playbackRate.value, 1);
	assert.deepEqual(realtime.bufferSources[0].started, [0, 0, undefined]);
	realtime.currentTime = 0.25;
	assert.equal(engine.getPositionFrames(), 24_000);

	engine.seek(24_000);
	assert.equal(realtime.bufferSources[1].buffer, realtime.bufferSources[0].buffer);
	assert.deepEqual(realtime.bufferSources[1].started, [0.25, 0.25, undefined]);
	engine.pause();
	await engine.playAtSpeed(2, { preservePitch: true, pitchPreserver: preservePitch });
	assert.equal(calls.length, 1);
	assert.equal(offlineContexts.length, 1);
	assert.equal(realtime.bufferSources[2].buffer, realtime.bufferSources[0].buffer);
	assert.equal(realtime.bufferSources[2].playbackRate.value, 1);
	engine.pause();
	await engine.play();
	assert.equal(engine.getState().playbackMode, 'normal');
	assert.equal(realtime.bufferSources[3].buffer, source);
	assert.equal(realtime.bufferSources[3].playbackRate.value, 1);
	engine.stop();
	await engine.dispose();
});

test('live playback keeps field-free track clips at native rates against the device-rate context', async () => {
	const context = new MockAudioContext({ sampleRate: 32_000 });
	const constructorArguments = [];
	function DeviceAudioContext(...args) {
		constructorArguments.push(args);
		return context;
	}
	const mono = new MockAudioBuffer(1, 44_100, 44_100);
	const stereo = new MockAudioBuffer(2, 96_000, 96_000);
	const track = {
		type: 'audio',
		id: 'mixed-track',
		clipIds: ['mono-clip', 'stereo-clip'],
		gain: 1,
		pan: 0,
		mute: false,
		solo: false,
		effects: [],
	};
	const project = {
		id: 'mixed-native-rate-project',
		sampleRate: 48_000,
		clips: [
			{
				id: 'mono-clip', sourceId: 'mono-source', timelineStartFrame: 0,
				sourceStartFrame: 0, sourceDurationFrames: 44_100, durationFrames: 48_000,
				gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false,
			},
			{
				id: 'stereo-clip', sourceId: 'stereo-source', timelineStartFrame: 48_000,
				sourceStartFrame: 0, sourceDurationFrames: 96_000, durationFrames: 48_000,
				gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false,
			},
		],
		tracks: [track],
		master: { gain: 1, effects: [] },
	};
	const engine = createAudioEditorEngine({
		audioContextFactory: DeviceAudioContext,
		meterInterval: 1_000,
	});

	try {
		engine.loadProject(project, new Map([
			['mono-source', mono],
			['stereo-source', stereo],
		]));
		await engine.play();
		assert.deepEqual(constructorArguments, [[]], 'live playback does not request the project sample rate');
		assert.equal(Object.hasOwn(track, 'sampleRate'), false);
		assert.equal(Object.hasOwn(track, 'channelCount'), false);
		assert.deepEqual(context.bufferSources.map((source) => source.buffer.sampleRate), [44_100, 96_000]);
		assert.deepEqual(context.bufferSources.map((source) => source.buffer.numberOfChannels), [1, 2]);
		assert.deepEqual(context.bufferSources.map((source) => source.started), [
			[0, 0, 1],
			[1, 0, 1],
		]);
		assert.deepEqual(context.bufferSources.map((source) => source.playbackRate.value), [1, 1]);
	} finally {
		await engine.dispose();
	}
});

test('engine streams persisted long sources live and schedules bounded chunks through the same offline graph', async () => {
	const realtime = new MockAudioContext();
	const offlineContexts = [];
	const streamClient = new MockChunkStreamClient();
	const project = createProject();
	project.sources = [{ id: 'source-1', frameCount: 70_000, sampleRate: 48_000, channelCount: 1, chunkFrames: 65_536 }];
	project.clips[0].durationFrames = 70_000;
	project.clips[0].sourceDurationFrames = 70_000;
	const reads = [];
	const provider = {
		channelCount: 1,
		frameCount: 70_000,
		chunkFrames: 65_536,
		sampleRate: 48_000,
		async readStorageChunk(index) {
			reads.push(index);
			const frames = index === 0 ? 65_536 : 4_464;
			return [new Float32Array(frames).fill(index ? 0.75 : 0.25)];
		},
	};
	const engine = createAudioEditorEngine({
		audioContextFactory: () => realtime,
		offlineAudioContextFactory: (options) => {
			const context = new MockOfflineAudioContext(options);
			offlineContexts.push(context);
			return context;
		},
		chunkStreamClient: streamClient,
		chunkAudioNodeFactory: async (context) => context.make('chunk-stream', {
			port: { postMessage() {}, addEventListener() {}, removeEventListener() {}, start() {} },
		}),
		meterInterval: 1_000,
	});
	engine.loadProject(project, new Map(), { chunkSources: new Map([['source-1', provider]]) });
	await engine.play();
	assert.equal(realtime.bufferSources.length, 0, 'live playback never creates a full-source AudioBufferSource');
	assert.equal(streamClient.opens.length, 1);
	assert.deepEqual(
		[streamClient.opens[0].startFrame, streamClient.opens[0].endFrame],
		[0, 70_000],
	);
	assert.equal(streamClient.handles[0].plays[0].contextStartFrame, 960);
	assert.ok(realtime.nodeKinds.includes('biquad'));
	assert.ok(realtime.nodeKinds.includes('compressor'));
	assert.ok(realtime.nodeKinds.includes('delay'));
	engine.stop();
	assert.equal(streamClient.handles[0].cancelled, true);

	const progress = [];
	await engine.renderMix({
		startFrame: 0,
		endFrame: 70_000,
		onProgress: (value) => progress.push(value.progress),
	});
	assert.deepEqual(reads, [0, 1]);
	assert.equal(offlineContexts.length, 1);
	assert.deepEqual(offlineContexts[0].bufferSources.map((source) => source.buffer.length), [65_536, 4_464]);
	assert.equal(offlineContexts[0].bufferSources.some((source) => source.buffer.length === 70_000), false);
	assert.ok(offlineContexts[0].nodeKinds.includes('biquad'));
	assert.ok(offlineContexts[0].nodeKinds.includes('compressor'));
	assert.ok(offlineContexts[0].nodeKinds.includes('delay'));
	assert.equal(progress.at(-1), 1);
	await engine.dispose();
});

test('engine requests worker-side windowed-sinc conversion for arbitrary long-source rates', async () => {
	const context = new MockAudioContext({ sampleRate: 48_000 });
	const streamClient = new MockChunkStreamClient();
	const project = createProject();
	project.sources = [{ id: 'source-1', frameCount: 44_100, sampleRate: 44_100, channelCount: 1, chunkFrames: 65_536 }];
	project.clips[0].durationFrames = 48_000;
	project.clips[0].sourceDurationFrames = 44_100;
	const provider = {
		channelCount: 1,
		frameCount: 44_100,
		chunkFrames: 65_536,
		sampleRate: 44_100,
		async readStorageChunk() { return [new Float32Array(44_100)]; },
	};
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context,
		chunkStreamClient: streamClient,
		chunkAudioNodeFactory: async (audioContext) => audioContext.make('chunk-stream', {
			port: { postMessage() {}, addEventListener() {}, removeEventListener() {}, start() {} },
		}),
		meterInterval: 1_000,
	});
	engine.loadProject(project, new Map(), { chunkSources: new Map([['source-1', provider]]) });
	engine.seek(1);
	await engine.play();
	assert.equal(streamClient.opens.length, 1);
	assert.deepEqual({
		sourceStartFrame: streamClient.opens[0].sourceStartFrame,
		sourceEndFrame: streamClient.opens[0].sourceEndFrame,
		outputFrameCount: streamClient.opens[0].outputFrameCount,
	}, { sourceStartFrame: 0, sourceEndFrame: 44_100, outputFrameCount: 47_999 });
	assert.ok(Math.abs(streamClient.opens[0].resampleInputFrames - 44_099.08125) < 1e-6);
	assert.ok(Math.abs(streamClient.opens[0].resampleInputOffset - 0.91875) < 1e-6);
	assert.equal(context.bufferSources.length, 0);
	engine.stop();
	await engine.playAtSpeed(2);
	assert.equal(streamClient.opens.length, 2);
	assert.equal(streamClient.opens[1].outputFrameCount, 24_000);
	assert.ok(Math.abs(streamClient.opens[1].resampleInputFrames - 44_100) < 1e-6);
	engine.stop();
	await engine.dispose();
});

test('engine source resolver can schedule a committed nondestructive clip cache without changing callers', async () => {
	const context = new MockAudioContext();
	const project = createProject();
	project.clips[0].reversed = true;
	const original = new MockAudioBuffer(1, 48_000, 48_000);
	const committed = new MockAudioBuffer(1, 24_000, 48_000);
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context,
		sourceResolver: (clip, { defaultBuffer }) => {
			assert.equal(clip.id, 'clip-1');
			assert.equal(defaultBuffer, original);
			return {
				buffer: committed,
				sourceStartFrame: 0,
				sourceDurationFrames: committed.length,
				reversed: false,
			};
		},
		meterInterval: 1_000,
	});
	engine.loadProject(project, new Map([['source-1', original]]));
	await engine.play();
	assert.equal(context.bufferSources.length, 1);
	assert.equal(context.bufferSources[0].buffer, committed);
	assert.deepEqual(context.bufferSources[0].started, [0, 0, 0.5]);
	assert.equal(engine.setSourceResolver(null), engine);
	engine.stop();
	await engine.dispose();
});

test('engine schedules clip volume automation for live playback', async () => {
	const context = new MockAudioContext();
	const project = createProject();
	project.clips[0].fadeInFrames = 0;
	project.clips[0].fadeOutFrames = 0;
	project.clips[0].envelope = [{ frame: 12_000, value: 0.5 }, { frame: 36_000, value: 0.25 }];
	const engine = createAudioEditorEngine({ audioContextFactory: () => context, meterInterval: 1_000 });
	engine.loadProject(project, new Map([['source-1', new MockAudioBuffer(1, 48_000, 48_000)]]));
	await engine.play();
	const fadeIn = context.bufferSources[0].connections[0];
	const fadeOut = fadeIn.connections[0];
	const clipGain = fadeOut.connections[0];
	assert.deepEqual(clipGain.gain.events, [
		['set', 0.8, 0],
		['ramp', 0.4, 0.25],
		['ramp', 0.2, 0.75],
		['ramp', 0.2, 1],
	]);
	engine.stop();
	await engine.dispose();
});

test('engine schedules track automation in project time and composes it with static track gain', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const context = new MockAudioContext({ sampleRate: 8 });
	const project = createTrackEnvelopeProject({
		effects: [{ type: 'limiter', params: { lookahead: 0.25 } }],
	});
	const source = new MockAudioBuffer(1, 8, 8);
	source.getChannelData(0).fill(1);
	const engine = createAudioEditorEngine({ audioContextFactory: () => context, meterInterval: 1_000 });
	try {
		engine.loadProject(project, new Map([['envelope-source', source]]));
		engine.seek(2);
		await engine.play();

		const fadeIn = context.bufferSources[0].connections[0];
		const fadeOut = fadeIn.connections[0];
		const clipGain = fadeOut.connections[0];
		const trackInput = clipGain.connections[0];
		const limiter = trackInput.connections[0];
		const trackGain = limiter.connections[0];
		assert.equal(limiter.kind, 'audio-worklet');
		assert.deepEqual(trackGain.gain.events, [
			['set', 0.5, 0],
			['set', 0.25, 0.25],
			['ramp', 0, 0.5],
			['ramp', 0.5, 1],
		]);
		engine.stop();
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('offline engine render bakes track automation into PCM across a cropped timeline range', async () => {
	const project = createTrackEnvelopeProject();
	const source = new MockAudioBuffer(1, 8, 8);
	source.getChannelData(0).fill(1);
	const engine = createAudioEditorEngine({
		offlineAudioContextFactory: (options) => new MockGainRenderingOfflineAudioContext(options),
	});
	engine.loadProject(project, new Map([['envelope-source', source]]));
	const rendered = await engine.renderMix({
		startFrame: 2,
		endFrame: 6,
		includeMaster: false,
		includeTrackPan: false,
		respectMuteSolo: false,
	});
	assert.deepEqual(Array.from(rendered.getChannelData(0)), [0.25, 0.125, 0, 0.125]);
	assert.deepEqual(rendered.getChannelData(1), rendered.getChannelData(0));
	await engine.dispose();
});

test('project graph meters pre-mute tracks and applies master processing', () => {
	const context = new MockAudioContext();
	const graph = buildProjectGraph(context, context.destination, createProject(), { metering: true });
	assert.equal(graph.trackInputs.size, 1);
	assert.equal(graph.trackAnalysers.size, 1);
	assert.ok(graph.masterAnalyser);
	assert.ok(context.nodeKinds.includes('stereo-panner'));
	assert.ok(context.nodeKinds.includes('convolver'));

	const dryContext = new MockAudioContext();
	const dryGraph = buildProjectGraph(dryContext, dryContext.destination, createProject(), {
		metering: false,
		includeTrackPan: false,
	});
	assert.equal(dryContext.nodeKinds.includes('stereo-panner'), false);
	assert.equal(dryGraph.trackInputs.size, 1);
});

test('project graph builds metered group and send bus paths', () => {
	const context = new MockAudioContext();
	const project = createProject();
	project.mixer = {
		groups: [{ id: 'group-1', name: 'Group 1', gain: 0.8, pan: 0, mute: false, solo: false, effects: [] }],
		sends: [{ id: 'send-1', name: 'Send 1', gain: 0.5, pan: 0.25, mute: false, solo: false, effects: [] }],
		routes: { 'track-1': { groupId: 'group-1', sends: { 'send-1': 0.3 } } },
	};
	const graph = buildProjectGraph(context, context.destination, project, { metering: true });
	assert.deepEqual([...graph.groupAnalysers.keys()], ['group-1']);
	assert.deepEqual([...graph.sendAnalysers.keys()], ['send-1']);
	assert.equal(graph.trackAnalysers.size, 1);
	assert.ok(context.nodeKinds.filter((kind) => kind === 'analyser').length >= 4);
	assert.ok(context.nodeKinds.includes('stereo-panner'));
});

test('engine loads and inserts Audacity worklets in track and master racks without bypassing them', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const realtime = new MockAudioContext();
	const offlineContexts = [];
	const project = createRackProject({
		tracks: [{
			id: 'track-1',
			effects: [{ type: 'audacity-invert', enabled: true, params: {} }],
		}],
		masterEffects: [{
			type: 'audacity-bass-treble',
			enabled: true,
			params: { bassDb: 3, trebleDb: -2, volumeDb: 0 },
		}],
	});
	const source = new MockAudioBuffer(2, 4_800, 48_000);
	const engine = createAudioEditorEngine({
		audioContextFactory: () => realtime,
		offlineAudioContextFactory: (options) => {
			const context = new MockOfflineAudioContext(options);
			offlineContexts.push(context);
			return context;
		},
		meterInterval: 1_000,
	});

	try {
		engine.loadProject(project, new Map([['source-1', source]]));
		await engine.play();
		assert.equal(realtime.audioWorkletModules.filter((url) => url.endsWith('/audacity-effects/live-worklet.js')).length, 1);
		const worklets = realtime.workletNodes.filter((node) => node.name === 'kw-audacity-live-effect');
		assert.deepEqual(worklets.map((node) => node.options.processorOptions.effectType), [
			'audacity-invert',
			'audacity-bass-treble',
		]);
		for (const worklet of worklets) {
			assert.ok(incomingConnections(engine.graph.nodes, worklet, 0).length > 0, `${worklet.options.processorOptions.effectType} input`);
			assert.ok(worklet.connectionDetails.length > 0, `${worklet.options.processorOptions.effectType} output`);
		}

		engine.stop();
		await engine.renderMix({ startFrame: 0, endFrame: 2_400 });
		assert.equal(offlineContexts.length, 1);
		assert.equal(offlineContexts[0].audioWorkletModules.filter((url) => url.endsWith('/audacity-effects/live-worklet.js')).length, 1);
		assert.deepEqual(
			offlineContexts[0].workletNodes.map((node) => node.options.processorOptions.effectType),
			['audacity-invert', 'audacity-bass-treble'],
		);
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('Auto Duck receives its selected control track from the dry second input', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const context = new MockAudioContext();
	const project = createRackProject({
		tracks: [
			{
				id: 'target',
				effects: [{
					type: 'audacity-auto-duck',
					enabled: true,
					params: {},
					context: { controlTrackId: 'control' },
				}],
			},
			{
				id: 'control',
				effects: [{ type: 'audacity-invert', enabled: true, params: {} }],
			},
		],
	});
	const source = new MockAudioBuffer(1, 4_800, 48_000);
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context,
		meterInterval: 1_000,
	});

	try {
		engine.loadProject(project, new Map([['source-1', source]]));
		await engine.play();
		const autoDuck = context.workletNodes.find((node) => (
			node.options.processorOptions.effectType === 'audacity-auto-duck'
		));
		assert.ok(autoDuck);
		assert.equal(autoDuck.options.numberOfInputs, 2);
		const dryControl = engine.graph.trackInputs.get('control');
		assert.ok(dryControl.connectionDetails.some(({ node, output, input }) => (
			node === autoDuck && output === 0 && input === 1
		)));
		const processedControl = context.workletNodes.find((node) => (
			node.options.processorOptions.effectType === 'audacity-invert'
		));
		assert.equal(processedControl.connectionDetails.some(({ node }) => node === autoDuck), false);
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('project graph reports rack latency and delays lower-latency tracks to match', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const context = new MockAudioContext({ sampleRate: 96_000 });
	const project = createRackProject({
		tracks: [
			{
				id: 'limited',
				effects: [{
					type: 'audacity-limiter',
					enabled: true,
					params: { lookaheadMs: 10 },
				}],
			},
			{ id: 'dry', effects: [] },
		],
		masterEffects: [{
			type: 'audacity-compressor',
			enabled: true,
			params: { lookaheadMs: 5 },
		}],
	});
	const source = new MockAudioBuffer(1, 4_800, 48_000);
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context,
		meterInterval: 1_000,
	});

	try {
		engine.loadProject(project, new Map([['source-1', source]]));
		await engine.play();
		assert.equal(projectGraphLatencyFrames(project), 720);
		assert.equal(engine.graph.latencyFrames, 1_440);
		assert.equal(engine.playbackStartTime, 1_440 / 96_000);
		const compensation = context.createdDelays.find((delay) => Math.abs(delay.delayTime.value - 0.01) < 1e-12);
		assert.ok(compensation, 'the dry track receives the limiter lookahead as compensation');
		assert.ok(incomingConnections(engine.graph.nodes, compensation, 0).length > 0);
		assert.ok(compensation.connectionDetails.length > 0);
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('offline rendering crops live latency while retaining the requested effect tail', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const offlineContexts = [];
	const project = createRackProject({
		tracks: [{
			id: 'limited',
			effects: [{
				type: 'audacity-limiter',
				enabled: true,
				params: { lookaheadMs: 10 },
			}],
		}],
		masterEffects: [{
			type: 'audacity-echo',
			enabled: true,
			params: { delaySeconds: 0.1, decay: 0.5 },
		}],
	});
	const source = new MockAudioBuffer(1, 4_800, 48_000);
	const engine = createAudioEditorEngine({
		offlineAudioContextFactory: (options) => {
			const context = new MockRampOfflineAudioContext(options);
			offlineContexts.push(context);
			return context;
		},
	});

	try {
		engine.loadProject(project, new Map([['source-1', source]]));
		const rendered = await engine.renderMix({ startFrame: 0, endFrame: 2_400, includeTail: true });
		const expectedTailFrames = 48_000;
		const expectedLatencyFrames = 480;
		assert.equal(offlineContexts.length, 1);
		assert.equal(offlineContexts[0].length, 2_400 + expectedTailFrames + expectedLatencyFrames);
		assert.equal(rendered.length, 2_400 + expectedTailFrames);
		assert.equal(rendered.getChannelData(0)[0], expectedLatencyFrames);
		assert.equal(rendered.getChannelData(0).at(-1), offlineContexts[0].length - 1);
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('Audacity worklet load failures reject playback instead of bypassing the rack', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const context = new MockAudioContext();
	context.audioWorklet.addModule = async () => { throw new Error('mock Audacity module load failed'); };
	const project = createRackProject({
		tracks: [{ id: 'track-1', effects: [{ type: 'audacity-invert', enabled: true, params: {} }] }],
	});
	const source = new MockAudioBuffer(1, 4_800, 48_000);
	const engine = createAudioEditorEngine({ audioContextFactory: () => context });

	try {
		engine.loadProject(project, new Map([['source-1', source]]));
		await assert.rejects(() => engine.play(), /mock Audacity module load failed/);
		assert.equal(engine.graph, null);
		assert.equal(context.workletNodes.length, 0);
		assert.equal(context.bufferSources.length, 0);
		assert.equal(engine.getState().state, 'stopped');
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

test('rebuilding a playing rack disconnects its old worklet graph and reuses the loaded module', async () => {
	const previousWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = MockAudioWorkletNode;
	const context = new MockAudioContext();
	const project = createRackProject({
		tracks: [{ id: 'track-1', effects: [{ type: 'audacity-invert', enabled: true, params: {} }] }],
	});
	const source = new MockAudioBuffer(1, 4_800, 48_000);
	const sources = new Map([['source-1', source]]);
	const engine = createAudioEditorEngine({ audioContextFactory: () => context, meterInterval: 1_000 });

	try {
		engine.loadProject(project, sources);
		await engine.play();
		const oldWorklet = context.workletNodes[0];
		const updated = structuredClone(project);
		updated.master.effects.push({
			type: 'audacity-bass-treble',
			enabled: true,
			params: { bassDb: 2, trebleDb: 0, volumeDb: 0 },
		});
		await engine.applyProject(updated, sources);

		assert.equal(oldWorklet.disconnected, true);
		assert.equal(context.audioWorkletModules.filter((url) => url.endsWith('/audacity-effects/live-worklet.js')).length, 1);
		assert.deepEqual(
			context.workletNodes.slice(1).map((node) => node.options.processorOptions.effectType),
			['audacity-invert', 'audacity-bass-treble'],
		);
		assert.equal(engine.getState().state, 'playing');
	} finally {
		await engine.dispose();
		if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
		else globalThis.AudioWorkletNode = previousWorkletNode;
	}
});

function createProject() {
	return {
		id: 'project-1',
		sampleRate: 48000,
		clips: [{
			id: 'clip-1',
			sourceId: 'source-1',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			durationFrames: 48000,
			gain: 0.8,
			fadeInFrames: 100,
			fadeOutFrames: 100,
			reversed: false,
		}],
		tracks: [{
			id: 'track-1',
			clipIds: ['clip-1'],
			gain: 1,
			pan: -0.25,
			mute: false,
			solo: false,
			effects: [
				{ type: 'highpass', params: { frequency: 80 } },
				{ type: 'compressor', params: { threshold: -20 } },
				{ type: 'delay', params: { time: 0.1, feedback: 0.2, mix: 0.1 } },
			],
		}],
		master: {
			gain: 0.9,
			effects: [{ type: 'reverb', params: { duration: 0.5, mix: 0.1 } }],
		},
	};
}

function createTrackEnvelopeProject({ effects = [] } = {}) {
	return {
		id: 'track-envelope-project',
		sampleRate: 8,
		sources: [{
			id: 'envelope-source', frameCount: 8, channelCount: 1, sampleRate: 8,
		}],
		clips: [{
			id: 'envelope-clip', sourceId: 'envelope-source', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 8, durationFrames: 8,
			gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false, envelope: [],
		}],
		tracks: [{
			type: 'audio', id: 'envelope-track', name: 'Envelope', clipIds: ['envelope-clip'],
			gain: 0.5, pan: 0, mute: false, solo: false,
			envelope: [{ frame: 0, value: 1 }, { frame: 4, value: 0 }, { frame: 8, value: 1 }],
			effects,
		}],
		mixer: { groups: [], sends: [], routes: {} },
		master: { gain: 1, pan: 0, mute: false, effects: [] },
	};
}

function createRackProject({ tracks, masterEffects = [] }) {
	const clips = tracks.map((track, index) => ({
		id: `clip-${index + 1}`,
		sourceId: 'source-1',
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		durationFrames: 4_800,
		gain: 1,
		fadeInFrames: 0,
		fadeOutFrames: 0,
		reversed: false,
	}));
	return {
		id: 'rack-project',
		sampleRate: 48_000,
		clips,
		tracks: tracks.map((track, index) => ({
			id: track.id,
			clipIds: [clips[index].id],
			gain: 1,
			pan: 0,
			mute: false,
			solo: false,
			effects: track.effects,
		})),
		master: { gain: 1, effects: masterEffects },
	};
}

function incomingConnections(nodes, target, input) {
	return nodes.flatMap((node) => node.connectionDetails || []).filter((connection) => (
		connection.node === target && connection.input === input
	));
}

class MockParam {
	constructor(value = 0) { this.value = value; this.events = []; }
	setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
	linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['ramp', value, time]); }
}

class MockNode {
	constructor(kind = 'node') {
		this.kind = kind;
		this.connections = [];
		this.connectionDetails = [];
		this.disconnected = false;
	}
	connect(node, output = 0, input = 0) {
		this.connections.push(node);
		this.connectionDetails.push({ node, output, input });
		return node;
	}
	disconnect() {
		this.disconnected = true;
		this.connections = [];
		this.connectionDetails = [];
	}
}

class MockAudioWorkletNode extends MockNode {
	constructor(context, name, options = {}) {
		super('audio-worklet');
		this.context = context;
		this.name = name;
		this.options = options;
		this.port = { onmessage: null, postMessage() {}, start() {} };
		context.workletNodes.push(this);
		context.nodeKinds.push(`audio-worklet:${name}`);
	}
}

class MockChunkStreamClient {
	constructor() {
		this.opens = [];
		this.handles = [];
		this.disposed = false;
	}
	open(options) {
		this.opens.push(options);
		let resolveDone;
		const handle = {
			ready: Promise.resolve({ channelCount: options.source.channelCount }),
			primed: Promise.resolve({ packets: 4, frames: 4_096 }),
			done: new Promise((resolve) => { resolveDone = resolve; }),
			plays: [],
			cancelled: false,
			async play(value) { this.plays.push(value); },
			cancel() {
				this.cancelled = true;
				resolveDone({ cancelled: true });
			},
		};
		this.handles.push(handle);
		return handle;
	}
	dispose() { this.disposed = true; }
}

class MockAudioBuffer {
	constructor(numberOfChannels, length, sampleRate) {
		this.numberOfChannels = numberOfChannels;
		this.length = length;
		this.sampleRate = sampleRate;
		this.duration = length / sampleRate;
		this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
	}
	getChannelData(index) { return this.channels[index]; }
}

class MockAudioContext {
	constructor(options = {}) {
		this.sampleRate = options.sampleRate || 48000;
		this.currentTime = 0;
		this.destination = new MockNode('destination');
		this.bufferSources = [];
		this.nodeKinds = [];
		this.workletNodes = [];
		this.audioWorkletModules = [];
		this.createdDelays = [];
		this.audioWorklet = {
			addModule: async (url) => { this.audioWorkletModules.push(String(url)); },
		};
		this.state = 'running';
	}
	make(kind, properties = {}) {
		const node = Object.assign(new MockNode(kind), properties);
		this.nodeKinds.push(kind);
		return node;
	}
	createGain() { return this.make('gain', { gain: new MockParam(1) }); }
	createStereoPanner() { return this.make('stereo-panner', { pan: new MockParam(0) }); }
	createBiquadFilter() { return this.make('biquad', { frequency: new MockParam(), Q: new MockParam(), gain: new MockParam() }); }
	createDynamicsCompressor() {
		return this.make('compressor', {
			threshold: new MockParam(), knee: new MockParam(), ratio: new MockParam(), attack: new MockParam(), release: new MockParam(),
		});
	}
	createDelay(maximumDelayTime) {
		const delay = this.make('delay', { delayTime: new MockParam(), maximumDelayTime });
		this.createdDelays.push(delay);
		return delay;
	}
	createConvolver() { return this.make('convolver', { buffer: null }); }
	createWaveShaper() { return this.make('waveshaper', { curve: null }); }
	createAnalyser() {
		return this.make('analyser', {
			fftSize: 256,
			getFloatTimeDomainData(values) { values.fill(0.25); },
		});
	}
	createBufferSource() {
		const node = this.make('buffer-source', {
			buffer: null,
			playbackRate: new MockParam(1),
			start: (when, offset, duration) => { node.started = [when, offset, duration]; },
			stop: () => { node.stopped = true; },
		});
		this.bufferSources.push(node);
		return node;
	}
	createBuffer(channels, length, sampleRate) { return new MockAudioBuffer(channels, length, sampleRate); }
	async resume() { this.state = 'running'; }
	async close() { this.state = 'closed'; this.closed = true; }
}

class MockOfflineAudioContext extends MockAudioContext {
	constructor(options) {
		super({ sampleRate: options.sampleRate });
		this.length = options.length;
		this.numberOfChannels = options.numberOfChannels;
	}
	async startRendering() { return new MockAudioBuffer(this.numberOfChannels, this.length, this.sampleRate); }
}

class MockGainRenderingOfflineAudioContext extends MockOfflineAudioContext {
	async startRendering() {
		const rendered = new MockAudioBuffer(this.numberOfChannels, this.length, this.sampleRate);
		for (const source of this.bufferSources) {
			if (!source.started || !source.buffer) continue;
			const [when, offset, duration] = source.started;
			for (let frame = 0; frame < rendered.length; frame += 1) {
				const time = frame / this.sampleRate;
				if (time < when || time >= when + duration) continue;
				const playbackRate = mockParamValueAtTime(source.playbackRate, time);
				const sourceFrame = Math.floor((offset + (time - when) * playbackRate) * source.buffer.sampleRate);
				for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
					const sourceChannel = Math.min(channel, source.buffer.numberOfChannels - 1);
					const value = source.buffer.getChannelData(sourceChannel)[sourceFrame] || 0;
					propagateMockSample(source, value, time, rendered.getChannelData(channel), frame);
				}
			}
		}
		return rendered;
	}
}

function propagateMockSample(node, value, time, output, frame) {
	for (const connection of node.connections) {
		if (connection.kind === 'destination') {
			output[frame] += value;
			continue;
		}
		const nextValue = connection.kind === 'gain'
			? value * mockParamValueAtTime(connection.gain, time)
			: value;
		propagateMockSample(connection, nextValue, time, output, frame);
	}
}

function mockParamValueAtTime(param, time) {
	let previous = null;
	for (const event of param?.events || []) {
		const [type, value, eventTime] = event;
		if (eventTime > time) {
			if (type === 'ramp' && previous && eventTime > previous.time) {
				const progress = (time - previous.time) / (eventTime - previous.time);
				return previous.value + (value - previous.value) * progress;
			}
			return previous?.value ?? param.value;
		}
		previous = { value, time: eventTime };
	}
	return previous?.value ?? param?.value ?? 0;
}

class MockRampOfflineAudioContext extends MockOfflineAudioContext {
	async startRendering() {
		const buffer = new MockAudioBuffer(this.numberOfChannels, this.length, this.sampleRate);
		for (const channel of buffer.channels) {
			for (let frame = 0; frame < channel.length; frame += 1) channel[frame] = frame;
		}
		return buffer;
	}
}

function textAt(bytes, offset, length) {
	return String.fromCharCode(...bytes.slice(offset, offset + length));
}
