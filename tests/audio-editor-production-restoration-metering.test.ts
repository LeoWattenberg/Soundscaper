/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	RESTORATION_TOOL_CATALOG,
	RESTORATION_WORKFLOW_POLICY,
	compileRestorationWorkflowPlan,
	normalizeRestorationWorkflow,
} from '../src/common/editor/production-audio/restoration-workflow.ts';
import {
	METER_SESSION_POLICY,
	createSessionStripMeterStore,
} from '../src/common/editor/production-audio/strip-meter-session.ts';
import {
	createSessionLoudnessHistory,
} from '../src/common/editor/production-audio/loudness-history-session.ts';
import {
	createStripAnalysisScheduler,
} from '../src/common/editor/production-audio/strip-analysis-scheduler.ts';
import {
	resetProductionMeterSessionV21,
	sampleProductionMeterSessionV21,
} from '../src/common/editor/engine/production-meter-runtime-session-v21.ts';
import type { StripMeterAnalyserBankV21 } from '../src/common/editor/engine/strip-meter-analyser-bank-v21.ts';
import type { StripRef } from '../src/common/editor/parameter-address.ts';

const track = (id: string): StripRef => ({ kind: 'track', id });

test('restoration maps one bounded atomic workflow onto maintained Audacity processors', () => {
	assert.deepEqual(
		RESTORATION_TOOL_CATALOG.map(({ id, processorId }) => [id, processorId]),
		[
			['click-removal', 'audacity-click-removal'],
			['noise-reduction', 'audacity-noise-reduction'],
			['filter-curve-eq', 'audacity-filter-curve-eq'],
			['clip-fix', 'nyquist:clipfix'],
		],
	);
	const request = {
		target: 'selection',
		stages: [
			{
				id: 'clicks', tool: 'click-removal', enabled: true,
				params: { threshold: 249.6, maximumWidth: 17.6 },
			},
			{
				id: 'noise', tool: 'noise-reduction', enabled: true,
				params: { reductionDb: 12, sensitivity: 6, frequencySmoothingBands: 4, output: 'reduce' },
			},
			{
				id: 'tone', tool: 'filter-curve-eq', enabled: false,
				params: {
					points: [{ frequency: 80, gain: -12 }, { frequency: 12_000, gain: -2 }],
					linearFrequencyScale: false,
					filterLength: 4_095,
				},
			},
			{
				id: 'clipping', tool: 'clip-fix', enabled: true,
				params: { thresholdPercent: 94, gainDb: -6 },
			},
		],
	};
	const workflow = normalizeRestorationWorkflow(request);
	assert.notEqual(workflow, request);
	assert.equal(workflow.stages[0]?.params.threshold, 250);
	assert.equal(workflow.stages[0]?.params.maximumWidth, 18);
	assert.ok(Object.isFrozen(workflow));
	assert.ok(Object.isFrozen(workflow.stages[2]?.params.points));

	const plan = compileRestorationWorkflowPlan(workflow);
	assert.equal(plan.historyMode, 'single-transaction');
	assert.deepEqual(plan.operations.map((operation) => operation.processorId), [
		'audacity-click-removal',
		'audacity-noise-reduction',
		'nyquist:clipfix',
	]);
	assert.equal(plan.operations[1]?.requiresNoiseProfile, true);
	assert.deepEqual(plan.operations[2]?.params, { THRESHOLD: 94, GAIN: -6 });
	assert.deepEqual(RESTORATION_WORKFLOW_POLICY.projectFields, []);
	assert.deepEqual(RESTORATION_WORKFLOW_POLICY.exportTransforms, []);
});

test('restoration rejects duplicate, unbounded, unsupported, and hostile requests without invoking accessors', () => {
	const stage = { id: 'one', tool: 'click-removal', enabled: true, params: {} };
	assert.throws(() => normalizeRestorationWorkflow({
		target: 'selection', stages: [stage, stage],
	}), /unique/iu);
	assert.throws(() => normalizeRestorationWorkflow({
		target: 'selection', stages: Array.from({ length: 17 }, (_, index) => ({
			...stage, id: `stage-${String(index)}`,
		})),
	}), /through 16/iu);
	assert.throws(() => normalizeRestorationWorkflow({
		target: 'selection', stages: [{ ...stage, tool: 'de-hum' }],
	}), /supported restoration tool/iu);
	assert.throws(() => normalizeRestorationWorkflow({
		target: 'rack', stages: [{ ...stage, tool: 'clip-fix' }],
	}), /selection only/iu);
	assert.throws(() => normalizeRestorationWorkflow({
		target: 'selection', stages: [{
			...stage,
			params: { threshold: 901 },
		}],
	}), /between 0 and 900/iu);
	assert.throws(() => normalizeRestorationWorkflow({
		target: 'selection', stages: [{
			...stage,
			tool: 'filter-curve-eq',
			params: { points: Array.from({ length: 129 }, (_, index) => ({ frequency: index + 1, gain: 0 })) },
		}],
	}), /through 128/iu);

	let reads = 0;
	const hostile = Object.create(null) as Record<string, unknown>;
	Object.defineProperty(hostile, 'target', {
		enumerable: true,
		get() { reads += 1; return 'selection'; },
	});
	Object.defineProperty(hostile, 'stages', { enumerable: true, value: [] });
	assert.throws(() => normalizeRestorationWorkflow(hostile), /data property/iu);
	assert.equal(reads, 0);
});

test('per-strip session meters report mono, stereo phase references, and declared surround geometry', () => {
	const meters = createSessionStripMeterStore({ maximumStrips: 8, maximumFramesPerUpdate: 16 });
	let snapshot = meters.update(track('mono'), {
		channels: [Float32Array.of(0.25, -0.5, 0.25, -0.5)],
		channelLabels: ['M'],
	});
	assert.equal(snapshot.channelCount, 1);
	assert.equal(snapshot.correlation, null);
	assert.equal(snapshot.phaseDegrees, null);
	assert.deepEqual(snapshot.channels.map(({ label, peak }) => [label, peak]), [['M', 0.5]]);

	const left = Float32Array.of(1, 0, -1, 0);
	snapshot = meters.update(track('in-phase'), { channels: [left, left.slice()], channelLabels: ['L', 'R'] });
	assert.equal(snapshot.correlation, 1);
	assert.equal(snapshot.phaseDegrees, 0);
	snapshot = meters.update(track('out-of-phase'), {
		channels: [left, Float32Array.from(left, (value) => -value)],
		channelLabels: ['L', 'R'],
	});
	assert.equal(snapshot.correlation, -1);
	assert.equal(snapshot.phaseDegrees, 180);
	snapshot = meters.update(track('quadrature'), {
		channels: [left, Float32Array.of(0, 1, 0, -1)],
		channelLabels: ['L', 'R'],
	});
	assert.ok(Math.abs((snapshot.correlation ?? 1)) < 1e-12);
	assert.equal(snapshot.phaseDegrees, 90);

	const surround = meters.update(track('surround'), {
		channels: Array.from({ length: 6 }, (_, channel) => Float32Array.of((channel + 1) / 10)),
		channelLabels: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'],
	});
	assert.equal(surround.channelCount, 6);
	assert.deepEqual(surround.channels.map(({ label }) => label), ['L', 'R', 'C', 'LFE', 'Ls', 'Rs']);
	assert.ok(Math.abs((surround.channels[5]?.peak ?? 0) - 0.6) < 1e-6);
	assert.deepEqual(METER_SESSION_POLICY.projectFields, []);
	assert.deepEqual(METER_SESSION_POLICY.historyFields, []);
	assert.deepEqual(METER_SESSION_POLICY.exportTransforms, []);
});

test('per-strip meter state is bounded, lifecycle-resettable, and rejects malformed PCM', () => {
	const meters = createSessionStripMeterStore({ maximumStrips: 2, maximumFramesPerUpdate: 4 });
	const input = { channels: [Float32Array.of(0.1)], channelLabels: ['M'] };
	meters.update(track('a'), input);
	meters.update(track('b'), input);
	meters.update(track('c'), input);
	assert.deepEqual(meters.snapshot().map(({ strip }) => strip), [track('b'), track('c')]);
	assert.equal(meters.get(track('a')), null);
	assert.throws(() => meters.update(track('long'), {
		channels: [new Float32Array(5)], channelLabels: ['M'],
	}), /at most 4/iu);
	assert.throws(() => meters.update(track('labels'), {
		channels: [Float32Array.of(0), Float32Array.of(0)], channelLabels: ['M'],
	}), /label/iu);
	assert.throws(() => meters.update(track('nan'), {
		channels: [Float32Array.of(Number.NaN)], channelLabels: ['M'],
	}), /finite/iu);
	meters.reset();
	assert.deepEqual(meters.snapshot(), []);
});

test('EBU R128 loudness history is bounded session state and reset clears both meter and history', () => {
	const sampleRate = 8_000;
	const history = createSessionLoudnessHistory({ sampleRate, channelCount: 1, capacity: 3 });
	const tone = Float32Array.from({ length: sampleRate }, (_, frame) => (
		0.1 * Math.sin(2 * Math.PI * 1_000 * frame / sampleRate)
	));
	history.push([tone]);
	let snapshot = history.snapshot();
	assert.equal(snapshot.history.length, 3);
	assert.deepEqual(snapshot.history.map(({ sequence }) => sequence), [8, 9, 10]);
	assert.equal(snapshot.history[2]?.measuredSeconds, 1);
	assert.ok(Number.isFinite(snapshot.history[2]?.momentaryLufs));
	assert.ok(Number.isFinite(snapshot.history[2]?.integratedLufs));
	assert.equal(snapshot.policy, METER_SESSION_POLICY);

	history.reset();
	snapshot = history.snapshot();
	assert.deepEqual(snapshot.history, []);
	assert.equal(snapshot.current.loudness.integratedLufs, null);
	assert.equal(snapshot.current.loudness.measuredSeconds, 0);
	assert.throws(() => history.push([new Float32Array(65_537)]), /at most 65536/iu);
	assert.throws(() => createSessionLoudnessHistory({
		sampleRate, channelCount: 1, capacity: 36_001,
	}), /through 36000/iu);
});

test('one deterministic budgeted scheduler covers 128 strips without analyzing hidden idle strips', () => {
	const candidates = Array.from({ length: 128 }, (_, index) => ({
		strip: track(`track-${String(index).padStart(3, '0')}`),
		visible: index !== 4,
		armed: index === 4,
		costFrames: 1_024,
	}));
	candidates.push({ strip: track('hidden-idle'), visible: false, armed: false, costFrames: 1_024 });
	const first = createStripAnalysisScheduler({ maximumStripsPerTick: 8, maximumFramesPerTick: 8_192 });
	const second = createStripAnalysisScheduler({ maximumStripsPerTick: 8, maximumFramesPerTick: 8_192 });
	const covered = new Set<string>();
	for (let tick = 0; tick < 16; tick += 1) {
		const plan = first.plan(candidates);
		const replay = second.plan(candidates);
		assert.deepEqual(replay, plan);
		assert.equal(plan.scheduled.length, 8);
		assert.ok(plan.usedFrames <= 8_192);
		for (const item of plan.scheduled) {
			if (item.strip.kind === 'track') covered.add(item.strip.id);
		}
	}
	assert.equal(covered.size, 128);
	assert.equal(covered.has('track-004'), true, 'armed hidden strips remain eligible');
	assert.equal(covered.has('hidden-idle'), false);
});

test('analysis scheduling validates hostile candidates and skips work that cannot fit the shared budget', () => {
	const scheduler = createStripAnalysisScheduler({ maximumStripsPerTick: 2, maximumFramesPerTick: 1_000 });
	const plan = scheduler.plan([
		{ strip: track('fits'), visible: true, armed: false, costFrames: 600 },
		{ strip: track('waits'), visible: true, armed: false, costFrames: 500 },
		{ strip: track('hidden'), visible: false, armed: false, costFrames: 1 },
	]);
	assert.deepEqual(plan.scheduled.map(({ strip }) => strip), [track('fits')]);
	assert.equal(plan.usedFrames, 600);
	assert.deepEqual(plan.deferred.map(({ reason }) => reason), ['over-budget']);
	assert.throws(() => scheduler.plan([
		{ strip: track('impossible'), visible: true, armed: false, costFrames: 1_001 },
	]), /costFrames must be an integer from 1 through 1000/iu);

	let reads = 0;
	const hostile = Object.create(null) as Record<string, unknown>;
	Object.defineProperty(hostile, 'strip', { enumerable: true, value: track('hostile') });
	Object.defineProperty(hostile, 'visible', {
		enumerable: true,
		get() { reads += 1; return true; },
	});
	Object.defineProperty(hostile, 'armed', { enumerable: true, value: false });
	Object.defineProperty(hostile, 'costFrames', { enumerable: true, value: 1 });
	assert.throws(() => scheduler.plan([hostile]), /data property/iu);
	assert.equal(reads, 0);
});

test('the engine meter bridge samples one bounded session and resets on demand or project replacement', () => {
	const owner = {};
	const project = {};
	const left = fakeAnalyser(Float32Array.of(1, 0, -1, 0));
	const right = fakeAnalyser(Float32Array.of(1, 0, -1, 0));
	const bank: StripMeterAnalyserBankV21 = {
		strip: track('runtime'),
		output: {} as AudioNode,
		channelLabels: ['L', 'R'],
		analysers: [left, right],
	};
	const reading = ebuReading(0.1, -20);
	let snapshot = sampleProductionMeterSessionV21(owner, project, new Map([['runtime', bank]]), reading);
	assert.equal(snapshot.productionMeters.length, 1);
	assert.equal(snapshot.productionMeters[0]?.correlation, 1);
	assert.equal(snapshot.productionLoudnessHistory?.history.length, 1);

	snapshot = sampleProductionMeterSessionV21(owner, project, new Map([['runtime', bank]]), reading);
	assert.equal(snapshot.productionLoudnessHistory?.history.length, 1, 'one worklet reading is recorded once');
	snapshot = sampleProductionMeterSessionV21(owner, project, new Map([['runtime', bank]]), ebuReading(0.2, -19));
	assert.equal(snapshot.productionLoudnessHistory?.history.length, 2);

	resetProductionMeterSessionV21(owner);
	snapshot = sampleProductionMeterSessionV21(owner, project, new Map(), null);
	assert.deepEqual(snapshot.productionMeters, []);
	assert.equal(snapshot.productionLoudnessHistory, undefined);

	sampleProductionMeterSessionV21(owner, project, new Map([['runtime', bank]]), reading);
	snapshot = sampleProductionMeterSessionV21(owner, {}, new Map(), null);
	assert.deepEqual(snapshot.productionMeters, []);
	assert.equal(snapshot.productionLoudnessHistory, undefined);
});

function fakeAnalyser(samples: Float32Array): AnalyserNode {
	return {
		fftSize: samples.length,
		getFloatTimeDomainData(target: Float32Array): void { target.set(samples); },
	} as unknown as AnalyserNode;
}

function ebuReading(peak: number, integratedLufs: number) {
	return Object.freeze({
		peak,
		rms: peak / Math.sqrt(2),
		dbfs: 20 * Math.log10(peak),
		loudness: Object.freeze({
			standard: 'ebu-r128',
			momentaryLufs: integratedLufs,
			shortTermLufs: integratedLufs,
			integratedLufs,
			maximumMomentaryLufs: integratedLufs,
			maximumShortTermLufs: integratedLufs,
			loudnessRangeLu: 0,
			loudnessRangeStable: false,
			truePeakDbtp: 20 * Math.log10(peak),
			maximumTruePeakDbtp: 20 * Math.log10(peak),
			measuredSeconds: 1,
			state: 'running',
		}),
	});
}
