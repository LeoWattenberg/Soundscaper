import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	M4_PRODUCTION_PARITY_SPECIFICATION,
	compareM4ProductionParityAudio,
	compileM4ProductionParityAudioPlan,
	createM4ProductionParityAudioFixture,
	createM4ProductionParityEngineProject,
	encodeM4ProductionParityAudio,
} from '../src/common/editor/quality/m4-production-parity-workload.ts';
import { compileProjectPathPdcPlanV21 } from '../src/common/editor/engine/project-path-pdc-plan-v21.ts';
import type { MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';

test('the milestone 4 production parity audio fixture is deterministic and digest-pinned', () => {
	const first = createM4ProductionParityAudioFixture();
	const second = createM4ProductionParityAudioFixture();

	assert.equal(first.input.length, 2);
	assert.equal(first.reference.length, 2);
	assert.equal(first.input[0]?.length, 48_000);
	assert.deepEqual(second, first);
	assert.deepEqual(
		first.input.map((channel) => sha256(encodeM4ProductionParityAudio([channel]))),
		M4_PRODUCTION_PARITY_SPECIFICATION.inputChannelSha256,
	);
	assert.deepEqual(
		first.reference.map((channel) => sha256(encodeM4ProductionParityAudio([channel]))),
		M4_PRODUCTION_PARITY_SPECIFICATION.referenceChannelSha256,
	);
});

test('audio comparison reports maximum error and exact PDC impulse positions', () => {
	const fixture = createM4ProductionParityAudioFixture();
	assert.deepEqual(compareM4ProductionParityAudio(fixture.reference, fixture.reference), {
		maximumAbsoluteSampleError: 0,
		pdcErrorSamples: 0,
	});

	const shifted = fixture.reference.map((channel) => channel.slice());
	const expected = M4_PRODUCTION_PARITY_SPECIFICATION.outputImpulseFrames[0];
	shifted[0]![expected + 1] = shifted[0]![expected]!;
	shifted[0]![expected] = 0;
	assert.equal(compareM4ProductionParityAudio(shifted, fixture.reference).pdcErrorSamples, 1);
	shifted[1]![123] += 0.01;
	assert.ok(compareM4ProductionParityAudio(shifted, fixture.reference).maximumAbsoluteSampleError >= 0.01);
});

test('audio comparison finds gross impulse shifts outside the former local search window', () => {
	const fixture = createM4ProductionParityAudioFixture();
	const shifted = fixture.reference.map((channel) => channel.slice());
	const expected = M4_PRODUCTION_PARITY_SPECIFICATION.outputImpulseFrames[0];
	shifted[0]![expected] = 0.001;
	shifted[0]![expected + 100] = 1;

	assert.equal(compareM4ProductionParityAudio(
		shifted,
		fixture.reference,
	).pdcErrorSamples, 100);
	shifted[0]![expected + 110] = -1;
	assert.equal(compareM4ProductionParityAudio(
		shifted,
		fixture.reference,
	).pdcErrorSamples, 100);
});

test('production PDC and gain scheduling plans are metric-sensitive', () => {
	const fixture = createM4ProductionParityAudioFixture();
	const plan = compileM4ProductionParityAudioPlan();
	assert.equal(plan.pdcLatencyFrames, M4_PRODUCTION_PARITY_SPECIFICATION.pdcLatencyFrames);
	assert.deepEqual(plan.gainEvents.map(({ kind, value, time }) => ({
		kind,
		value,
		frame: Math.round(time * M4_PRODUCTION_PARITY_SPECIFICATION.sampleRate),
	})), [
		{ kind: 'set', value: 0.75, frame: 27 },
		{ kind: 'linear', value: 0.75, frame: 24_026 },
		{ kind: 'linear', value: 0.5, frame: 24_027 },
		{ kind: 'linear', value: 0.5, frame: 48_027 },
	]);

	const perturbedPdc = compileM4ProductionParityAudioPlan(38);
	const shifted = projectFixtureFromProductionPlan(fixture.input, perturbedPdc);
	const shiftedMetrics = compareM4ProductionParityAudio(shifted, fixture.reference);
	assert.equal(shiftedMetrics.pdcErrorSamples, 1);
	assert.ok(shiftedMetrics.maximumAbsoluteSampleError > 0.000_001);

	const perturbedScheduling = {
		...plan,
		gainEvents: plan.gainEvents.map((event, index) => (
			index === 2 ? { ...event, value: 0.49 } : event
		)),
	};
	assert.ok(compareM4ProductionParityAudio(
		projectFixtureFromProductionPlan(fixture.input, perturbedScheduling),
		fixture.reference,
	).maximumAbsoluteSampleError > 0.000_001);
});

test('the registered workload compiles a production V21 sidechain, send, and nested parallel graph', () => {
	const project = createM4ProductionParityEngineProject();
	const plan = compileProjectPathPdcPlanV21(project, {
		sampleRate: M4_PRODUCTION_PARITY_SPECIFICATION.sampleRate,
	});
	const mixer = project.mixer as MixerGraphV21 | undefined;
	assert.equal(project.schemaVersion, 21);
	assert.deepEqual(project.tracks?.map(({ id }) => id), ['program', 'control']);
	assert.deepEqual(mixer?.groups.map(({ id }) => id), ['fast', 'parent']);
	assert.deepEqual(mixer?.sends.map(({ id }) => id), ['slow']);
	assert.ok(mixer?.edges.some(({ kind }) => kind === 'sidechain'));
	assert.ok(mixer?.edges.some(({ kind }) => kind === 'send'));
	assert.deepEqual(project.automationLanes?.map((lane) => (
		(lane as Readonly<Record<string, unknown>>).id
	)), ['program-gain']);
	assert.equal(plan.nodeInputLatencyFrames.get('track:program'), 7);
	assert.equal(plan.nodeOutputLatencyFrames.get('track:program'), 27);
	assert.equal(plan.edgeCompensationFrames.get('fast-parent'), 10);
	assert.equal(plan.latencyFrames, M4_PRODUCTION_PARITY_SPECIFICATION.pdcLatencyFrames);
});

test('the browser collector delegates audio to the production graph and scheduler harness', async () => {
	const [harness, collector, identity] = await Promise.all([
		readFile(new URL(
			'../src/common/editor/quality/m4-production-parity-browser-harness.ts',
			import.meta.url,
		), 'utf8'),
		readFile(new URL('./browser/audio-editor-m4-production-parity.spec.js', import.meta.url), 'utf8'),
		readFile(new URL('../scripts/lib/m4-production-parity-identity.mjs', import.meta.url), 'utf8'),
	]);
	assert.match(harness, /buildProjectGraph\(/u);
	assert.match(harness, /scheduleProjectClips\(/u);
	assert.match(collector, /renderM4ProductionParityProductionPath/u);
	assert.doesNotMatch(collector, /compileM4ProductionParityAudioPlan/u);
	assert.doesNotMatch(collector, /\.createDelay\(/u);
	assert.doesNotMatch(`${collector}\n${identity}`, /M4_PARITY_REFERENCE_ENVIRONMENT_ID/u);
	assert.doesNotMatch(`${collector}\n${identity}`, /ReferenceHostObservation/u);
});

test('audio evidence uses canonical interleaved little-endian Float32 bytes', () => {
	const bytes = encodeM4ProductionParityAudio([
		new Float32Array([0.5, -0.25]),
		new Float32Array([1, -1]),
	]);
	assert.equal(bytes.byteLength, 16);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	assert.deepEqual(Array.from({ length: 4 }, (_, index) => view.getFloat32(index * 4, true)), [
		0.5, 1, -0.25, -1,
	]);
});

function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function projectFixtureFromProductionPlan(
	input: readonly Float32Array[],
	plan: ReturnType<typeof compileM4ProductionParityAudioPlan>,
): readonly Float32Array[] {
	const output = input.map((channel) => new Float32Array(channel.length));
	const rate = M4_PRODUCTION_PARITY_SPECIFICATION.sampleRate;
	const events = plan.gainEvents.map((event) => ({ ...event, frame: Math.round(event.time * rate) }));
	for (let inputFrame = 0; inputFrame + plan.pdcLatencyFrames < output[0]!.length; inputFrame += 1) {
		const outputFrame = inputFrame + plan.pdcLatencyFrames;
		const gain = scheduledGainAtFrame(events, outputFrame);
		for (let channel = 0; channel < output.length; channel += 1) {
			output[channel]![outputFrame] = Math.fround(input[channel]![inputFrame]! * gain);
		}
	}
	return output;
}

function scheduledGainAtFrame(
	events: readonly { readonly kind: 'set' | 'linear'; readonly value: number; readonly frame: number }[],
	frame: number,
): number {
	let previous = events[0]!;
	for (const event of events.slice(1)) {
		if (frame > event.frame) {
			previous = event;
			continue;
		}
		if (event.kind !== 'linear' || event.frame <= previous.frame) return event.value;
		const progress = (frame - previous.frame) / (event.frame - previous.frame);
		return previous.value + (event.value - previous.value) * progress;
	}
	return previous.value;
}
