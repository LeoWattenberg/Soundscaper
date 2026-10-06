/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioAnalysisService, type AnalysisDependencies, type AnalysisState } from '../src/common/editor/controller/analysis/analysis-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createLoudnessMeasurementReport } from '../src/common/editor/loudness-measurement-report.ts';

function fixture(authoritative = true) {
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const activation = new EditorProjectGeneration(); activation.activate('mix');
	const project: ReturnType<AnalysisDependencies['getProject']> = { id: 'mix', revision: 1, clips: [{}], masterChannels: 2 };
	let currentProject = project, identity = {}, sampleRate = 48_000;
	const range = { startFrame: 0, endFrame: 4 }, state: AnalysisState = { lastAnalysisRequest: null };
	let renders = 0, measurements = 0, cancelOnPublish = false;
	const weights: Array<readonly number[] | undefined> = [];
	const dependencies: AnalysisDependencies = {
		lifetime, state,
		copy: { analysisRendering: 'Analysis', analysisCached: 'Cached', contrastAnalyzing: 'Contrast', contrastForegroundRole: 'foreground', contrastBackgroundRole: 'background', contrastStored: 'Stored', done: 'Done', timeSelectionRequired: 'Selection required', contrastRoleInvalid: 'Role', unsupportedAnalysisReport: 'Unsupported', measuringLoudness: 'Measuring', loudnessMeasured: 'Measured' },
		captureProject: () => activation.capture('mix'), assertProject: (token) => activation.assertCurrent(token),
		getProject: () => currentProject, getSelectedTrackId: () => null, getRange: () => range, getActiveSelection: () => range,
		getSpectrumWindowSize: () => 32, getContrastSelections: () => ({ foreground: null, background: null }), setContrastSelections: () => undefined,
		loadAnalysis: async () => null, saveAnalysis: async () => undefined,
		captureLoudnessGeneration: authoritative ? () => ({ generation: identity, sampleRate }) : undefined,
		renderAudio: async () => {
			renders += 1;
			return { sampleRate, numberOfChannels: currentProject.masterChannels ?? 2, length: 4, getChannelData: () => new Float32Array([0.1, -0.1, 0.2, -0.2]) };
		},
		measureLoudnessChannels: async (channels, rate, requestedRange, channelWeights) => {
			measurements += 1; weights.push(channelWeights);
			return structuredClone(createLoudnessMeasurementReport({ measurement: { loudnessValue: -21, maxTruePeakLevel: -3 }, sampleRate: rate, channelCount: channels.length, range: requestedRange, scope: 'selection' }));
		},
		analyzeChannels: async () => ({}), createVisuals: () => null, showAnalysis: () => undefined,
		setProcessing: () => undefined, setStatus: () => undefined, publish: () => { if (cancelOnPublish) lifetime.cancelTask('analysis'); },
		handleError: (error) => { throw error; },
	};
	const service = createAudioAnalysisService(dependencies);
	return { service, state, range, weights, setProject(value: typeof project) { currentProject = value; },
		get project() { return currentProject; }, get renders() { return renders; }, get measurements() { return measurements; },
		setIdentity() { identity = {}; }, setSampleRate(value: number) { sampleRate = value; }, setCancel(value: boolean) { cancelOnPublish = value; },
	};
}

test('an exact immutable mix/range repeat skips both render and measurement with private report ownership', async () => {
	const f = fixture(), first = await f.service.measureLoudness(); assert.ok(first);
	Reflect.set(first.subject, 'sampleRate', 1);
	const second = await f.service.measureLoudness(); assert.ok(second);
	assert.equal(second.subject.sampleRate, 48_000); assert.notStrictEqual(first, second);
	assert.equal(f.renders, 1); assert.equal(f.measurements, 1); assert.strictEqual(f.state.deliveryReport, second);
});

test('loudness cache admission includes revision, immutable generation, selection, sample rate, master width and ADM weights', async () => {
	const f = fixture();
	await f.service.measureLoudness(); await f.service.measureLoudness(); assert.equal(f.renders, 1);
	f.setProject({ ...f.project, revision: 2 }); await f.service.measureLoudness(); assert.equal(f.renders, 2);
	f.setIdentity(); await f.service.measureLoudness(); assert.equal(f.renders, 3);
	f.range.startFrame = 1; await f.service.measureLoudness(); assert.equal(f.renders, 4);
	f.setSampleRate(44_100); await f.service.measureLoudness(); assert.equal(f.renders, 5);
	f.setProject({ ...f.project, masterChannels: 8 }); await f.service.measureLoudness(); assert.equal(f.renders, 6);
	f.setProject({ ...f.project, metadata: { adm: { mode: 'authored', programme: { name: 'Programme', language: '' }, content: { name: 'Content', language: '' }, bed: { name: 'Bed', layout: '7.1', assignments: [] } } } });
	await f.service.measureLoudness(); assert.equal(f.renders, 7); assert.equal(f.weights.at(-1)?.[3], 0);
	await f.service.measureLoudness(); assert.equal(f.renders, 7);
	f.setProject({ ...f.project, masterChannels: 9 });
	await assert.rejects(f.service.measureLoudness(), /at most 8 channels/iu); assert.equal(f.renders, 7);
});

test('public mutable inputs remain uncached and cancellation cannot publish a cached report', async () => {
	const publicInput = fixture(false);
	await publicInput.service.measureLoudness(); await publicInput.service.measureLoudness(); assert.equal(publicInput.renders, 2);
	const f = fixture(), first = await f.service.measureLoudness(); assert.ok(first);
	f.state.deliveryReport = null; f.setCancel(true);
	assert.equal(await f.service.measureLoudness(), null); assert.equal(f.state.deliveryReport, null); assert.equal(f.renders, 1);
	f.setCancel(false); await f.service.measureLoudness(); assert.equal(f.renders, 2);
});
