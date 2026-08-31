/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAudioAnalysisService,
	type AnalysisRange,
	type AnalysisState,
} from '../src/common/editor/controller/analysis-service.ts';
import {
	EditorControllerLifetime,
	EditorProjectGeneration,
	type EditorProjectToken,
} from '../src/common/editor/controller/lifecycle.ts';
import {
	createLoudnessMeasurementReport,
	loudnessMeasurementScope,
} from '../src/common/editor/loudness-measurement-report.ts';

const SAMPLE_RATE = 48_000;

const COPY = {
	analysisRendering: 'Analyzing', analysisCached: 'Cached', contrastAnalyzing: 'Contrast',
	contrastForegroundRole: 'foreground', contrastBackgroundRole: 'background', contrastStored: '{role}',
	done: 'Done', timeSelectionRequired: 'Select time', contrastRoleInvalid: 'Invalid role',
	unsupportedAnalysisReport: 'Unsupported',
	measuringLoudness: 'Measuring loudness', loudnessMeasured: 'Loudness measured',
};

function tone(amplitude: number, seconds = 3): Float32Array {
	const frames = Math.round(SAMPLE_RATE * seconds);
	const channel = new Float32Array(frames);
	for (let index = 0; index < frames; index += 1) {
		channel[index] = amplitude * Math.sin(2 * Math.PI * 1_000 * index / SAMPLE_RATE);
	}
	return channel;
}

function service(overrides: Record<string, unknown> = {}, amplitude = 0.1) {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate('loudness-project');
	const state: AnalysisState = { lastAnalysisRequest: null };
	const renders: Array<{ scope: string; startFrame: number; endFrame: number }> = [];
	const processing: boolean[] = [];
	const statuses: string[] = [];
	const channels = [tone(amplitude), tone(amplitude)];
	const created = createAudioAnalysisService({
		lifetime,
		state,
		copy: COPY,
		captureProject: () => projectGeneration.capture('loudness-project'),
		assertProject: (token: EditorProjectToken) => projectGeneration.assertCurrent(token),
		getProject: () => ({ id: 'loudness-project', revision: 1, clips: [{}] }),
		getSelectedTrackId: () => null,
		getRange: () => ({ startFrame: 0, endFrame: channels[0].length }),
		getActiveSelection: () => null,
		getSpectrumWindowSize: () => 32,
		getContrastSelections: () => ({ foreground: null, background: null }),
		setContrastSelections: () => undefined,
		loadAnalysis: async () => null,
		saveAnalysis: async () => undefined,
		renderAudio: async (scope: string, range: AnalysisRange) => {
			renders.push({ scope, startFrame: range.startFrame, endFrame: range.endFrame });
			return {
				sampleRate: SAMPLE_RATE,
				numberOfChannels: channels.length,
				length: channels[0].length,
				getChannelData: (channel: number) => channels[channel],
			};
		},
		analyzeChannels: async () => ({}),
		createVisuals: () => null,
		showAnalysis: () => undefined,
		setProcessing: (value: boolean) => { processing.push(value); },
		setStatus: (message: string) => { statuses.push(message); },
		publish: () => undefined,
		handleError: (error: unknown) => { throw error; },
		...overrides,
	} as never);
	return { service: created, state, renders, processing, statuses };
}

test('measuring the mix reports its loudness in the delivery report vocabulary', async () => {
	const harness = service();
	const report = await harness.service.measureLoudness();
	assert.ok(report);

	assert.equal(report.subject.format, 'loudness-measurement', 'nothing may mistake this for a delivery');
	assert.equal(report.subject.sampleRate, SAMPLE_RATE);
	assert.equal(report.subject.channelCount, 2);

	const measured = report.items.find(({ code }) => code === 'delivery.loudness-measured');
	assert.ok(measured, 'the answer is stated in the same vocabulary a delivery uses');
	assert.equal(measured.disposition, 'preserved', 'measuring changes nothing');
	assert.ok(typeof measured.data.measuredLoudnessLufs === 'number');
	assert.ok(typeof measured.data.measuredTruePeakDb === 'number');
	assert.equal(measured.data.gainDb, 0, 'and it must never propose a gain');
});

test('the measurement renders the master through the shared analysis path', async () => {
	// Not a second render path: the numbers have to describe the mix a delivery
	// would render, so this consumes the render the other analyzers use.
	const harness = service();
	await harness.service.measureLoudness();
	assert.deepEqual(harness.renders, [{ scope: 'master', startFrame: 0, endFrame: SAMPLE_RATE * 3 }]);
});

test('the report reaches the surface an operator already reads, and releases the busy state', async () => {
	const harness = service();
	const report = await harness.service.measureLoudness();
	assert.equal(harness.state.deliveryReport, report);
	assert.deepEqual(harness.processing, [true, false]);
	assert.deepEqual(harness.statuses, ['Measuring loudness', 'Loudness measured']);
});

test('an empty project is not measured at all', async () => {
	const harness = service({ getProject: () => ({ id: 'loudness-project', revision: 1, clips: [] }) });
	assert.equal(await harness.service.measureLoudness(), null);
	assert.deepEqual(harness.renders, [], 'and nothing is rendered for it');
	assert.deepEqual(harness.processing, []);
});

test('a failed render releases the busy state instead of wedging the editor', async () => {
	const harness = service({ renderAudio: async () => { throw new Error('render failed'); } });
	await assert.rejects(() => harness.service.measureLoudness(), /render failed/u);
	assert.deepEqual(harness.processing, [true, false]);
	assert.equal(harness.state.deliveryReport, undefined, 'and no half-formed report is published');
});

test('silence is reported as unmeasurable rather than as a loudness of null', async () => {
	// A null where a number belongs reads as a value. It is not one.
	const harness = service({}, 0);
	const report = await harness.service.measureLoudness();
	const item = report!.items.find(({ code }) => code === 'delivery.loudness-unmeasurable');
	assert.ok(item, 'silence has no integrated loudness, and the report says so');
	assert.equal(item.severity, 'warning');
	assert.equal(
		report!.items.some(({ code }) => code === 'delivery.loudness-measured'),
		false,
		'and it does not also claim a measurement',
	);
});

test('authored 7.1 measurement excludes the semantic LFE channel', async () => {
	const silence = new Float32Array(SAMPLE_RATE * 3);
	const lfe = tone(0.1);
	const channels = Array.from({ length: 8 }, (_value, channel) => channel === 3 ? lfe : silence);
	const harness = service({
		getProject: () => ({
			id: 'loudness-project', revision: 1, clips: [{}], masterChannels: 8,
			metadata: { adm: authoredSevenPointOneAdm() },
		}),
		getRange: () => ({ startFrame: 0, endFrame: channels[0].length }),
		renderAudio: async () => ({
			sampleRate: SAMPLE_RATE,
			numberOfChannels: channels.length,
			length: channels[0].length,
			getChannelData: (channel: number) => channels[channel],
		}),
	});

	const report = await harness.service.measureLoudness();
	assert.ok(report?.items.some(({ code }) => code === 'delivery.loudness-unmeasurable'));
	assert.equal(report?.items.some(({ code }) => code === 'delivery.loudness-measured'), false);
});

test('the scope is the selection when there is one, and an empty selection is not one', () => {
	assert.equal(loudnessMeasurementScope({ startFrame: 10, endFrame: 20 }), 'selection');
	assert.equal(loudnessMeasurementScope(null), 'project');
	assert.equal(loudnessMeasurementScope(undefined), 'project');
	// A stray click that collapsed the selection must not measure nothing.
	assert.equal(loudnessMeasurementScope({ startFrame: 10, endFrame: 10 }), 'project');
});

test('the report says what was measured, because the number means nothing without it', () => {
	const measurement = { loudnessValue: -21.4, maxTruePeakLevel: -3.2 };
	const whole = createLoudnessMeasurementReport({
		measurement, sampleRate: SAMPLE_RATE, channelCount: 2,
		range: { startFrame: 0, endFrame: 480_000 }, scope: 'project',
	});
	const wholeRange = whole.items.find(({ code }) => code === 'loudness.measured-range');
	assert.equal(wholeRange?.data.scope, 'project');
	assert.equal(wholeRange?.data.durationFrames, 480_000);

	const part = createLoudnessMeasurementReport({
		measurement, sampleRate: SAMPLE_RATE, channelCount: 2,
		range: { startFrame: 24_000, endFrame: 96_000 }, scope: 'selection',
	});
	const partRange = part.items.find(({ code }) => code === 'loudness.measured-range');
	assert.equal(partRange?.data.scope, 'selection');
	assert.equal(partRange?.data.durationFrames, 72_000);
	assert.match(partRange!.message!, /rest of the project was not/u);

	for (const report of [whole, part]) {
		for (const disposition of ['preserved', 'converted', 'missing', 'omitted'] as const) {
			assert.equal(
				report.counts[disposition],
				report.items.filter((item) => item.disposition === disposition).length,
				`${disposition} count must match its items`,
			);
		}
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
