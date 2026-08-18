/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	normalizeAdmProjectMetadata,
	type AdmAuthoredMetadata,
} from '../src/common/editor/adm-project-metadata.ts';
import {
	binauralSourcesForAuthoredAdm,
	resolveBinauralDelivery,
} from '../src/common/editor/binaural-delivery.ts';
import {
	BINAURAL_RENDERER_LIMITATIONS,
	renderBinaural,
	type BinauralSource,
} from '../src/common/editor/binaural-render.ts';
import { inventoryDeliveryConversions } from '../src/common/editor/delivery-conversion-inventory.ts';

const SAMPLE_RATE = 48_000;

/** An impulse, so an arrival time is something the test can actually find. */
function impulse(length = 256, at = 64): Float32Array {
	const channel = new Float32Array(length);
	channel[at] = 1;
	return channel;
}

function source(overrides: Partial<BinauralSource> = {}): BinauralSource {
	return { channel: impulse(), azimuth: 0, elevation: 0, distance: 1, ...overrides };
}

/** Where the energy actually landed, to sub-sample resolution. */
function centroid(channel: Float32Array): number {
	let weight = 0;
	let moment = 0;
	for (let index = 0; index < channel.length; index += 1) {
		const energy = channel[index] * channel[index];
		weight += energy;
		moment += energy * index;
	}
	return weight === 0 ? Number.NaN : moment / weight;
}

function energy(channel: Float32Array): number {
	let total = 0;
	for (const sample of channel) total += sample * sample;
	return total;
}

test('a source in front of the listener arrives at both ears together and at equal level', () => {
	const [left, right] = renderBinaural([source()], SAMPLE_RATE).channels;
	assert.ok(Math.abs(centroid(left) - centroid(right)) < 1e-6, 'no interaural delay straight ahead');
	assert.ok(Math.abs(energy(left) - energy(right)) < 1e-9, 'no interaural level difference either');
});

test('a source to the left reaches the left ear first, and louder', () => {
	const [left, right] = renderBinaural([source({ azimuth: 90 })], SAMPLE_RATE).channels;
	assert.ok(centroid(left) < centroid(right), 'the near ear hears it first');
	assert.ok(energy(left) > energy(right), 'and the far ear is in the head shadow');

	const mirrored = renderBinaural([source({ azimuth: -90 })], SAMPLE_RATE).channels;
	assert.ok(Math.abs(centroid(mirrored[1]) - centroid(left)) < 1e-6, 'the model is symmetric');
	assert.ok(Math.abs(energy(mirrored[1]) - energy(left)) < 1e-9);
});

test('the interaural delay grows with the angle and never exceeds the head', () => {
	let previous = 0;
	for (const azimuth of [0, 15, 30, 45, 60, 75, 90]) {
		const [left, right] = renderBinaural([source({ azimuth })], SAMPLE_RATE).channels;
		const difference = (centroid(right) - centroid(left)) / SAMPLE_RATE;
		assert.ok(difference >= previous - 1e-9, `azimuth ${azimuth} does not move the image back`);
		previous = difference;
	}
	// A head is about 17.5 cm across, so no arrival difference can be much past
	// three quarters of a millisecond whatever the angle.
	assert.ok(previous < 0.00075, `the widest delay is ${previous}s`);
	assert.ok(previous > 0.0005, 'and a full 90 degrees is not a small one either');
});

test('elevation pulls a source back towards the centre, because both ears face it equally', () => {
	const delay = (elevation: number) => {
		const [left, right] = renderBinaural([source({ azimuth: 90, elevation })], SAMPLE_RATE).channels;
		return centroid(right) - centroid(left);
	};
	assert.ok(delay(60) < delay(0), 'raised is less lateral');
	assert.ok(Math.abs(delay(90)) < 1e-6, 'directly overhead is equidistant from both ears');
	assert.ok(Math.abs(delay(-60) - delay(60)) < 1e-6, 'below the listener behaves like above it');
});

test('a low-frequency source is placed in the middle and keeps its power', () => {
	const result = renderBinaural([source({ azimuth: 120, lowFrequencyEffects: true })], SAMPLE_RATE);
	const [left, right] = result.channels;
	assert.deepEqual([...left], [...right], 'no direction to render, so no difference to make');
	assert.ok(Math.abs(energy(left) + energy(right) - energy(impulse())) < 1e-6, 'equal-power split');
	assert.equal(result.decision.lowFrequencySources, 1);
});

test('distance makes a source louder up to a stated clamp, and never quieter than the reference', () => {
	const total = (distance: number) => {
		const [left, right] = renderBinaural([source({ distance })], SAMPLE_RATE).channels;
		return energy(left) + energy(right);
	};
	const reference = total(1);
	assert.ok(total(0.5) > reference * 3.9 && total(0.5) < reference * 4.1, 'half the distance is +6 dB');
	assert.ok(Math.abs(total(0.1) - total(0.25)) < 1e-6, 'the inverse law stops growing at a quarter');
});

test('sources sum, and the decision names the model rather than a version', () => {
	const result = renderBinaural([
		source({ azimuth: -30 }),
		source({ azimuth: 30 }),
		source({ azimuth: 0, lowFrequencyEffects: true }),
	], SAMPLE_RATE);
	assert.equal(result.channels[0].length, 256);
	assert.equal(result.decision.renderer, 'parametric-spherical-head');
	assert.equal(result.decision.sources, 3);
	assert.equal(result.decision.headRadiusMetres, 0.0875);
	assert.ok(result.decision.maximumInterauralDelayMs > 0);
	assert.ok(
		result.decision.limitations.some((limitation) => /head-related transfer function/u.test(limitation)),
		'the report states that this is not a measured HRTF',
	);
});

test('a render of nothing is two empty channels, not a crash', () => {
	const result = renderBinaural([], SAMPLE_RATE);
	assert.equal(result.channels.length, 2);
	assert.equal(result.channels[0].length, 0);
	assert.throws(() => renderBinaural([], 0), /positive sample rate/u);
});

test('the renderer leaves the channels it was given alone', () => {
	const channel = impulse();
	renderBinaural([{ channel, azimuth: 45, elevation: 0, distance: 0.5 }], SAMPLE_RATE);
	assert.deepEqual([...channel], [...impulse()]);
});

test('a binaural delivery places the programme where the file says it is', () => {
	const metadata = normalizeAdmProjectMetadata({
		mode: 'authored',
		programme: { name: 'Programme', language: 'eng' },
		content: { name: 'Content', language: 'eng' },
		bed: {
			name: 'Bed', layout: '5.1',
			assignments: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'].map((bedChannel, sourceChannel) => ({
				stripKind: 'track', stripId: 'mix', sourceChannel, bedChannel,
			})),
		},
		objects: [{
			id: 'voice', name: 'Narrator', stripKind: 'track', stripId: 'voice',
			sourceChannel: 0, gain: 1, position: { azimuth: -60, elevation: 20, distance: 0.5 },
		}],
	}) as AdmAuthoredMetadata;
	const channels = Array.from({ length: 7 }, () => impulse());
	const sources = binauralSourcesForAuthoredAdm(metadata, channels);

	assert.deepEqual(sources.map(({ name, azimuth, elevation }) => ({ name, azimuth, elevation })), [
		{ name: 'L', azimuth: 30, elevation: 0 },
		{ name: 'R', azimuth: -30, elevation: 0 },
		{ name: 'C', azimuth: 0, elevation: 0 },
		{ name: 'LFE', azimuth: 45, elevation: -30 },
		{ name: 'Ls', azimuth: 110, elevation: 0 },
		{ name: 'Rs', azimuth: -110, elevation: 0 },
		{ name: 'Narrator', azimuth: -60, elevation: 20 },
	]);
	assert.equal(sources[3]?.lowFrequencyEffects, true, 'the bed table says which channel carries no direction');
	assert.equal(sources[6]?.distance, 0.5, 'and the object keeps the distance it was authored at');

	// A render that does not match the programme is refused rather than guessed at.
	assert.throws(
		() => binauralSourcesForAuthoredAdm(metadata, channels.slice(0, 6)),
		/needs 7 channels, not 6/u,
	);
});

test('a binaural delivery is refused wherever it would have to invent something', () => {
	const authored = { mode: 'authored', programme: { name: 'P', language: '' }, content: { name: 'C', language: '' },
		bed: { name: 'B', layout: 'stereo', assignments: [] } };
	const refusal = (adm: unknown, options: Record<string, unknown>) =>
		resolveBinauralDelivery(adm as never, { binaural: true, mode: 'mix', format: 'wav', ...options }).refusal;

	assert.equal(resolveBinauralDelivery(authored as never, { binaural: false, mode: 'mix', format: 'wav' }).refusal, 'not-requested');
	assert.equal(refusal(null, {}), 'no-authored-programme');
	assert.equal(refusal(authored, { mode: 'stems' }), 'stems');
	// Two channels in a container whose CHNA and AXML describe a bed and objects
	// that are no longer there.
	assert.equal(refusal(authored, { format: 'bw64' }), 'container-declares-a-different-programme');

	const resolved = resolveBinauralDelivery(authored as never, { binaural: true, mode: 'mix', format: 'wav' });
	assert.equal(resolved.refusal, null);
	assert.equal(resolved.plan?.sourceChannelCount, 2);
});

test('the delivery report states the renderer and what it does not model', () => {
	const [item] = inventoryDeliveryConversions({
		format: 'wav',
		sampleRate: 48_000,
		binaural: { sourceChannelCount: 10, metadata: { bed: { layout: '5.1.4' }, objects: [{}, {}] } },
	}, { sampleRate: 48_000 }).filter(({ code }) => code === 'delivery.binaural-render');
	assert.equal(item?.disposition, 'converted');
	assert.equal(item?.severity, 'warning', 'a listener has to be told the programme was placed by a model');
	assert.deepEqual(item?.data, {
		renderer: 'parametric-spherical-head',
		sourceChannels: 10,
		bedLayout: '5.1.4',
		objects: 2,
		limitations: BINAURAL_RENDERER_LIMITATIONS,
	});
});
