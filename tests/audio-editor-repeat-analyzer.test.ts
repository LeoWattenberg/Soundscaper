/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioAnalysisService, type AnalysisState } from '../src/common/editor/controller/analysis-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';
import { resolveAdmEbuChannelWeights } from '../src/common/editor/loudness-channel-layout.ts';

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
			measuringLoudness: 'Measuring loudness', loudnessMeasured: 'Loudness measured',
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

test('levels analysis uses the authored 7.1 channel semantics', async () => {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate('analysis-project');
	let channelWeights: readonly number[] | undefined;
	let cacheKey = '';
	const adm = authoredSevenPointOneAdm();
	const service = createAudioAnalysisService({
		lifetime,
		state: { lastAnalysisRequest: null },
		copy: {
			analysisRendering: 'Analyzing', analysisCached: 'Cached', contrastAnalyzing: 'Contrast',
			contrastForegroundRole: 'foreground', contrastBackgroundRole: 'background', contrastStored: '{role}',
			done: 'Done', timeSelectionRequired: 'Select time', contrastRoleInvalid: 'Invalid role', unsupportedAnalysisReport: 'Unsupported',
			measuringLoudness: 'Measuring loudness', loudnessMeasured: 'Loudness measured',
		},
		captureProject: () => projectGeneration.capture('analysis-project'),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		getProject: () => ({
			id: 'analysis-project', revision: 1, clips: [{}],
			metadata: { adm },
		}),
		getSelectedTrackId: () => null,
		getRange: () => ({ startFrame: 0, endFrame: 4 }),
		getActiveSelection: () => null,
		getSpectrumWindowSize: () => 32,
		getContrastSelections: () => ({ foreground: null, background: null }),
		setContrastSelections: () => undefined,
		loadAnalysis: async (key) => {
			cacheKey = key;
			return null;
		},
		saveAnalysis: async () => undefined,
		renderAudio: async () => ({
			sampleRate: 48_000,
			numberOfChannels: 8,
			length: 4,
			getChannelData: () => new Float32Array(4),
		}),
		analyzeChannels: async (_channels, _sampleRate, _signal, options) => {
			channelWeights = options?.channelWeights;
			return { rmsDbfs: -120 };
		},
		createVisuals: () => null,
		showAnalysis: () => undefined,
		setProcessing: () => undefined,
		setStatus: () => undefined,
		publish: () => undefined,
		handleError: (error) => { throw error; },
	});

	await service.run('master');
	assert.match(cacheKey, /^audio-editor-analysis-v2:/u);
	assert.deepEqual(channelWeights, resolveAdmEbuChannelWeights(adm, 8));
});

test('immersive analyzer commands refuse before rendering an unsupported loudness width', async () => {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate('immersive-analysis-project');
	let renders = 0;
	let cacheReads = 0;
	const errors: unknown[] = [];
	const service = createAudioAnalysisService({
		lifetime,
		state: { lastAnalysisRequest: { type: 'levels', scope: 'master' } },
		copy: {
			analysisRendering: 'Analyzing', analysisCached: 'Cached', contrastAnalyzing: 'Contrast',
			contrastForegroundRole: 'foreground', contrastBackgroundRole: 'background', contrastStored: '{role}',
			done: 'Done', timeSelectionRequired: 'Select time', contrastRoleInvalid: 'Invalid role', unsupportedAnalysisReport: 'Unsupported',
			measuringLoudness: 'Measuring loudness', loudnessMeasured: 'Loudness measured',
		},
		captureProject: () => projectGeneration.capture('immersive-analysis-project'),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		getProject: () => ({
			id: 'immersive-analysis-project', revision: 1, clips: [{}], masterChannels: 9,
		}),
		getSelectedTrackId: () => 'track-1',
		getRange: () => ({ startFrame: 0, endFrame: 4 }),
		getActiveSelection: () => ({ startFrame: 0, endFrame: 4 }),
		getSpectrumWindowSize: () => 32,
		getContrastSelections: () => ({ foreground: null, background: null }),
		setContrastSelections: () => undefined,
		loadAnalysis: async () => { cacheReads += 1; return null; },
		saveAnalysis: async () => undefined,
		renderAudio: async () => {
			renders += 1;
			return {
				sampleRate: 48_000, numberOfChannels: 9, length: 4,
				getChannelData: () => new Float32Array(4),
			};
		},
		analyzeChannels: async () => ({ rmsDbfs: -120 }),
		createVisuals: () => null,
		showAnalysis: () => undefined,
		setProcessing: () => undefined,
		setStatus: () => undefined,
		publish: () => undefined,
		handleError: (error) => { errors.push(error); },
	});

	assert.equal(await service.run('master'), null);
	assert.equal(await service.plotSpectrum('master'), null);
	assert.equal(await service.findClipping('master'), null);
	assert.equal(await service.captureContrast('foreground', 'master'), null);
	assert.equal(await service.measureLoudness(), null);
	assert.equal(await service.repeatLast(), null);
	assert.equal(renders, 0, 'unsupported analysis must fail before paying for an offline render');
	assert.equal(cacheReads, 0, 'a cache cannot bypass the current channel admission');
	assert.equal(errors.length, 6);
	for (const error of errors) {
		assert.match(String(error), /analysis supports at most 8 channels.*downmix/iu);
	}
});

function authoredSevenPointOneAdm() {
	return {
		mode: 'authored' as const,
		programme: { name: 'Programme', language: '' },
		content: { name: 'Content', language: '' },
		bed: { name: 'Bed', layout: '7.1' as const, assignments: [] },
	};
}
