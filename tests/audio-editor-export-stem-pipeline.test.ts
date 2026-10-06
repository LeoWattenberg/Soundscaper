/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorExportService } from '../src/common/editor/controller/export/internal/export-service.ts';
import { createExportSnapshotRenderer } from '../src/common/editor/controller/export/export-snapshot-renderer.ts';
import { createEditorTaskProgressCoordinator } from '../src/common/editor/controller/shared/task-progress.ts';
import { inspectZip32Layout } from '../src/common/editor/controller/export/internal/archive/zip32.ts';
import { admitDirectStemPipeline } from '../src/common/editor/controller/export/internal/direct/direct-stem-pipeline-admission.ts';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import { createFixture, defaultPlan } from './helpers/export-service-fixture.ts';
import { encodeWav, createWavStreamEncoder } from '../src/common/editor/wav.js';
import { createStreamingWindowedSincResampler } from '../src/common/editor/resample.js';

function deferred() { let resolve = (): void => {}; const promise = new Promise<void>((accept) => { resolve = accept; }); return { promise, resolve }; }
const tick = () => new Promise<void>((resolve) => { setImmediate(resolve); });

test('Speed renders the following stem during archive backpressure with identical deterministic ZIP bytes and monotonic raw progress', async () => {
	const speed = pipelineFixture('speed'); const memory = pipelineFixture('memory');
	const accelerated = await runBlocked(speed); const sequential = await runBlocked(memory);
	assert.deepEqual(accelerated.beforeAck, ['render:one', 'render:two']); assert.deepEqual(sequential.beforeAck, ['render:one']);
	assert.deepEqual(accelerated.bytes, sequential.bytes); assert.equal(accelerated.bytes.byteLength, speed.plan.archive!.expectedByteLength);
	assert.deepEqual(speed.preflightBytes, [speed.entryBytes, admitDirectStemPipeline(speed.plan, { sampleRate: 48000, masterChannels: 2 }, 'speed')!.temporaryBytes]);
	assert.deepEqual(memory.preflightBytes, [memory.entryBytes]); assert.deepEqual(speed.errors, []);
	assert.ok(speed.progress.every((value, index, values) => index === 0 || value >= values[index - 1]!));
});

test('default supplied renderer exposes the private capability while custom supplied renderer retains sequential semantics', async () => {
	const defaultFactory = pipelineFixture('speed');
	Object.assign(defaultFactory.runtime, { exportSnapshotRenderer: createExportSnapshotRenderer({ options: defaultFactory.renderOptions, sourceBuffers: defaultFactory.runtime.sourceBuffers,
		taskProgress: defaultFactory.runtime.taskProgress, createCacheAwareRenderEngine: defaultFactory.runtime.createCacheAwareRenderEngine,
		prepareCommittedTimePitchCaches: defaultFactory.runtime.prepareCommittedTimePitchCaches, throwIfAborted: defaultFactory.runtime.throwIfAborted,
		updateExportProgress: defaultFactory.runtime.updateExportProgress }) });
	assert.deepEqual((await runBlocked(defaultFactory)).beforeAck, ['render:one', 'render:two']);
	const custom = pipelineFixture('speed'); let calls = 0; const original = custom.renderOptions.renderSnapshot!;
	Object.assign(custom.runtime, { exportSnapshotRenderer: { withRenderProgress: (value: unknown) => value,
		async renderSnapshot(...args: unknown[]) { calls++; return original(...args); } } });
	assert.deepEqual((await runBlocked(custom)).beforeAck, ['render:one']); assert.equal(calls, 2);
});

test('absent preference, owned progress, retry factory and aggregate capacity retain the sequential producer', async () => {
	for (const missing of ['preference', 'owned-progress', 'retry-sink', 'retry-resampler', 'aggregate-capacity'] as const) {
		const fixture = pipelineFixture('speed');
		if (missing === 'preference') Reflect.deleteProperty(fixture.runtime, 'getPerformanceOptimizationMode');
		if (missing === 'owned-progress') Object.assign(fixture.runtime, { taskProgress: { begin: () => ({ setPhase: () => true, finish: () => true }), getSnapshot: () => ({ kind: 'export' }) } });
		if (missing === 'retry-sink') Reflect.deleteProperty(fixture.runtime, 'createTemporaryFileSink');
		if (missing === 'retry-resampler') Reflect.deleteProperty(fixture.runtime, 'createStreamingWindowedSincResampler');
		if (missing === 'aggregate-capacity') Object.assign(fixture.runtime, { preflightStorage: async (bytes: number) => { fixture.preflightBytes.push(bytes); if (bytes > fixture.entryBytes) throw new Error('capacity'); } });
		assert.deepEqual((await runBlocked(fixture)).beforeAck, ['render:one'], missing); assert.deepEqual(fixture.errors, [], missing);
	}
});

test('mutating render inputs during aggregate preflight fences every renderer and aborts the prepared destination', async () => {
	const fixture = pipelineFixture('speed');
	Object.assign(fixture.runtime, { preflightStorage: async (bytes: number) => { fixture.preflightBytes.push(bytes); if (bytes > fixture.entryBytes) fixture.plan.range.durationFrames *= 100; } });
	assert.equal(await createEditorExportService(fixture.runtime).handleExportAction('export'), undefined);
	assert.deepEqual(fixture.renders, []); assert.match((fixture.errors[0] as Error).message, /admitted stem rendering inputs changed/u); assert.equal(fixture.aborts(), 1);
});

test('admitted owned offline failures retry through real bounded WAV encoding and clean both private staging files', async () => {
	const fixture = pipelineFixture('speed'); const reference = pipelineFixture('memory'); let removed = 0; let disposed = 0;
	const channels = [Float32Array.of(.1, .2, .3, .2, .1, 0), Float32Array.of(.2, .1, 0, .1, .2, .3)];
	fixture.renderOptions.renderSnapshot = async (snapshot) => { fixture.renders.push(`render:${(snapshot as { activeStem: string }).activeStem}`); throw new Error('offline unavailable'); };
	Object.assign(fixture.runtime, { createWavStreamEncoder, createStreamingWindowedSincResampler,
		createCacheAwareRenderEngine() {
			let track = '';
			return { loadProject(snapshot: { activeStem: string }) { track = snapshot.activeStem; },
				async renderMixRealtime(range: { onChunk(channels: Float32Array[], metadata: { sampleRate: number }): Promise<void>; onProgress?(value: number): void }) {
					fixture.renders.push(`retry:${track}`); range.onProgress?.(.5); await range.onChunk(channels, { sampleRate: 48000 });
				}, async dispose() { disposed++; } };
		},
		async createTemporaryFileSink() {
			const chunks: Uint8Array<ArrayBuffer>[] = [];
			return { persistent: true, async write(chunk: Uint8Array) { chunks.push(new Uint8Array(chunk)); },
				async close(mimeType: string) { return new Blob(chunks, { type: mimeType }); }, async remove() { removed++; }, async abort() { throw new Error('successful retry must remove staging'); } };
		},
	});
	const retried = await runBlocked(fixture); const sequential = await runBlocked(reference);
	assert.deepEqual(retried.beforeAck, ['render:one', 'retry:one', 'render:two', 'retry:two']);
	assert.deepEqual(retried.bytes, sequential.bytes); assert.equal(removed, 2); assert.equal(disposed, 2);
});

test('one-next orchestration and entry-owned resource helpers belong to the deferred export owner', () => {
	for (const name of ['archive/direct-stem-entry-stream', 'archive/one-next-stem-pipeline', 'archive/owned-stem-progress', 'archive/owned-stem-renderer',
		'direct/direct-stem-pipeline-admission', 'direct/direct-stem-render-execution']) {
		assert.equal(chunkGroupForModulePath(`src/common/editor/controller/export/internal/${name}.ts`), 'editor-optional-export', name);
	}
});

function pipelineFixture(preference: 'speed' | 'memory') {
	const fixture = createFixture(); const plan = defaultPlan(); const blocked = deferred(); const entered = deferred();
	const renders: string[] = []; const chunks: Uint8Array[] = []; let written = 0; let declared = 0; let aborts = 0;
	const entryBytes = encodeWav([new Float32Array(6), new Float32Array(6)], { sampleRate: 48000, bitDepth: 24, metadata: { title: 'Mix' } }).byteLength;
	plan.mode = 'stems'; plan.outputBytesPerRender = 48; plan.outputFileBytesPerRender = entryBytes;
	plan.outputs = [{ fileName: 'one.wav', trackId: 'one' }, { fileName: 'two.wav', trackId: 'two' }];
	const entries = plan.outputs.map((output) => ({ fileName: output.fileName, expectedByteLength: entryBytes }));
	const zip32 = inspectZip32Layout(entries.map((entry) => ({ fileName: entry.fileName, byteLength: entry.expectedByteLength })));
	plan.archive = { format: 'zip', fileName: 'stems.zip', mimeType: 'application/zip', entries, expectedByteLength: zip32.archiveByteLength };
	Object.assign(plan.archive, { zip32 });
	Object.assign(plan.render, { fast: true, livePcmBytes: 48, offlineRenderAdmission: { admitted: true, peakUsefulBinaryBytes: 128 }, thresholds: { outputBytes: 1024, totalBytes: 1024 ** 3 } });
	fixture.setPlan(plan); Object.assign(fixture.runtime, { getPerformanceOptimizationMode: () => preference, taskProgress: createEditorTaskProgressCoordinator(),
		stemProject: (snapshot: unknown, trackId: string) => ({ ...structuredClone(snapshot as Record<string, unknown>), activeStem: trackId }) });
	const render = fixture.renderOptions.renderSnapshot!;
	fixture.renderOptions.renderSnapshot = async (...args: unknown[]) => { renders.push(`render:${(args[0] as { activeStem: string }).activeStem}`); return render(...args); };
	fixture.runtime.fileService.prepareSave = () => ({ mode: 'stream', async createWritable(length: number) { declared = length; return new WritableStream<Uint8Array>({
		async write(chunk) { if (written === 0) { entered.resolve(); await blocked.promise; } chunks.push(chunk.slice()); written += chunk.byteLength; },
	}); }, bytesWritten: () => written, commit: () => ({ fileName: 'stems.zip', size: declared, method: 'memory' }), async abort() { aborts++; } });
	return { ...fixture, plan, entryBytes, blocked, entered, renders, chunks, aborts: () => aborts };
}

async function runBlocked(fixture: ReturnType<typeof pipelineFixture>) {
	const running = createEditorExportService(fixture.runtime).handleExportAction('export');
	await Promise.race([fixture.entered.promise, running.then(() => { throw new Error(`Export ended before archive write: ${String(fixture.errors[0])}`); })]);
	await tick(); await tick(); const beforeAck = [...fixture.renders]; fixture.blocked.resolve(); await running;
	assert.deepEqual(fixture.errors, []); const bytes = new Uint8Array(fixture.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
	let offset = 0; for (const chunk of fixture.chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return { beforeAck, bytes };
}
