import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	M4_PRODUCTION_PARITY_SPECIFICATION,
	compareM4ProductionParityAudio,
	compileM4ProductionParityAudioPlan,
	createM4ProductionParityAudioFixture,
	encodeM4ProductionParityAudio,
} from '../src/common/editor/quality/m4-production-parity-workload.ts';

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
		{ kind: 'set', value: 0.75, frame: 37 },
		{ kind: 'linear', value: 0.75, frame: 24_036 },
		{ kind: 'linear', value: 0.5, frame: 24_037 },
		{ kind: 'linear', value: 0.5, frame: 48_037 },
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
