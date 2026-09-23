/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FREQUENCY_WAVEFORM_ANALYSIS_VERSION,
	FREQUENCY_WAVEFORM_FFT_SIZE,
	FREQUENCY_WAVEFORM_HOP_SIZE,
	FREQUENCY_WAVEFORM_MAX_SOURCE_BYTES,
	frequencyWaveformAnalysisByteLength,
	frequencyWaveformBlockSizes,
	type FrequencyWaveformAnalysis,
} from '../src/common/editor/frequency-waveform-contract.ts';
import {
	DEFAULT_MAXIMUM_RESIDENT_FREQUENCY_WAVEFORM_ANALYSIS_BYTES,
	DEFAULT_MAXIMUM_RESIDENT_FREQUENCY_WAVEFORM_ANALYSES,
	createFrequencyWaveformSourceService,
	type RequiredFrequencyWaveformSource,
} from '../src/common/editor/controller/source/frequency-waveform-source-service.ts';

const SOURCE: Readonly<RequiredFrequencyWaveformSource> = Object.freeze({
	id: 'source', kind: 'audio', storageKey: 'stored-source', frameCount: 4_096,
	channelCount: 1, sampleRate: 48_000,
});
const CLIP = Object.freeze({ id: 'clip', sourceId: SOURCE.id, kind: 'audio' });
const CROSSOVERS = Object.freeze({ lowMidCrossoverHz: 250, midHighCrossoverHz: 4_000 });

test('frequency waveform source analysis loads a matching persistent cache lazily', async () => {
	const cached = analysis();
	const fixture = createFixture({ cached });

	assert.equal(fixture.analyses.size, 0);
	assert.equal(await fixture.service.requestFrequencyWaveform(CLIP.id, CROSSOVERS), cached);
	assert.equal(fixture.analyses.get(SOURCE.id)?.analysis, cached);
	assert.deepEqual(fixture.loads, ['audio-editor-frequency-waveform-v1:source']);
	assert.equal(fixture.generated(), 0);
	assert.equal(fixture.saves.length, 0);
	assert.equal(fixture.publishes(), 1);
});

test('frequency waveform source analysis deduplicates generation and replaces stale crossover caches', async () => {
	let resolveGeneration: (value: FrequencyWaveformAnalysis) => void = () => undefined;
	const generated = new Promise<FrequencyWaveformAnalysis>((resolve) => { resolveGeneration = resolve; });
	const fixture = createFixture({
		cached: analysis({ lowMidHz: 300, midHighHz: 5_000 }),
		generate: async () => generated,
	});

	const first = fixture.service.requestFrequencyWaveform(CLIP.id, CROSSOVERS);
	const second = fixture.service.requestFrequencyWaveform(CLIP.id, CROSSOVERS);
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	assert.equal(fixture.generated(), 1);
	resolveGeneration(analysis());
	assert.equal(await first, await second);
	assert.equal(fixture.saves.length, 1);
	assert.equal(fixture.saves[0]?.key, 'audio-editor-frequency-waveform-v1:source');
	assert.equal(fixture.analyses.get(SOURCE.id)?.analysis.crossovers.lowMidHz, 250);
	assert.equal(fixture.publishes(), 1);
});

test('frequency waveform failures retain the ordinary waveform and can be retried', async () => {
	let fail = true;
	const fixture = createFixture({
		generate: async () => {
			if (fail) throw new Error('worker failed');
			return analysis();
		},
	});

	assert.equal(await fixture.service.requestFrequencyWaveform(CLIP.id, CROSSOVERS), null);
	assert.equal(fixture.analyses.size, 0);
	fail = false;
	assert.deepEqual(await fixture.service.requestFrequencyWaveform(CLIP.id, CROSSOVERS), analysis());
	assert.equal(fixture.generated(), 2);
});

test('source invalidation removes runtime and persistent frequency waveform data', async () => {
	const fixture = createFixture({ cached: analysis() });
	await fixture.service.requestFrequencyWaveform(CLIP.id, CROSSOVERS);
	await fixture.service.invalidateSource(SOURCE.id);

	assert.equal(fixture.analyses.size, 0);
	assert.deepEqual(fixture.deletes, ['audio-editor-frequency-waveform-v1:source']);
});

test('failed persistent invalidation cannot revive source-identical stale analysis', async () => {
	const fresh = analysis();
	fresh.levels[0]!.bands.low[0]!.maximums[0] = 0.75;
	const fixture = createFixture({
		cached: analysis(),
		generate: async () => fresh,
		delete: async () => { throw new Error('delete failed'); },
		save: async () => { throw new Error('save failed'); },
	});
	await fixture.service.requestFrequencyWaveform(CLIP.id, CROSSOVERS);
	await fixture.service.invalidateSource(SOURCE.id);

	assert.equal(await fixture.service.requestFrequencyWaveform(CLIP.id, CROSSOVERS), fresh);
	assert.equal(fixture.loads.length, 1, 'the stale payload is bypassed after its deletion fails');
	assert.equal(fixture.generated(), 1);
	fixture.service.clearRuntime();
	assert.equal(await fixture.service.requestFrequencyWaveform(CLIP.id, CROSSOVERS), fresh);
	assert.equal(fixture.loads.length, 1, 'the bypass survives runtime cache clearing until a save succeeds');
	assert.equal(fixture.generated(), 2);
});

test('a delayed obsolete save cannot remove or overwrite the newer analysis', async () => {
	let releaseFirstSave: () => void = () => undefined;
	let firstSaveStarted: () => void = () => undefined;
	const firstSave = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
	const saveStarted = new Promise<void>((resolve) => { firstSaveStarted = resolve; });
	const secondCrossovers = { lowMidCrossoverHz: 300, midHighCrossoverHz: 5_000 };
	const fixture = createFixture({
		cached: analysis({ lowMidHz: 300, midHighHz: 5_000 }),
		generate: async (crossovers) => analysis(crossovers),
		save: async (_key, _value, saveIndex) => {
			if (saveIndex !== 0) return;
			firstSaveStarted();
			await firstSave;
		},
	});

	const first = fixture.service.requestFrequencyWaveform(CLIP.id, CROSSOVERS);
	await saveStarted;
	const second = fixture.service.requestFrequencyWaveform(CLIP.id, secondCrossovers);
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	assert.equal(fixture.analyses.size, 0, 'a mismatched resident analysis falls back while cache writes settle');
	releaseFirstSave();

	assert.equal(await first, null);
	assert.equal((await second)?.crossovers.lowMidHz, 300);
	assert.deepEqual(fixture.saves.map(({ value }) => value.crossovers.lowMidHz), [250, 300]);
	assert.equal(fixture.analyses.get(SOURCE.id)?.analysis.crossovers.lowMidHz, 300);
	assert.equal(fixture.persisted()?.crossovers.lowMidHz, 300);
	assert.deepEqual(fixture.deletes, []);
});

test('returning to a resident configuration obsoletes an in-flight crossover request', async () => {
	let resolveGeneration: (value: FrequencyWaveformAnalysis) => void = () => undefined;
	const generated = new Promise<FrequencyWaveformAnalysis>((resolve) => { resolveGeneration = resolve; });
	const secondCrossovers = { lowMidCrossoverHz: 300, midHighCrossoverHz: 5_000 };
	const fixture = createFixture({
		cached: analysis(),
		generate: async () => generated,
	});

	await fixture.service.requestFrequencyWaveform(CLIP.id, CROSSOVERS);
	const second = fixture.service.requestFrequencyWaveform(CLIP.id, secondCrossovers);
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	assert.equal(fixture.analyses.size, 0);
	assert.equal(await fixture.service.requestFrequencyWaveform(CLIP.id, CROSSOVERS), fixture.cached);
	resolveGeneration(analysis({ lowMidHz: 300, midHighHz: 5_000 }));

	assert.equal(await second, null);
	assert.equal(fixture.analyses.get(SOURCE.id)?.analysis, fixture.cached);
	assert.equal(fixture.saves.length, 0);
});

test('source invalidation aborts active frequency analysis', async () => {
	let activeSignal: AbortSignal | undefined;
	const fixture = createFixture({
		generate: async (_crossovers, signal) => new Promise<FrequencyWaveformAnalysis>((resolve, reject) => {
			activeSignal = signal;
			signal.addEventListener('abort', () => reject(signal.reason), { once: true });
		}),
	});

	const request = fixture.service.requestFrequencyWaveform(CLIP.id, CROSSOVERS);
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	assert.equal(activeSignal?.aborted, false);
	await fixture.service.invalidateSource(SOURCE.id);

	assert.equal(activeSignal?.aborted, true);
	assert.equal(await request, null);
	assert.equal(fixture.analyses.size, 0);
});

test('relink waits for old cache writes and invalidation before loading the replacement source', async () => {
	let releaseSave: () => void = () => undefined;
	let saveStarted: () => void = () => undefined;
	const blockedSave = new Promise<void>((resolve) => { releaseSave = resolve; });
	const started = new Promise<void>((resolve) => { saveStarted = resolve; });
	const fixture = createFixture({
		save: async (_key, _value, saveIndex) => {
			if (saveIndex !== 0) return;
			saveStarted();
			await blockedSave;
		},
	});

	const oldRequest = fixture.service.requestFrequencyWaveform(CLIP.id, CROSSOVERS);
	await started;
	fixture.replaceSource({ ...SOURCE, storageKey: 'replacement-source' });
	const invalidation = fixture.service.invalidateSource(SOURCE.id);
	const replacementRequest = fixture.service.requestFrequencyWaveform(CLIP.id, CROSSOVERS);
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	assert.equal(fixture.generated(), 1, 'replacement analysis waits behind save and delete');
	releaseSave();

	await invalidation;
	assert.equal(await oldRequest, null);
	assert.ok(await replacementRequest);
	assert.equal(fixture.generated(), 2, 'replacement source is analyzed instead of accepting old cache data');
	assert.equal(fixture.analyses.get(SOURCE.id)?.storageKey, 'replacement-source');
});

test('frequency analysis limits concurrent source generation', async () => {
	const sources = Array.from({ length: 3 }, (_, index) => ({
		...SOURCE,
		id: `source-${index}`,
		storageKey: `stored-source-${index}`,
	}));
	const clips = sources.map((source, index) => ({
		id: `clip-${index}`,
		kind: 'audio',
		sourceId: source.id,
	}));
	const project = { id: 'project', clips, sources };
	const releases: Array<() => void> = [];
	let active = 0;
	let maximumActive = 0;
	const service = createFrequencyWaveformSourceService({
		findClip: (value, id) => value.clips.find((candidate) => candidate.id === id),
		findSource: (value, id) => value.sources.find((candidate) => candidate.id === id),
		getProject: () => project,
		sourceBuffers: new Map(),
		sourceFrequencyAnalyses: new Map(),
		store: {
			async loadAnalysis() { return null; },
			async saveAnalysis() {},
		},
		async generateFromBuffer() { return analysis(); },
		generateFromStore: async () => {
			active += 1;
			maximumActive = Math.max(maximumActive, active);
			return new Promise<FrequencyWaveformAnalysis>((resolve) => {
				releases.push(() => {
					active -= 1;
					resolve(analysis());
				});
			});
		},
		publishDocumentSnapshot() {},
	});

	const requests = clips.map((clip) => service.requestFrequencyWaveform(clip.id, CROSSOVERS));
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	assert.equal(releases.length, 2);
	assert.equal(maximumActive, 2);
	releases.shift()?.();
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	assert.equal(releases.length, 2);
	assert.equal(maximumActive, 2);
	for (const release of releases.splice(0)) release();
	assert.equal((await Promise.all(requests)).filter(Boolean).length, 3);
});

test('resident cache keeps more than eight short source analyses', async () => {
	const fixture = createResidentFixture(12);

	assert.equal(DEFAULT_MAXIMUM_RESIDENT_FREQUENCY_WAVEFORM_ANALYSES, 256);
	assert.equal(DEFAULT_MAXIMUM_RESIDENT_FREQUENCY_WAVEFORM_ANALYSIS_BYTES, 64 * 1_024 * 1_024);
	for (const clip of fixture.clips) {
		assert.ok(await fixture.service.requestFrequencyWaveform(clip.id, CROSSOVERS));
	}
	assert.equal(fixture.generated(), 12);
	assert.deepEqual([...fixture.resident.keys()], fixture.sources.map(({ id }) => id));
});

test('resident byte budget evicts least-recently-used heavy analyses', async () => {
	const heavySource = { ...SOURCE, frameCount: 7_000_000, channelCount: 2 };
	const blockSizes = frequencyWaveformBlockSizes(heavySource.frameCount, heavySource.channelCount);
	const analysisBytes = frequencyWaveformAnalysisByteLength(
		heavySource.frameCount,
		heavySource.channelCount,
		blockSizes,
	);
	assert.ok(analysisBytes * 2 < FREQUENCY_WAVEFORM_MAX_SOURCE_BYTES);
	assert.ok(analysisBytes * 3 > FREQUENCY_WAVEFORM_MAX_SOURCE_BYTES);
	const fixture = createResidentFixture(4, {
		source: heavySource,
		maximumResidentAnalysisBytes: FREQUENCY_WAVEFORM_MAX_SOURCE_BYTES,
	});

	for (const index of [0, 1, 0, 2]) {
		assert.ok(await fixture.service.requestFrequencyWaveform(fixture.clips[index]!.id, CROSSOVERS));
	}
	assert.deepEqual([...fixture.resident.keys()], ['source-0', 'source-2']);
	assert.equal(fixture.generated(), 3, 'the resident hit refreshes source 0 without regenerating it');
	assert.ok(await fixture.service.requestFrequencyWaveform(fixture.clips[3]!.id, CROSSOVERS));
	assert.deepEqual([...fixture.resident.keys()], ['source-2', 'source-3']);
	assert.equal(fixture.resident.has('source-3'), true, 'the just-published source remains resident');
});

function createResidentFixture(
	sourceCount: number,
	options: Readonly<{
		source?: Readonly<RequiredFrequencyWaveformSource>;
		maximumResidentAnalysisBytes?: number;
	}> = {},
) {
	const baseSource = options.source ?? SOURCE;
	const sources = Array.from({ length: sourceCount }, (_, index) => ({
		...baseSource,
		id: `source-${index}`,
		storageKey: `stored-source-${index}`,
	}));
	const clips = sources.map((source, index) => ({
		id: `clip-${index}`,
		kind: 'audio',
		sourceId: source.id,
	}));
	const project = { id: 'project', clips, sources };
	const resident = new Map();
	let generated = 0;
	const service = createFrequencyWaveformSourceService({
		findClip: (value, id) => value.clips.find((candidate) => candidate.id === id),
		findSource: (value, id) => value.sources.find((candidate) => candidate.id === id),
		getProject: () => project,
		sourceBuffers: new Map(),
		sourceFrequencyAnalyses: resident,
		...(options.maximumResidentAnalysisBytes === undefined ? {} : {
			maximumResidentAnalysisBytes: options.maximumResidentAnalysisBytes,
		}),
		store: {
			async loadAnalysis() { return null; },
			async saveAnalysis() {},
		},
		async generateFromBuffer(_buffer, source) { generated += 1; return analysisForSource(source); },
		async generateFromStore(_store, source) { generated += 1; return analysisForSource(source); },
		publishDocumentSnapshot() {},
	});
	return { service, resident, clips, sources, generated: () => generated };
}

function createFixture(options: Readonly<{
	cached?: FrequencyWaveformAnalysis | null;
	generate?: (
		crossovers: Readonly<{ lowMidHz: number; midHighHz: number }>,
		signal: AbortSignal,
	) => Promise<FrequencyWaveformAnalysis>;
	save?: (
		key: string,
		value: FrequencyWaveformAnalysis,
		saveIndex: number,
	) => Promise<void>;
	delete?: (key: string) => Promise<void>;
}> = {}) {
	let publishes = 0;
	let generated = 0;
	let persisted = options.cached ?? null;
	const analyses = new Map<string, Readonly<{
		projectId: string;
		storageKey: string;
		analysis: FrequencyWaveformAnalysis;
	}>>();
	const loads: string[] = [];
	const saves: Array<{ key: string; value: FrequencyWaveformAnalysis }> = [];
	const deletes: string[] = [];
	const project = { id: 'project', clips: [CLIP], sources: [{ ...SOURCE }] };
	const service = createFrequencyWaveformSourceService({
		findClip: (value, id) => value.clips.find((candidate) => candidate.id === id),
		findSource: (value, id) => value.sources.find((candidate) => candidate.id === id),
		getProject: () => project,
		sourceBuffers: new Map(),
		sourceFrequencyAnalyses: analyses,
		store: {
			async loadAnalysis(key) { loads.push(key); return persisted; },
			async saveAnalysis(key, value) {
				const saveIndex = saves.length;
				saves.push({ key, value });
				await options.save?.(key, value, saveIndex);
				persisted = value;
			},
			async deleteAnalysis(key) {
				deletes.push(key);
				await options.delete?.(key);
				persisted = null;
			},
		},
		async generateFromBuffer(_buffer, _source, crossovers, signal) {
			generated += 1;
			return options.generate ? options.generate(crossovers, signal) : analysis();
		},
		async generateFromStore(_store, _source, crossovers, signal) {
			generated += 1;
			return options.generate ? options.generate(crossovers, signal) : analysis();
		},
		publishDocumentSnapshot() { publishes += 1; },
	});
	return {
		service, analyses, loads, saves, deletes, cached: options.cached,
		persisted: () => persisted,
		replaceSource: (source: typeof SOURCE) => { project.sources[0] = source; },
		generated: () => generated,
		publishes: () => publishes,
	};
}

function analysis(
	crossovers: Readonly<{ lowMidHz: number; midHighHz: number }> = {
		lowMidHz: 250, midHighHz: 4_000,
	},
): FrequencyWaveformAnalysis {
	return analysisForSource(SOURCE, crossovers);
}

function analysisForSource(
	source: Readonly<RequiredFrequencyWaveformSource>,
	crossovers: Readonly<{ lowMidHz: number; midHighHz: number }> = {
		lowMidHz: 250, midHighHz: 4_000,
	},
): FrequencyWaveformAnalysis {
	const visualChannelCount = Math.min(2, source.channelCount);
	return {
		version: FREQUENCY_WAVEFORM_ANALYSIS_VERSION,
		sampleRate: source.sampleRate,
		frameCount: source.frameCount,
		channelCount: source.channelCount,
		visualChannelCount,
		crossovers,
		fftSize: FREQUENCY_WAVEFORM_FFT_SIZE,
		hopSize: FREQUENCY_WAVEFORM_HOP_SIZE,
		levels: frequencyWaveformBlockSizes(source.frameCount, source.channelCount).map((blockSize) => {
			const bucketCount = Math.ceil(source.frameCount / blockSize);
			const bandChannel = () => ({
				minimums: new Float32Array(bucketCount),
				maximums: new Float32Array(bucketCount),
			});
			const bandChannels = () => Array.from({ length: visualChannelCount }, bandChannel);
			return {
				blockSize,
				bands: { low: bandChannels(), mid: bandChannels(), high: bandChannels() },
				centroid: {
					numerators: new Float32Array(bucketCount),
					weights: new Float32Array(bucketCount),
				},
			};
		}),
	};
}
