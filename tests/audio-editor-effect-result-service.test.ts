/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createSelectionEffectResultService,
	type EffectResultCommitOptions,
	type SelectionEffectResultRuntime,
} from '../src/common/editor/controller/effect-result-service.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source-audio.ts';

type PasteOptions = Parameters<SelectionEffectResultRuntime['preparePasteCommand']>[1];
type RangeDeleteOptions = Parameters<SelectionEffectResultRuntime['prepareRangeDeleteCommand']>[1];
type RangeReplacementOptions = Parameters<SelectionEffectResultRuntime['prepareRangeReplacementCommand']>[1];

interface HarnessEvents {
	readonly analysesDeleted: string[];
	readonly analysesSaved: string[];
	readonly assertedChannels: number[];
	readonly buffersCached: string[];
	readonly commits: Array<Readonly<{
		command: AudioEditorCommand;
		options: EffectResultCommitOptions;
	}>>;
	readonly contexts: string[];
	readonly eventOrder: string[];
	readonly labels: Array<unknown>;
	readonly pasteOptions: PasteOptions[];
	readonly rangeDeletes: RangeDeleteOptions[];
	readonly rangeReplacements: RangeReplacementOptions[];
	readonly sourcesAborted: string[];
	readonly sourcesDeleted: string[];
	readonly sourcesOpened: string[];
	readonly sourcesWritten: string[];
}

interface HarnessOptions {
	readonly runtime?: Partial<SelectionEffectResultRuntime>;
}

function createBuffer(channels: readonly Float32Array[], sampleRate = 48_000): AudioBufferLike {
	return {
		length: channels[0]?.length ?? 0,
		numberOfChannels: channels.length,
		sampleRate,
		getChannelData(channel: number) {
			return channels[channel] ?? new Float32Array(0);
		},
	};
}

function createHarness({ runtime: overrides = {} }: HarnessOptions = {}) {
	const events: HarnessEvents = {
		analysesDeleted: [],
		analysesSaved: [],
		assertedChannels: [],
		buffersCached: [],
		commits: [],
		contexts: [],
		eventOrder: [],
		labels: [],
		pasteOptions: [],
		rangeDeletes: [],
		rangeReplacements: [],
		sourcesAborted: [],
		sourcesDeleted: [],
		sourcesOpened: [],
		sourcesWritten: [],
	};
	const sourceBuffers = new Map<string, unknown>();
	const sourcePeaks = new Map<string, unknown>();
	const project = { id: 'project-1' };
	let sourceIndex = 0;
	let replacementIndex = 0;
	const defaults: SelectionEffectResultRuntime = {
		SOURCE_CHUNK_FRAMES: 65_536,
		assertAudacityEffectOutput(channels) {
			events.assertedChannels.push(channels.length);
		},
		audioSelectionEffectLabel(type) {
			events.labels.push(type);
			return 'Effect';
		},
		async bufferFromChannels(channels, sampleRate, context) {
			events.contexts.push(String(context));
			return createBuffer(channels, sampleRate);
		},
		cacheSourceBuffer(sourceId, buffer) {
			events.buffersCached.push(sourceId);
			sourceBuffers.set(sourceId, buffer);
		},
		commit(command, options) {
			events.eventOrder.push('editor-commit');
			events.commits.push({ command, options });
		},
		copy: {
			audioAnalysisFailed: 'Analysis failed.',
			audioAnalysisWorkerFailed: 'Analysis worker failed.',
			audioBufferUnsupported: 'Audio buffers are unsupported.',
			audacityProjectTooLong: 'The project is too long.',
			decodedAudioEmpty: 'Decoded audio is empty.',
			decodedChannelLengthsMismatch: 'Decoded channel lengths changed.',
			effectChannelLayoutChanged: 'Channel layout changed.',
			effectChannelLengthsMismatch: 'Channel lengths changed.',
			effectInvalidAudio: 'Invalid audio.',
			effectTrackLengthsMismatch: 'Track lengths changed.',
		},
		createStableId(prefix) {
			sourceIndex += 1;
			return `${prefix}-${sourceIndex}`;
		},
		engine: {
			async getAudioContext() {
				return {};
			},
		},
		async generateWaveformPeaks(channels) {
			return { channelCount: channels.length };
		},
		peakCacheKey: (sourceId) => `peaks:${sourceId}`,
		preparePasteCommand(clipboard, options) {
			events.pasteOptions.push(options);
			return {
				type: 'clipboard/paste',
				clipboard,
				atFrame: options.atFrame,
				trackMap: options.trackMap,
				mode: options.mode,
			};
		},
		prepareRangeDeleteCommand(_project, options) {
			events.rangeDeletes.push(options);
			return {
				type: 'range/ripple-delete',
				trackIds: options.trackIds,
				startFrame: options.startFrame,
				endFrame: options.endFrame,
			};
		},
		prepareRangeReplacementCommand(_project, options) {
			events.rangeReplacements.push(options);
			replacementIndex += 1;
			return {
				type: 'range/replace',
				...options,
				clipId: `replacement-clip-${replacementIndex}`,
			};
		},
		getProject: () => project,
		projectSampleRate: () => 48_000,
		sourceBuffers,
		sourcePeaks,
		state: { selectedTrackId: 'track-2' },
		store: {
			async beginSourceWrite(sourceId) {
				events.sourcesOpened.push(sourceId);
				return {
					async write() {
						events.eventOrder.push(`write:${sourceId}`);
						events.sourcesWritten.push(sourceId);
					},
					async commit() {
						events.eventOrder.push(`source-commit:${sourceId}`);
					},
					async abort() {
						events.sourcesAborted.push(sourceId);
					},
				};
			},
			async saveAnalysis(key) {
				events.eventOrder.push(`analysis:${key}`);
				events.analysesSaved.push(key);
			},
			async deleteAnalysis(key) {
				events.analysesDeleted.push(key);
			},
			async deleteSource(sourceId) {
				events.sourcesDeleted.push(sourceId);
			},
		},
		throwIfAborted(signal) {
			if (!signal?.aborted) return;
			throw signal.reason instanceof Error
				? signal.reason
				: new DOMException('The operation was cancelled.', 'AbortError');
		},
		async writeBuffer(writer, buffer) {
			await writer.write(Array.from(
				{ length: buffer.numberOfChannels },
				(_, channel) => buffer.getChannelData(channel),
			));
		},
	};
	const runtime: SelectionEffectResultRuntime = { ...defaults, ...overrides };
	return {
		events,
		project,
		runtime,
		service: createSelectionEffectResultService(runtime),
		sourceBuffers,
		sourcePeaks,
	};
}

function target(
	id: string,
	options: Readonly<{
		channelCount?: number;
		clipId?: string;
		durationFrames?: number;
		hasAudio?: boolean;
		startFrame?: number;
	}> = {},
) {
	const startFrame = options.startFrame ?? 10;
	const durationFrames = options.durationFrames ?? 4;
	return {
		channelCount: options.channelCount ?? 1,
		durationFrames,
		endFrame: startFrame + durationFrames,
		hasAudio: options.hasAudio ?? true,
		startFrame,
		track: {
			clipIds: options.clipId ? [options.clipId] : [],
			id,
			name: `Track ${id}`,
			type: 'audio' as const,
		},
		...(options.clipId ? { clipId: options.clipId } : {}),
	};
}

function requireBatch(command: AudioEditorCommand | undefined): Extract<AudioEditorCommand, { readonly type: 'batch' }> {
	assert.equal(command?.type, 'batch');
	if (!command || command.type !== 'batch') throw new Error('Expected a batch command.');
	return command;
}

test('effect results replace exact clips together without range alignment constraints', async () => {
	const { events, service } = createHarness();
	const replacements = await service.persistAudacityEffectResults([
		{ target: target('track-1', { clipId: 'clip-1', startFrame: 3 }), channels: [new Float32Array(2)] },
		{ target: target('track-2', { clipId: 'clip-2', startFrame: 40 }), channels: [new Float32Array(5)] },
	], 'normalize', { effectName: 'Normalize' });

	assert.deepEqual(replacements, [null, null]);
	assert.equal(events.commits.length, 1);
	assert.deepEqual(events.commits[0], {
		command: {
			type: 'batch',
			commands: [{
				type: 'clip/render-replace-many',
				entries: [
					{
						clipId: 'clip-1',
						source: {
							id: 'audacity-effect-1',
							storageKey: 'audacity-effect-1',
							name: 'Track track-1 — Normalize.wav',
							mimeType: 'audio/wav',
							frameCount: 2,
							channelCount: 1,
							sampleRate: 48_000,
							originalSampleRate: 48_000,
						},
					},
					{
						clipId: 'clip-2',
						source: {
							id: 'audacity-effect-2',
							storageKey: 'audacity-effect-2',
							name: 'Track track-2 — Normalize.wav',
							mimeType: 'audio/wav',
							frameCount: 5,
							channelCount: 1,
							sampleRate: 48_000,
							originalSampleRate: 48_000,
						},
					},
				],
			}, {
				type: 'selection/set',
				startFrame: 0,
				endFrame: 0,
				trackIds: ['track-1', 'track-2'],
				clipIds: ['clip-1', 'clip-2'],
				frequencyRange: null,
			}],
		},
		options: { selectTrackId: 'track-2' },
	});
});

test('effect results prepare range replacements and restore detailed selection', async () => {
	const { events, project, service } = createHarness();
	const replacements = await service.persistAudacityEffectResults([
		{ target: target('track-1'), channels: [new Float32Array(6)] },
	], 'amplify', {
		selectionDetails: {
			trackIds: ['track-1'],
			clipIds: [],
			frequencyRange: { minimumFrequency: 100, maximumFrequency: 2_000 },
		},
	});

	assert.deepEqual(events.labels, ['amplify']);
	assert.equal(events.rangeReplacements.length, 1);
	assert.equal(events.rangeReplacements[0]?.trackId, 'track-1');
	assert.equal(events.rangeReplacements[0]?.startFrame, 10);
	assert.equal(events.rangeReplacements[0]?.endFrame, 14);
	assert.equal(events.rangeReplacements[0]?.source?.frameCount, 6);
	assert.equal(replacements[0]?.type, 'range/replace');
	assert.deepEqual(events.commits[0]?.command, {
		type: 'batch',
		commands: [replacements[0], {
			type: 'selection/set',
			startFrame: 10,
			endFrame: 16,
			trackIds: ['track-1'],
			clipIds: [],
			frequencyRange: { minimumFrequency: 100, maximumFrequency: 2_000 },
		}],
	});
	assert.deepEqual(events.commits[0]?.options, {
		selectTrackId: 'track-1',
		selectClipId: 'replacement-clip-1',
	});
	assert.equal(project.id, 'project-1');
});

test('independent range lengths select the longest output but still require aligned starts', async () => {
	const { events, service } = createHarness();
	await service.persistAudacityEffectResults([
		{ target: target('track-1'), channels: [new Float32Array(3)] },
		{ target: target('track-2'), channels: [new Float32Array(7)] },
	], null, { allowIndependentLengths: true, effectName: 'Nyquist' });
	assert.deepEqual(requireBatch(events.commits[0]?.command).commands.at(-1), {
		type: 'selection/set',
		startFrame: 10,
		endFrame: 17,
	});

	const misaligned = createHarness();
	await assert.rejects(misaligned.service.persistAudacityEffectResults([
		{ target: target('track-1'), channels: [new Float32Array(3)] },
		{ target: target('track-2', { startFrame: 11 }), channels: [new Float32Array(7)] },
	], null, { allowIndependentLengths: true, effectName: 'Nyquist' }), {
		message: 'Track lengths changed.',
	});
	assert.equal(misaligned.events.sourcesOpened.length, 0);
});

test('silent results prepare shrink, growth, and unchanged ripple commands without source writes', async () => {
	const { events, service } = createHarness();
	const silentTarget = target('track-1', { durationFrames: 4, hasAudio: false });
	assert.equal(service.prepareSilentAudacityRippleCommand(silentTarget, 4), null);
	assert.deepEqual(service.prepareSilentAudacityRippleCommand(silentTarget, 2), {
		type: 'range/ripple-delete',
		trackIds: ['track-1'],
		startFrame: 12,
		endFrame: 14,
	});
	assert.deepEqual(service.prepareSilentAudacityRippleCommand(silentTarget, 7), {
		type: 'clipboard/paste',
		clipboard: {
			schemaVersion: 1,
			sampleRate: 48_000,
			durationFrames: 3,
			tracks: [{
				sourceTrackId: 'track-1',
				sourceTrackName: 'Track track-1',
				clips: [],
			}],
		},
		atFrame: 14,
		trackMap: { 'track-1': 'track-1' },
		mode: 'insert-track',
	});

	await service.persistAudacityEffectResults([
		{ target: silentTarget, channels: [new Float32Array(7)] },
	], null, { effectName: 'Truncate silence' });
	assert.equal(events.sourcesOpened.length, 0);
	assert.equal(events.buffersCached.length, 0);
	assert.deepEqual(requireBatch(events.commits[0]?.command).commands.map((command) => command.type), [
		'clipboard/paste',
		'selection/set',
	]);
});

test('invalid effect result layouts fail before persistence', async (suite) => {
	const cases: Array<Readonly<{ name: string; results: unknown; message: string }>> = [
		{ name: 'not an array', results: null, message: 'Invalid audio.' },
		{ name: 'empty result list', results: [], message: 'Invalid audio.' },
		{ name: 'missing target', results: [{ channels: [new Float32Array(1)] }], message: 'Invalid audio.' },
		{ name: 'missing channels', results: [{ target: target('track-1') }], message: 'Invalid audio.' },
		{ name: 'empty channel', results: [{ target: target('track-1'), channels: [new Float32Array(0)] }], message: 'Invalid audio.' },
		{ name: 'more than stereo', results: [{ target: target('track-1', { channelCount: 3 }), channels: [new Float32Array(1), new Float32Array(1), new Float32Array(1)] }], message: 'Invalid audio.' },
		{ name: 'non-Float32 channel', results: [{ target: target('track-1'), channels: [[1]] }], message: 'Channel lengths changed.' },
		{ name: 'unequal channels', results: [{ target: target('track-1', { channelCount: 2 }), channels: [new Float32Array(2), new Float32Array(3)] }], message: 'Channel lengths changed.' },
		{ name: 'changed layout', results: [{ target: target('track-1', { channelCount: 2 }), channels: [new Float32Array(2)] }], message: 'Channel layout changed.' },
	];
	for (const fixture of cases) {
		await suite.test(fixture.name, async () => {
			const { events, service } = createHarness();
			await assert.rejects(service.persistAudacityEffectResults(
				fixture.results as Parameters<typeof service.persistAudacityEffectResults>[0],
				null,
			), {
				message: fixture.message,
			});
			assert.equal(events.sourcesOpened.length, 0);
			assert.equal(events.commits.length, 0);
		});
	}

	await suite.test('different linked output lengths', async () => {
		const { events, service } = createHarness();
		await assert.rejects(service.persistAudacityEffectResults([
			{ target: target('track-1'), channels: [new Float32Array(2)] },
			{ target: target('track-2'), channels: [new Float32Array(3)] },
		], null, { effectName: 'Effect' }), { message: 'Track lengths changed.' });
		assert.equal(events.sourcesOpened.length, 0);
	});
});

test('writer failure aborts the incomplete source and never commits the editor command', async () => {
	const sourceBuffers = new Map<string, unknown>();
	const sourcePeaks = new Map<string, unknown>();
	const writerError = new Error('source write failed');
	let aborted = 0;
	const { events, service } = createHarness({
		runtime: {
			sourceBuffers,
			sourcePeaks,
			store: {
				async beginSourceWrite() {
					return {
						write() { throw writerError; },
						commit() { throw new Error('commit should not run'); },
						abort() { aborted += 1; },
					};
				},
				async saveAnalysis() {},
				async deleteSource(sourceId) { events.sourcesDeleted.push(sourceId); },
			},
		},
	});

	await assert.rejects(service.persistAudacityEffectResults([
		{ target: target('track-1'), channels: [new Float32Array(4)] },
	], null, { effectName: 'Effect' }), writerError);
	assert.equal(aborted, 1);
	assert.equal(events.commits.length, 0);
	assert.equal(sourceBuffers.size, 0);
	assert.equal(sourcePeaks.size, 0);
});

test('analysis failure rolls back every persisted source and cache atomically', async () => {
	const analysisError = new Error('analysis storage failed');
	let saveCount = 0;
	const { events, service, sourceBuffers, sourcePeaks } = createHarness({
		runtime: {
			store: {
				async beginSourceWrite(sourceId) {
					events.sourcesOpened.push(sourceId);
					return {
						async write() {},
						async commit() { events.eventOrder.push(`source-commit:${sourceId}`); },
						async abort() { events.sourcesAborted.push(sourceId); },
					};
				},
				async saveAnalysis(key) {
					saveCount += 1;
					if (saveCount === 2) throw analysisError;
					events.analysesSaved.push(key);
				},
				async deleteAnalysis(key) { events.analysesDeleted.push(key); },
				async deleteSource(sourceId) { events.sourcesDeleted.push(sourceId); },
			},
		},
	});

	await assert.rejects(service.persistAudacityEffectResults([
		{ target: target('track-1'), channels: [new Float32Array(4)] },
		{ target: target('track-2'), channels: [new Float32Array(4)] },
	], null, { effectName: 'Effect' }), analysisError);
	assert.equal(events.commits.length, 0);
	assert.deepEqual(events.sourcesDeleted, ['audacity-effect-1', 'audacity-effect-2']);
	assert.deepEqual(events.analysesDeleted, ['peaks:audacity-effect-1', 'peaks:audacity-effect-2']);
	assert.equal(sourceBuffers.size, 0);
	assert.equal(sourcePeaks.size, 0);
});

test('effect result persistence revalidates project ownership after async setup', async () => {
	let current = true;
	const { events, service } = createHarness({
		runtime: {
			engine: {
				async getAudioContext() {
					current = false;
					return {};
				},
			},
		},
	});

	await assert.rejects(service.persistAudacityEffectResults([{
		target: target('track-1', { hasAudio: false }),
		channels: [new Float32Array(4)],
	}], null, {
		assertCurrent() {
			if (!current) throw new DOMException('Project changed.', 'AbortError');
		},
	}), { name: 'AbortError' });
	assert.equal(events.commits.length, 0);
});

test('aborting after a source commit rolls it back before any editor commit', async () => {
	const abort = new AbortController();
	const { events, service } = createHarness({
		runtime: {
			async generateWaveformPeaks() {
				abort.abort(new DOMException('Cancelled.', 'AbortError'));
				return { levels: [] };
			},
		},
	});

	await assert.rejects(service.persistAudacityEffectResults([
		{ target: target('track-1'), channels: [new Float32Array(4)] },
	], null, { effectName: 'Effect', signal: abort.signal }), { name: 'AbortError' });
	assert.equal(events.commits.length, 0);
	assert.deepEqual(events.sourcesDeleted, ['audacity-effect-1']);
	assert.deepEqual(events.analysesDeleted, ['peaks:audacity-effect-1']);
});

test('the editor mutation is one final commit after all source and analysis commits', async () => {
	const { events, service } = createHarness();
	await service.persistAudacityEffectResults([
		{ target: target('track-1'), channels: [new Float32Array(4)] },
		{ target: target('track-2'), channels: [new Float32Array(4)] },
	], null, { effectName: 'Effect' });

	assert.equal(events.commits.length, 1);
	assert.deepEqual(events.eventOrder, [
		'write:audacity-effect-1',
		'source-commit:audacity-effect-1',
		'write:audacity-effect-2',
		'source-commit:audacity-effect-2',
		'analysis:peaks:audacity-effect-1',
		'analysis:peaks:audacity-effect-2',
		'editor-commit',
	]);
});
