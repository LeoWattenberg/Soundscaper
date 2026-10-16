/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioAnalysisService, type AnalysisDependencies, type AnalysisState } from '../src/common/editor/controller/analysis/analysis-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { calculateAudioAnalysisReport } from '../src/common/editor/audio-analysis-report-worker-runtime.ts';
import { analyzeAudioChannels } from '../src/common/editor/analysis.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { COPY_BY_LOCALE, ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { localizedErrorMessage } from '../src/common/i18n/presentation-message.ts';

function fixture(frames: number, delegated: boolean, copy = ENGLISH_COPY) {
	const sampleRate = 48_000;
	const channels = Array.from({ length: 2 }, () => Float32Array.from({ length: frames },
		(_, frame) => 0.5 * Math.sin(2 * Math.PI * 750 * frame / sampleRate)));
	const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Recording',
		sampleRate, channelCount: 2, frameCount: frames });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, title: 'Recording',
		timelineStartFrame: 0, durationFrames: frames, sourceStartFrame: 0, sourceDurationFrames: frames });
	const project = createSoundscaperProject({ id: 'spectrum', title: 'Spectrum', now: '2026-10-09T00:00:00.000Z',
		sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'track', name: 'Recording', clipIds: [clip.id] })] });
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const generation = new EditorProjectGeneration(); generation.activate(project.id);
	const state: AnalysisState = { lastAnalysisRequest: { type: 'levels', scope: 'master' } };
	const errors: unknown[] = [];
	const shown: unknown[] = [];
	const processing: boolean[] = [];
	let analyses = 0;
	let reportJobs = 0;
	const range = { startFrame: 0, endFrame: frames };
	const dependencies: AnalysisDependencies = {
		lifetime, state, copy,
		captureProject: () => generation.capture(project.id), assertProject: token => generation.assertCurrent(token),
		getProject: () => project, getSelectedTrackId: () => 'track', getRange: () => range,
		getActiveSelection: () => range, getSpectrumWindowSize: () => 2048,
		getContrastSelections: () => ({ foreground: null, background: null }), setContrastSelections() {},
		loadAnalysis: async () => null, saveAnalysis: async () => undefined,
		renderAudio: async () => ({ sampleRate, numberOfChannels: channels.length, length: frames,
			getChannelData: channel => channels[channel]! }),
		analyzeChannels: async () => { analyses++; return analyzeAudioChannels(channels, sampleRate); },
		createVisuals: () => null,
		...(delegated ? { createSpecializedReport: async (kind, scope, requestedRange, input, rate, options) => {
			reportJobs++;
			return calculateAudioAnalysisReport({ kind, scope, range: requestedRange, channels: input, sampleRate: rate, options });
		} } satisfies Pick<AnalysisDependencies, 'createSpecializedReport'> : {}),
		showAnalysis: (_result, _visuals, report) => { shown.push(report); },
		setProcessing: value => { processing.push(value); }, setStatus() {}, publish() {},
		handleError: error => { errors.push(error); },
	};
	return { service: createAudioAnalysisService(dependencies), state, errors, shown, processing,
		analyses: () => analyses, reportJobs: () => reportJobs };
}

for (const delegated of [false, true]) {
	test(`short Plot Spectrum refuses its incomplete window before ${delegated ? 'worker' : 'fallback'} publication`, async () => {
		const f = fixture(480, delegated);
		assert.equal(await f.service.plotSpectrum(), null);
		assert.deepEqual(f.shown, []);
		assert.equal(f.analyses(), 0);
		assert.equal(f.reportJobs(), 0);
		assert.deepEqual(f.processing, [true, false]);
		assert.deepEqual(f.state.lastAnalysisRequest, { type: 'levels', scope: 'master' });
		assert.equal(f.errors.length, 1);
		assert.ok(f.errors[0] instanceof RangeError);
		assert.match(f.errors[0].message, /at least 2048 samples/u);
		assert.deepEqual(localizedErrorMessage(f.errors[0]), { key: 'spectrumSelectionTooShort', parameters: { samples: 2048 } });
	});

	test(`one full Plot Spectrum window keeps its exact calibration and repeat through ${delegated ? 'worker' : 'fallback'}`, async () => {
		const f = fixture(2048, delegated);
		const report = await f.service.plotSpectrum();
		assert.ok(report && typeof report === 'object' && 'peak' in report);
		const peak = report.peak as { frequency: number; db: number };
		assert.equal(peak.frequency, 750);
		assert.ok(Math.abs(peak.db - 20 * Math.log10(0.5)) < 0.001);
		assert.deepEqual(f.errors, []);
		assert.deepEqual(f.state.lastAnalysisRequest, { type: 'spectrum', scope: 'master', options: {} });
		assert.deepEqual(await f.service.repeatLast(), report);
		assert.equal(f.analyses(), 1, 'successful repeat retains its existing cache');
	});
}

test('short levels and clipping reports retain their ordinary valid analysis paths', async () => {
	const f = fixture(480, true);
	assert.ok(await f.service.run());
	assert.ok(await f.service.findClipping());
	assert.deepEqual(f.errors, []);
	assert.equal(f.analyses(), 2);
	assert.equal(f.reportJobs(), 1);
	assert.deepEqual(f.state.lastAnalysisRequest, { type: 'clipping', scope: 'master', options: {} });
});

test('short Plot Spectrum publishes the same sample requirement in German', async () => {
	const f = fixture(480, true, COPY_BY_LOCALE.de);
	assert.equal(await f.service.plotSpectrum(), null);
	assert.ok(f.errors[0] instanceof RangeError);
	assert.match(f.errors[0].message, /mindestens 2048 Samples/u);
	assert.equal(f.shown.length, 0);
});
