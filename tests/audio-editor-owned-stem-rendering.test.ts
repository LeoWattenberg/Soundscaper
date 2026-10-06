/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportSnapshotRenderer } from '../src/common/editor/controller/export/export-snapshot-renderer.ts';
import { createMonotonicStemPresentation, createOwnedStemProgress } from '../src/common/editor/controller/export/internal/archive/owned-stem-progress.ts';
import { admitDirectStemPipeline } from '../src/common/editor/controller/export/internal/direct/direct-stem-pipeline-admission.ts';
import { inspectZip32Layout } from '../src/common/editor/controller/export/internal/archive/zip32.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioSource, createAudioClip, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createExportPlan } from '../src/common/editor/export.js';

test('owned stem progress and archive acknowledgments share one monotonic absolute observer', () => {
	const values: number[] = []; let current = true; let cancelled = 0; const abort = new AbortController();
	const ports = createMonotonicStemPresentation({ task: { setPhase: () => current, update: () => current },
		assertCurrent() { if (!current) throw new Error('replaced'); }, reportProgress(value) { values.push(value); }, setStatus() {} });
	const first = createOwnedStemProgress(ports, abort.signal); const next = createOwnedStemProgress(ports, abort.signal);
	first.reportAbsolute(.4); next.reportAbsolute(.8); ports.reportProgress(.5);
	assert.deepEqual(values, [.4, .8, .8]);
	next.taskProgress.setCancellation(() => { cancelled++; }); abort.abort();
	assert.equal(cancelled, 1); next.reportAbsolute(.9); first.dispose(); first.reportAbsolute(1);
	assert.deepEqual(values, [.4, .8, .8]); current = false; ports.reportProgress(1); assert.deepEqual(values, [.4, .8, .8]);
});

test('default snapshot factory creates an owned renderer retaining captured options, providers and engine semantics', async () => {
	const source = new Map(); const options = {}; const calls: unknown[] = []; const progress: number[] = [];
	const renderer = createExportSnapshotRenderer({ options, sourceBuffers: source, taskProgress: null,
		createCacheAwareRenderEngine: () => ({ loadProject(...args: unknown[]) { calls.push(args); },
			async renderMix(range: { onProgress(value: number): void }) { range.onProgress(.75); return 'audio'; }, async dispose() { calls.push('dispose'); } }),
		async prepareCommittedTimePitchCaches(snapshot: unknown, signal: unknown) { calls.push([snapshot, signal]); },
		throwIfAborted() {}, updateExportProgress() { throw new Error('global progress must remain private'); } });
	const owned = renderer.createOwnedEntryRenderer!({ getSnapshot: () => ({ kind: 'export', value: .75 }) }, (value) => { progress.push(value); });
	const snapshot = {}; const chunks = {}; const signal = new AbortController().signal;
	assert.equal(await owned.renderSnapshot(snapshot, {}, source, signal, chunks), 'audio');
	assert.deepEqual(calls, [[snapshot, signal], [snapshot, source, { chunkSources: chunks }], 'dispose']); assert.deepEqual(progress, [.75]);
});

test('stem pipeline reserves archive, two entries and source-width retry spool without raising heap thresholds', () => {
	const plan = eligiblePlan(); const admission = admitDirectStemPipeline(plan, { sampleRate: 48000, masterChannels: 2 }, 'speed');
	assert.ok(admission); assert.equal(admission.retryPcmBytes, 48000 * 2 * 4);
	assert.equal(admission.temporaryBytes, plan.archive.expectedByteLength + 2 * 60 + admission.retryPcmBytes);
	assert.equal(admitDirectStemPipeline(plan, { sampleRate: 48000, masterChannels: 2 }, 'memory'), null);
	assert.equal(admitDirectStemPipeline(plan, { sampleRate: 48000, masterChannels: 2 }, undefined), null);
	assert.equal(admitDirectStemPipeline({ ...plan, render: { ...plan.render, thresholds: { outputBytes: 384000, totalBytes: admission.heapBytes - 1 } } }, { sampleRate: 48000, masterChannels: 2 }, 'speed'), null);
});

test('wide-channel rate conversion cannot enter the one-next pipeline using encoded mono width', () => {
	const source = createAudioSource({ id: 'wide', name: 'Wide source', frameCount: 320000, channelCount: 32, sampleRate: 8000 });
	const clips = [0, 1].map((index) => createAudioClip({ id: `clip-${index}`, sourceId: source.id, sourceDurationFrames: 320000, durationFrames: 320000 }));
	const tracks = clips.map((clip, index) => createAudioTrack({ id: `track-${index}`, name: `Track ${index}`, clipIds: [clip.id] }, 8000));
	const project = createCurrentAudioEditorProject({ id: 'wide', sampleRate: 8000, masterChannels: 32, sources: [source], clips, tracks });
	const plan = createExportPlan(project, { mode: 'stems', format: 'wav', sampleRate: 192000, sampleFormat: 'float32', channelMapping: 'mono', includeTail: false });
	assert.equal(plan.render.strategy, 'offline'); assert.equal(plan.outputFileBytesPerRender, 30720044);
	assert.equal(plan.outputFrames * project.masterChannels * 4, 983040000);
	assert.equal(admitDirectStemPipeline(plan, project, 'speed'), null);
});

test('ordinary same-rate production two-stem plan is admitted under the existing Speed render thresholds', () => {
	const source = createAudioSource({ id: 'short', name: 'Short stereo source', frameCount: 48000, channelCount: 2, sampleRate: 48000 });
	const clips = [0, 1].map((index) => createAudioClip({ id: `clip-${index}`, sourceId: source.id, sourceDurationFrames: 48000, durationFrames: 48000 }));
	const tracks = clips.map((clip, index) => createAudioTrack({ id: `track-${index}`, name: `Track ${index}`, clipIds: [clip.id] }, 48000));
	const project = createCurrentAudioEditorProject({ id: 'short', sampleRate: 48000, masterChannels: 2, sources: [source], clips, tracks });
	const plan = createExportPlan(project, { mode: 'stems', format: 'wav', sampleRate: 48000, sampleFormat: 'float32', includeTail: false });
	const admission = admitDirectStemPipeline(plan, project, 'speed'); assert.ok(admission);
	assert.ok(plan.archive); assert.ok(plan.archive.expectedByteLength !== null);
	assert.equal(plan.outputFileBytesPerRender, 384044); assert.equal(plan.archive.entries.length, 2);
	assert.equal(admission.temporaryBytes, plan.archive.expectedByteLength + 2 * 384044 + 384000);
	assert.ok(admission.heapBytes <= 1024 ** 3); assert.equal(admitDirectStemPipeline(plan, project, 'memory'), null);
});

function eligiblePlan() {
	const entries = [{ fileName: 'a.wav', expectedByteLength: 60 }, { fileName: 'b.wav', expectedByteLength: 60 }];
	const zip32 = inspectZip32Layout(entries.map((entry) => ({ fileName: entry.fileName, byteLength: entry.expectedByteLength })));
	return { mode: 'stems', format: 'wav', mimeType: 'audio/wav', sampleRate: 48000, channelCount: 2, outputFrames: 48000,
		outputBytesPerRender: 384000, outputFileBytesPerRender: 60, range: { durationFrames: 48000 }, tailFrames: 0,
		outputs: entries.map((entry, index) => ({ fileName: entry.fileName, trackId: `track-${index}` })),
		archive: { format: 'zip', fileName: 'stems.zip', mimeType: 'application/zip', entries, zip32, expectedByteLength: zip32.archiveByteLength },
		render: { strategy: 'offline', fast: true, livePcmBytes: 100, offlineRenderAdmission: { admitted: true, peakUsefulBinaryBytes: 500000 },
			thresholds: { outputBytes: 384000, totalBytes: 1024 ** 3 } } };
}
