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
