/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	commitDirectCompressedDestination,
	directCompressedStagingTemporaryBytes,
	encodeDirectCompressedStagedFile,
	prepareDirectCompressedDestination,
	type DirectCompressedFormat,
	type DirectCompressedPlan,
} from '../src/common/editor/controller/direct-compressed-export.ts';
import { createExportPlan } from '../src/common/editor/export.js';

interface FormatCase {
	readonly extension: string;
	readonly format: DirectCompressedFormat;
	readonly label: string;
	readonly mappingMode: string;
	readonly mimeType: string;
	readonly options: Readonly<Record<string, unknown>>;
	readonly pickerMimeType: string;
	readonly setting: readonly [string, number | string];
}

interface CanonicalPlan extends DirectCompressedPlan {
	readonly channelCount: number;
	readonly encoding: Readonly<Record<string, unknown>> & {
		readonly backend: string;
		readonly channelMapping: Readonly<{ readonly mode: string }>;
		readonly extension: string;
	};
	readonly format: string;
	readonly metadata: Readonly<Record<string, unknown>>;
	readonly mimeType: string;
	readonly outputFrames: number;
	readonly outputs: Array<{ fileName: string }>;
	readonly render: Readonly<{ readonly reason: string; readonly strategy: string }>;
}

const FORMAT_CASES: readonly FormatCase[] = Object.freeze([
	{ format: 'mp3', extension: 'mp3', mimeType: 'audio/mpeg', pickerMimeType: 'audio/mpeg', label: 'MP3', mappingMode: 'preserve', setting: ['bitRate', 320], options: { bitRate: 320 } },
	{ format: 'flac', extension: 'flac', mimeType: 'audio/flac', pickerMimeType: 'audio/flac', label: 'FLAC', mappingMode: 'mono', setting: ['compressionLevel', 8], options: { sampleFormat: 'int16', compressionLevel: 8, dither: 'triangular-highpass', channelMapping: 'mono' } },
	{ format: 'ogg-vorbis', extension: 'ogg', mimeType: 'audio/ogg; codecs=vorbis', pickerMimeType: 'audio/ogg', label: 'Ogg Vorbis', mappingMode: 'custom', setting: ['quality', -1], options: { quality: -1, channelMapping: { channels: [0, 1, 0] } } },
	{ format: 'opus', extension: 'opus', mimeType: 'audio/ogg; codecs=opus', pickerMimeType: 'audio/ogg', label: 'Opus', mappingMode: 'preserve', setting: ['bitRate', 320], options: { bitRate: 320 } },
	{ format: 'wavpack', extension: 'wv', mimeType: 'audio/x-wavpack', pickerMimeType: 'audio/x-wavpack', label: 'WavPack', mappingMode: 'preserve', setting: ['compressionLevel', 5], options: { sampleFormat: 'int32', compressionLevel: 5, dither: 'triangular-highpass' } },
	{ format: 'mp2', extension: 'mp2', mimeType: 'audio/mpeg', pickerMimeType: 'audio/mpeg', label: 'MP2', mappingMode: 'mono', setting: ['bitRate', 384], options: { bitRate: 384, channelMapping: 'mono' } },
	{ format: 'aac-m4a', extension: 'm4a', mimeType: 'audio/mp4', pickerMimeType: 'audio/mp4', label: 'AAC / M4A', mappingMode: 'preserve', setting: ['bitRate', 320], options: { bitRate: 320 } },
]);

test('canonical realtime compressed plans select, encode, and commit exact descriptor targets', async () => {
	for (const entry of FORMAT_CASES) {
		const plan = canonicalPlan(entry);
		assert.equal(plan.render.strategy, 'realtime-stream', entry.format);
		assert.equal(plan.render.reason, 'total-memory', entry.format);
		assert.equal(plan.format, entry.format);
		assert.equal(plan.mimeType, entry.mimeType);
		assert.equal(plan.encoding.backend, 'ffmpeg');
		assert.equal(plan.encoding.extension, entry.extension);
		assert.equal(plan.encoding[entry.setting[0]], entry.setting[1]);
		assert.equal(plan.encoding.channelMapping.mode, entry.mappingMode);
		assert.deepEqual(plan.metadata, { artist: 'Codex', title: entry.format });
		assert.equal(plan.outputs[0].fileName.endsWith(`.${entry.extension}`), true);
		assert.equal(directCompressedStagingTemporaryBytes(plan), plan.outputFrames * plan.channelCount * 4);

		const events: string[] = [];
		const target = preparedTarget(plan.outputs[0].fileName, events);
		const signal = new AbortController().signal;
		let pickerRequest: Readonly<Record<string, unknown>> | null = null;
		const preparation = await prepareDirectCompressedDestination({
			prepareSave(request) { pickerRequest = request; events.push('picker'); return target; },
		}, plan, { saveTarget: { id: entry.format }, useFileSystemAccess: false }, signal);
		assert.ok(preparation.destination);
		assert.equal(target.opens(), 0);
		assert.deepEqual(pickerRequest, {
			purpose: 'audio',
			suggestedName: plan.outputs[0].fileName,
			mimeType: entry.mimeType,
			target: { id: entry.format },
			types: [{ description: `${entry.label} audio`, accept: { [entry.pickerMimeType]: [`.${entry.extension}`] } }],
			useFileSystemAccess: false,
			signal,
		});

		const stagedFile = new Blob([Uint8Array.of(0)], { type: 'audio/wav' });
		const encoded = await encodeDirectCompressedStagedFile({
			destination: preparation.destination,
			plan,
			stagedFile,
			encodingSettings: { ...plan.encoding, probe: entry.format },
			signal,
			assertCurrent: () => { events.push('current'); },
			cleanupStagedFile: async () => { events.push('staging:cleanup'); },
			ffmpeg: {
				async encodeFileToSink(file, format, sink, settings) {
					assert.strictEqual(file, stagedFile);
					assert.equal(format, entry.format);
					assert.equal(settings.probe, entry.format);
					assert.strictEqual(settings.signal, signal);
					for (const [key, value] of Object.entries(plan.encoding)) assert.deepEqual(settings[key], value, key);
					(settings.assertCurrent as () => void)();
					events.push('ffmpeg:stat');
					await sink.open(5);
					await sink.write(Uint8Array.of(1, 2));
					await sink.write(Uint8Array.of(3, 4, 5));
					const output = await sink.close();
					return { output, byteLength: 5, chunkCount: 2, extension: `.${entry.extension}`, mimeType: entry.mimeType };
				},
			},
		});
		assert.equal(encoded.mimeType, entry.mimeType);
		assert.equal(encoded.byteLength, 5);
		assert.ok(events.indexOf('picker') < events.indexOf('ffmpeg:stat'));
		assert.ok(events.indexOf('ffmpeg:stat') < events.indexOf('target:open'));
		assert.ok(events.indexOf('target:close') < events.indexOf('staging:cleanup'));
		const published = await commitDirectCompressedDestination(
			preparation.destination, plan, encoded.byteLength, () => { events.push('commit:current'); },
		);
		assert.deepEqual(published, { method: 'memory', fileName: plan.outputs[0].fileName, size: 5 });
		assert.equal(target.commits(), 1);
		assert.equal(target.aborts(), 0);
	}
});

test('canonical centrally admitted offline plans select unopened targets for all compressed formats', async () => {
	for (const entry of FORMAT_CASES) {
		const plan = actualPlan(entry.format, { ...entry.options, livePcmBytes: 0 });
		assert.equal(plan.render.strategy, 'offline', entry.format);
		const events: string[] = [];
		const target = preparedTarget(plan.outputs[0].fileName, events);
		const preparation = await prepareDirectCompressedDestination(
			{ prepareSave() { events.push('picker'); return target; } },
			plan,
			null,
			new AbortController().signal,
		);
		assert.ok(preparation.destination, entry.format);
		assert.deepEqual(events, ['picker'], entry.format);
		assert.equal(target.opens(), 0, entry.format);
		const inputChannels = Number(plan.encoding.inputChannelCount);
		const stagingBytesPerSample = entry.format === 'flac' ? Number(plan.encoding.bitDepth) / 8 : 4;
		assert.equal(
			directCompressedStagingTemporaryBytes(plan),
			plan.outputFrames * inputChannels * stagingBytesPerSample,
			entry.format,
		);
	}
});

test('direct compressed admission rejects every noncanonical route and plan drift', async () => {
	const mp3 = canonicalPlan(FORMAT_CASES[0]!);
	const offline = actualPlan('mp3', { livePcmBytes: 0 });
	const ineligible: Array<Readonly<{ label: string; plan: DirectCompressedPlan }>> = [
		{ label: 'native backend', plan: actualPlan('wav') },
		{ label: 'custom backend', plan: actualPlan('custom-ffmpeg', { extension: 'foo', mimeType: 'audio/x-foo', customArguments: ['-c:a', 'copy'] }) },
		changedPlan(offline, 'bare offline render', (plan) => { plan.render = { strategy: 'offline' }; }),
		changedPlan(offline, 'forged offline admission', (plan) => {
			record(record(plan.render).offlineRenderAdmission).maximumUsefulBinaryBytes = 1;
		}),
		{ label: 'stems archive', plan: actualPlan('mp3', { mode: 'stems' }) },
		changedPlan(mp3, 'backend drift', (plan) => { record(plan.encoding).backend = 'custom-ffmpeg'; }),
		changedPlan(mp3, 'setting drift', (plan) => { record(plan.encoding).bitRate = 191; }),
		changedPlan(mp3, 'metadata drift', (plan) => { plan.metadata = { artist: 'changed' }; }),
		changedPlan(mp3, 'mapping drift', (plan) => { record(plan.channelMapping).mode = 'mono'; }),
		changedPlan(mp3, 'wrong MIME', (plan) => { plan.mimeType = 'audio/mp3'; }),
		changedPlan(mp3, 'wrong filename', (plan) => { records(plan.outputs)[0]!.fileName = 'Session.wav'; }),
		changedPlan(mp3, 'inexact geometry', (plan) => { plan.outputBytesPerRender = 7; }),
		changedPlan(mp3, 'file size claim', (plan) => { plan.outputFileBytesPerRender = 5; }),
		changedPlan(mp3, 'archive route', (plan) => { plan.archive = {}; }),
		changedPlan(mp3, 'unknown reason', (plan) => { record(plan.render).reason = 'manual'; }),
	];
	for (const entry of ineligible) {
		let pickers = 0;
		const preparation = await prepareDirectCompressedDestination({
			prepareSave() { pickers += 1; return preparedTarget('unused', []); },
		}, entry.plan, null, new AbortController().signal);
		assert.equal(pickers, 0, entry.label);
		assert.equal(preparation.destination, null, entry.label);
		assert.equal(directCompressedStagingTemporaryBytes(entry.plan), null, entry.label);
	}
});

test('descriptor result mismatch and cross-format plan drift abort once without publication', async () => {
	for (const failure of ['result', 'drift'] as const) {
		const entry = FORMAT_CASES.find(({ format }) => format === 'ogg-vorbis')!;
		const plan = canonicalPlan(entry);
		const target = preparedTarget(plan.outputs[0].fileName, []);
		const preparation = await prepareDirectCompressedDestination(
			{ prepareSave: () => target }, plan, null, new AbortController().signal,
		);
		assert.ok(preparation.destination);
		let cleanups = 0;
		const error = await encodeDirectCompressedStagedFile({
			destination: preparation.destination,
			plan,
			stagedFile: new Blob([Uint8Array.of(0)], { type: 'audio/wav' }),
			encodingSettings: plan.encoding,
			signal: new AbortController().signal,
			assertCurrent: () => undefined,
			cleanupStagedFile: async () => { cleanups += 1; },
			ffmpeg: {
				async encodeFileToSink(_file, _format, sink) {
					await sink.open(3);
					await sink.write(Uint8Array.of(1, 2, 3));
					const output = await sink.close();
					if (failure === 'drift') plan.outputs[0].fileName = 'changed.ogg';
					return { output, byteLength: 3, chunkCount: 1, extension: '.ogg', mimeType: 'audio/wrong' };
				},
			},
		}).then(() => null, (caught: unknown) => caught);
		assert.ok(error instanceof Error);
		assert.equal(cleanups, 1);
		assert.equal(target.aborts(), 1);
		assert.equal(target.commits(), 0);
	}
});

function canonicalPlan(entry: FormatCase) {
	return actualPlan(entry.format, entry.options);
}

function actualPlan(format: string, options: Readonly<Record<string, unknown>> = {}) {
	return createExportPlan(realtimeProject(), {
		mode: 'mix', format, includeTail: false, livePcmBytes: 2 * 1024 ** 3,
		metadata: { artist: 'Codex', title: format }, date: '2026-08-02', ...options,
	}) as unknown as CanonicalPlan;
}

function changedPlan(
	base: unknown,
	label: string,
	change: (plan: Record<string, unknown>) => void,
): Readonly<{ label: string; plan: DirectCompressedPlan }> {
	const plan = structuredClone(base) as Record<string, unknown>;
	change(plan);
	return { label, plan };
}

function record(value: unknown): Record<string, unknown> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	return value as Record<string, unknown>;
}

function records(value: unknown): Record<string, unknown>[] {
	assert.ok(Array.isArray(value));
	return value as Record<string, unknown>[];
}

function preparedTarget(fileName: string, events: string[]) {
	let byteLength = 0;
	let openCount = 0;
	let abortCount = 0;
	let commitCount = 0;
	return {
		mode: 'stream' as const,
		async createWritable() {
			openCount += 1;
			events.push('target:open');
			return new WritableStream<Uint8Array>({
				write(chunk) { byteLength += chunk.byteLength; },
				close() { events.push('target:close'); },
			});
		},
		bytesWritten: () => byteLength,
		async commit() { commitCount += 1; events.push('target:commit'); return { method: 'memory', fileName, size: byteLength }; },
		async abort() { abortCount += 1; events.push('target:abort'); },
		opens: () => openCount,
		aborts: () => abortCount,
		commits: () => commitCount,
	};
}

function realtimeProject() {
	return {
		schemaVersion: 9, id: 'direct-compressed-project', title: 'Session', revision: 1,
		createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
		sampleRate: 48_000, masterChannels: 2, metadata: {},
		selection: { startFrame: 0, endFrame: 1 }, loop: { enabled: false, startFrame: 0, endFrame: 1 },
		sources: [{ id: 'source', name: 'Source', storageKey: 'pcm/source', mimeType: 'audio/wav', frameCount: 1, channelCount: 2, sampleRate: 48_000, sampleFormat: 'float32' }],
		clips: [{ id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 1 }],
		tracks: [{ id: 'track', type: 'audio', name: 'Track', clipIds: ['clip'], effectsActive: true, effects: [] }],
		mixer: { groups: [], sends: [], routes: {} }, master: { effectsActive: true, effects: [] },
	};
}
