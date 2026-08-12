/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioAnalysisService, type AnalysisState } from '../src/common/editor/controller/analysis-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';

test('repeat analyzer replays the last successful analysis request', async () => {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate('analysis-project');
	const state: AnalysisState = { lastAnalysisRequest: null };
	let renders = 0;
	const reports: unknown[] = [];
	const service = createAudioAnalysisService({
		lifetime,
		state,
		copy: {
			analysisRendering: 'Analyzing', analysisCached: 'Cached', contrastAnalyzing: 'Contrast',
			contrastForegroundRole: 'foreground', contrastBackgroundRole: 'background', contrastStored: '{role}',
			done: 'Done', timeSelectionRequired: 'Select time', contrastRoleInvalid: 'Invalid role', unsupportedAnalysisReport: 'Unsupported',
		},
		captureProject: () => projectGeneration.capture('analysis-project'),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		getProject: () => ({ id: 'analysis-project', revision: 1, clips: [{}] }),
		getSelectedTrackId: () => 'track-1',
		getRange: () => ({ startFrame: 0, endFrame: 4 }),
		getActiveSelection: () => ({ startFrame: 0, endFrame: 4 }),
		getSpectrumWindowSize: () => 32,
		getContrastSelections: () => ({ foreground: null, background: null }),
		setContrastSelections: () => undefined,
		loadAnalysis: async () => null,
		saveAnalysis: async () => undefined,
		renderAudio: async () => {
			renders += 1;
			return { sampleRate: 48_000, numberOfChannels: 1, length: 4, getChannelData: () => new Float32Array([0, 0.25, -0.25, 0]) };
		},
		analyzeChannels: async () => ({ rmsDbfs: -12 }),
		createVisuals: () => null,
		showAnalysis: (_result, _visuals, report) => { reports.push(report); },
		setProcessing: () => undefined,
		setStatus: () => undefined,
		publish: () => undefined,
		handleError: (error) => { throw error; },
	});

	assert.equal(await service.repeatLast(), null);
	await service.run('track');
	await service.repeatLast();
	assert.equal(renders, 2);
	assert.deepEqual(reports, [
		{ type: 'levels', scope: 'track', startFrame: 0, endFrame: 4 },
		{ type: 'levels', scope: 'track', startFrame: 0, endFrame: 4 },
	]);
});
