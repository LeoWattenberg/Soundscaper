/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioAnalysisService, type AnalysisDependencies } from '../src/common/editor/controller/analysis/analysis-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';

for (const cached of [{ result: 'corrupt' }, { result: [] }, { result: true }]) {
	test(`analysis recomputes an invalid cached result: ${JSON.stringify(cached)}`, async () => {
		const fixture = createFixture(cached);
		assert.deepEqual(await fixture.service.run(), { rmsDbfs: -12 });
		assert.equal(fixture.renders(), 1);
		assert.equal(fixture.saved.length, 1);
	});
}

test('valid cached analysis keeps its result and skips rendering', async () => {
	const result = { rmsDbfs: -24 };
	const fixture = createFixture({ result, visuals: null, report: null });
	assert.equal(await fixture.service.run(), result);
	assert.equal(fixture.renders(), 0);
	assert.equal(fixture.saved.length, 0);
});

test('track analysis renders the track captured for its cache key while selection changes', async () => {
	let selectedTrackId = 'track-a';
	let releaseLookup!: () => void;
	const lookup = new Promise<void>((resolve) => { releaseLookup = resolve; });
	const renderedTracks: Array<string | null | undefined> = [];
	const keys: string[] = [];
	const fixture = createFixture(null);
	const dependencies = {
		...fixture.dependencies,
		getSelectedTrackId: () => selectedTrackId,
		loadAnalysis: async (key: string) => { keys.push(key); await lookup; return null; },
		renderAudio: async (_scope: string, _range: unknown, _signal: AbortSignal, trackId?: string | null) => {
			renderedTracks.push(trackId);
			return { sampleRate: 48_000, numberOfChannels: 1, length: 4, getChannelData: () => new Float32Array(4) };
		},
	} satisfies AnalysisDependencies;
	const service = createAudioAnalysisService(dependencies);
	const pending = service.run('track');
	selectedTrackId = 'track-b';
	releaseLookup();
	assert.deepEqual(await pending, { rmsDbfs: -12 });
	assert.deepEqual(renderedTracks, ['track-a']);
	assert.match(keys[0]!, /:track:track-a:0:4$/u);
});

test('analysis does not render or publish a cache entry after the project revision changes', async () => {
	let revision = 1;
	let releaseLookup!: () => void;
	const lookup = new Promise<void>((resolve) => { releaseLookup = resolve; });
	const fixture = createFixture(null);
	const service = createAudioAnalysisService({
		...fixture.dependencies,
		getProject: () => ({ id: 'analysis-project', revision, clips: [{}] }),
		loadAnalysis: async () => { await lookup; return null; },
	});
	const pending = service.run('track');
	revision = 2;
	releaseLookup();
	assert.equal(await pending, null);
	assert.equal(fixture.renders(), 0);
	assert.deepEqual(fixture.saved, []);
});

function createFixture(cached: unknown) {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const generation = new EditorProjectGeneration();
	generation.activate('analysis-project');
	let renders = 0;
	const saved: unknown[] = [];
	const dependencies = {
		lifetime, state: { lastAnalysisRequest: null },
		copy: {
			analysisRendering: 'Analyzing', analysisCached: 'Cached', contrastAnalyzing: 'Contrast',
			contrastForegroundRole: 'foreground', contrastBackgroundRole: 'background', contrastStored: '{role}',
			done: 'Done', timeSelectionRequired: 'Select time', contrastRoleInvalid: 'Invalid role',
			unsupportedAnalysisReport: 'Unsupported', measuringLoudness: 'Measuring', loudnessMeasured: 'Measured',
		},
		captureProject: () => generation.capture('analysis-project'),
		assertProject: (token: ReturnType<EditorProjectGeneration['capture']>) => generation.assertCurrent(token),
		getProject: () => ({ id: 'analysis-project', revision: 1, clips: [{}] }),
		getSelectedTrackId: () => null,
		getRange: () => ({ startFrame: 0, endFrame: 4 }),
		getActiveSelection: () => null, getSpectrumWindowSize: () => 32,
		getContrastSelections: () => ({ foreground: null, background: null }), setContrastSelections() {},
		loadAnalysis: async () => cached,
		saveAnalysis: async (_key: string, value: unknown) => { saved.push(value); },
		renderAudio: async () => {
			renders += 1;
			return { sampleRate: 48_000, numberOfChannels: 1, length: 4, getChannelData: () => new Float32Array(4) };
		},
		analyzeChannels: async () => ({ rmsDbfs: -12 }), createVisuals: () => null,
		showAnalysis() {}, setProcessing() {}, setStatus() {}, publish() {},
		handleError(error: unknown) { throw error; },
	} satisfies AnalysisDependencies;
	const service = createAudioAnalysisService(dependencies);
	return { service, dependencies, saved, renders: () => renders };
}

test('computed levels are published before their cache write completes', async () => {
	const f = createFixture(null);
	let release!: () => void;
	let shown = false;
	const saved = new Promise<void>(resolve => { release = resolve; });
	const service = createAudioAnalysisService({ ...f.dependencies,
		showAnalysis: () => { shown = true; }, saveAnalysis: async () => saved,
	});
	const pending = service.run();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(shown, true);
	release();
	assert.deepEqual(await pending, { rmsDbfs: -12 });
});

test('specialized reports appear before generic meters and repeated reports reuse complete cached results', async () => {
	const f = createFixture(null);
	let release!: (result: Record<string, unknown>) => void;
	const meters = new Promise<Record<string, unknown>>(resolve => { release = resolve; });
	const shown: unknown[][] = [];
	let reportJobs = 0;
	const report = Object.freeze({ type: 'spectrum', size: 32 });
	const service = createAudioAnalysisService({ ...f.dependencies,
		analyzeChannels: async () => meters,
		createSpecializedReport: async () => { reportJobs++; return report; },
		showAnalysis: (...args) => { shown.push(args); },
	});
	const pending = service.plotSpectrum();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(shown.length, 1);
	assert.equal(shown[0]?.[0], null, 'partial publication clears previous meters');
	assert.equal(shown[0]?.[2], report);
	release({ rmsDbfs: -12 });
	await pending;
	assert.equal(shown.at(-1)?.[0] && (shown.at(-1)?.[0] as Record<string, unknown>).rmsDbfs, -12);
	await service.plotSpectrum();
	assert.equal(reportJobs, 1);
	assert.equal(f.renders(), 1);
});

for (const cachedLevels of [false, true]) {
	test(`complete analysis publication releases busy state in the same batch (cached levels: ${cachedLevels})`, async () => {
		const f = createFixture(cachedLevels ? { result: { rmsDbfs: -24 } } : null);
		let batch = 0; let nextBatch = 0;
		const observed: Array<{ kind: string; batch: number }> = [];
		const service = createAudioAnalysisService({ ...f.dependencies,
			batchPresentation(operation) {
				const prior = batch; batch = ++nextBatch;
				try { operation(); } finally { batch = prior; }
			},
			createSpecializedReport: async () => ({ type: 'spectrum', size: 32 }),
			showAnalysis: () => { observed.push({ kind: 'show', batch }); },
			setStatus: (_status, status) => { if (status === 'success') observed.push({ kind: 'success', batch }); },
			setProcessing: processing => { if (!processing) observed.push({ kind: 'idle', batch }); },
		});
		if (cachedLevels) await service.run(); else await service.plotSpectrum();
		const completion = observed.slice(-3);
		assert.deepEqual(completion.map(value => value.kind), ['show', 'success', 'idle']);
		assert.ok(completion[0]!.batch > 0);
		assert.equal(new Set(completion.map(value => value.batch)).size, 1);
		assert.equal(observed.filter(value => value.kind === 'idle').length, 1);
	});
}
