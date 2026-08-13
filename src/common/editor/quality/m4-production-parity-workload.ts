/* SPDX-License-Identifier: AGPL-3.0-only */

import { compileProjectGainEvents } from '../engine/project-gain-event-plan.ts';
import { compileProjectPdcPlan } from '../engine/project-pdc-plan.ts';
import type { EngineProject, EngineTrack } from '../engine/types.ts';

export const M4_PRODUCTION_PARITY_WORKLOAD_ID = 'm4-production-render-parity';
export const M4_PRODUCTION_PARITY_FIXTURE_ID = 'm4-production-parity-v1';
export const M4_PRODUCTION_PARITY_PROFILE = 'deterministic-production-parity-v1';

const SAMPLE_RATE = 48_000;
const FRAME_COUNT = 48_000;
const CHANNEL_COUNT = 2;
const SEED = 1_294_994_497;
const PDC_LATENCY_FRAMES = 37;
const AUTOMATION_CHANGE_FRAME = 24_000;
const INPUT_IMPULSE_FRAMES = Object.freeze([1_024, 4_096]);
const OUTPUT_IMPULSE_FRAMES = Object.freeze(
	INPUT_IMPULSE_FRAMES.map((frame) => frame + PDC_LATENCY_FRAMES),
);

export interface M4ProductionParitySpecification {
	readonly generatorRevision: 1;
	readonly seed: number;
	readonly sampleRate: number;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly pdcLatencyFrames: number;
	readonly automationChangeFrame: number;
	readonly inputImpulseFrames: readonly number[];
	readonly outputImpulseFrames: readonly number[];
	readonly inputChannelSha256: readonly string[];
	readonly referenceChannelSha256: readonly string[];
	readonly videoFixtureId: 'video-effect-parity-rgba-v1';
	readonly videoWidth: 128;
	readonly videoHeight: 72;
}

export interface M4ProductionParityAudioFixture {
	readonly input: readonly Float32Array[];
	readonly reference: readonly Float32Array[];
}

export interface M4ProductionParityAudioMetrics {
	readonly maximumAbsoluteSampleError: number;
	readonly pdcErrorSamples: number;
}

export interface M4ProductionParityAudioPlan {
	readonly pdcLatencyFrames: number;
	readonly gainEvents: readonly Readonly<{
		readonly kind: 'set' | 'linear';
		readonly value: number;
		readonly time: number;
	}>[];
}

export const M4_PRODUCTION_PARITY_SPECIFICATION: M4ProductionParitySpecification = Object.freeze({
	generatorRevision: 1,
	seed: SEED,
	sampleRate: SAMPLE_RATE,
	frameCount: FRAME_COUNT,
	channelCount: CHANNEL_COUNT,
	pdcLatencyFrames: PDC_LATENCY_FRAMES,
	automationChangeFrame: AUTOMATION_CHANGE_FRAME,
	inputImpulseFrames: INPUT_IMPULSE_FRAMES,
	outputImpulseFrames: OUTPUT_IMPULSE_FRAMES,
	inputChannelSha256: Object.freeze([
		'626e70475d9328e0026faac70afb036004ebaa4dfe0404f0da9fba84397a9884',
		'7d2725992a5afeb23416a37f735bc4311589b89f97bb1e71c843ea0dbcad72b2',
	]),
	referenceChannelSha256: Object.freeze([
		'8704074d600c3331096c1505a8c22e2428ba2cb3a4e0682f3f432670c5479292',
		'b7e68494b462e5ab8a3999349aacc1bb24919384b5fadb6e581a2a91c8865bf1',
	]),
	videoFixtureId: 'video-effect-parity-rgba-v1',
	videoWidth: 128,
	videoHeight: 72,
});

/** Compile the fixture through the same PDC and gain-event planners as the engine graph. */
export function compileM4ProductionParityAudioPlan(
	latencyFrames = PDC_LATENCY_FRAMES,
): M4ProductionParityAudioPlan {
	const track: EngineTrack = {
		id: 'm4-production-parity-track',
		type: 'audio',
		gain: 1,
		effectsActive: true,
		effects: [{
			id: 'm4-production-parity-limiter',
			type: 'limiter',
			enabled: true,
			params: { lookahead: latencyFrames / SAMPLE_RATE },
		}],
		envelope: [
			{ frame: 0, value: 0.75 },
			{ frame: AUTOMATION_CHANGE_FRAME - 1, value: 0.75 },
			{ frame: AUTOMATION_CHANGE_FRAME, value: 0.5 },
			{ frame: FRAME_COUNT, value: 0.5 },
		],
	};
	const project: EngineProject = {
		sampleRate: SAMPLE_RATE,
		masterChannels: CHANNEL_COUNT,
		tracks: [track],
		mixer: { groups: [], sends: [], routes: {} },
		master: { gain: 1, effectsActive: true, effects: [], envelope: [] },
	};
	const pdcPlan = compileProjectPdcPlan(project, { sampleRate: SAMPLE_RATE });
	const trackLatencyFrames = pdcPlan.trackLatencyFrames.get(String(track.id)) ?? 0;
	return Object.freeze({
		pdcLatencyFrames: pdcPlan.latencyFrames,
		gainEvents: compileProjectGainEvents(track, {
			fromFrame: 0,
			toFrame: FRAME_COUNT,
			durationFrames: FRAME_COUNT,
			contextStartTime: 0,
			sampleRate: SAMPLE_RATE,
			contextSampleRate: SAMPLE_RATE,
			transportRate: 1,
			latencyFrames: trackLatencyFrames,
		}),
	});
}

/** Create the seeded stereo input and an independent exact scheduling oracle. */
export function createM4ProductionParityAudioFixture(): M4ProductionParityAudioFixture {
	const random = xorshift32(SEED);
	const input = Array.from({ length: CHANNEL_COUNT }, () => new Float32Array(FRAME_COUNT));
	for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
		const packed = random();
		input[0]![frame] = Math.fround(((packed & 0xffff) - 32_768) / 1_048_576);
		input[1]![frame] = Math.fround(((packed >>> 16) - 32_768) / 1_048_576);
	}
	input[0]![INPUT_IMPULSE_FRAMES[0]!] = 1;
	input[1]![INPUT_IMPULSE_FRAMES[1]!] = -1;

	const reference = input.map(() => new Float32Array(FRAME_COUNT));
	for (let inputFrame = 0; inputFrame + PDC_LATENCY_FRAMES < FRAME_COUNT; inputFrame += 1) {
		const outputFrame = inputFrame + PDC_LATENCY_FRAMES;
		const gain = inputFrame < AUTOMATION_CHANGE_FRAME ? 0.75 : 0.5;
		for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
			reference[channel]![outputFrame] = Math.fround(input[channel]![inputFrame]! * gain);
		}
	}
	return Object.freeze({
		input: Object.freeze(input),
		reference: Object.freeze(reference),
	});
}

/** Encode planar channels as canonical frame-major little-endian Float32 evidence. */
export function encodeM4ProductionParityAudio(channels: readonly Float32Array[]): Uint8Array {
	const frameCount = validateAudioGeometry(channels);
	const bytes = new Uint8Array(frameCount * channels.length * Float32Array.BYTES_PER_ELEMENT);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 0;
	for (let frame = 0; frame < frameCount; frame += 1) {
		for (const channel of channels) {
			view.setFloat32(offset, channel[frame]!, true);
			offset += Float32Array.BYTES_PER_ELEMENT;
		}
	}
	return bytes;
}

/** Decode only the frozen fixture geometry used by browser quality evidence. */
export function decodeM4ProductionParityAudio(bytes: Uint8Array): readonly Float32Array[] {
	const expectedBytes = FRAME_COUNT * CHANNEL_COUNT * Float32Array.BYTES_PER_ELEMENT;
	if (!(bytes instanceof Uint8Array) || bytes.byteLength !== expectedBytes) {
		throw new RangeError(`Milestone 4 audio evidence must contain exactly ${expectedBytes} bytes.`);
	}
	const channels = Array.from({ length: CHANNEL_COUNT }, () => new Float32Array(FRAME_COUNT));
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 0;
	for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
		for (const channel of channels) {
			channel[frame] = view.getFloat32(offset, true);
			offset += Float32Array.BYTES_PER_ELEMENT;
		}
	}
	return Object.freeze(channels);
}

/** Recompute both audio thresholds from complete PCM, never supplied aggregates. */
export function compareM4ProductionParityAudio(
	actual: readonly Float32Array[],
	reference: readonly Float32Array[],
): M4ProductionParityAudioMetrics {
	const frameCount = validateAudioGeometry(actual);
	if (validateAudioGeometry(reference) !== frameCount || actual.length !== reference.length) {
		throw new RangeError('Milestone 4 audio evidence geometry does not match its reference.');
	}
	let maximumAbsoluteSampleError = 0;
	for (let channel = 0; channel < actual.length; channel += 1) {
		for (let frame = 0; frame < frameCount; frame += 1) {
			const value = actual[channel]![frame]!;
			if (!Number.isFinite(value)) throw new TypeError('Milestone 4 audio evidence must be finite.');
			maximumAbsoluteSampleError = Math.max(
				maximumAbsoluteSampleError,
				Math.abs(value - reference[channel]![frame]!),
			);
		}
	}
	let pdcErrorSamples = 0;
	for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
		const expectedFrame = OUTPUT_IMPULSE_FRAMES[channel]!;
		const observedFrame = strongestFrame(actual[channel]!);
		pdcErrorSamples = Math.max(pdcErrorSamples, Math.abs(observedFrame - expectedFrame));
	}
	return Object.freeze({ maximumAbsoluteSampleError, pdcErrorSamples });
}

function strongestFrame(channel: Float32Array): number {
	let strongest = 0;
	let magnitude = -1;
	for (let frame = 0; frame < channel.length; frame += 1) {
		const candidate = Math.abs(channel[frame]!);
		if (candidate > magnitude) {
			strongest = frame;
			magnitude = candidate;
		}
	}
	return strongest;
}

function validateAudioGeometry(channels: readonly Float32Array[]): number {
	if (!Array.isArray(channels) || channels.length < 1) {
		throw new TypeError('Milestone 4 audio evidence requires planar Float32 channels.');
	}
	const frameCount = channels[0]?.length ?? 0;
	if (frameCount < 1 || channels.some((channel) => (
		!(channel instanceof Float32Array) || channel.length !== frameCount
	))) throw new RangeError('Milestone 4 audio evidence channels must share one positive frame count.');
	return frameCount;
}

function xorshift32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return state >>> 0;
	};
}
