/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioAnalysisService, type AnalysisDependencies } from '../src/common/editor/controller/analysis-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';

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
	return { service, saved, renders: () => renders };
}
