/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Rendering a positioned programme to two channels for headphones.
 *
 * **What this is.** A parametric spherical-head renderer: each source is placed
 * by the two cues a rigid sphere of the right size produces — the difference in
 * arrival time between the ears, and the shadow the head casts on the far one.
 * The delay follows the Woodworth creeping-wave approximation and the shadow is
 * the Brown–Duda single-pole/single-zero head filter, both computed from the
 * source's own angle to each ear.
 *
 * **What this is not, and the delivery report says so.** There is no measured
 * head-related transfer function here, and no pinna model. Elevation moves a
 * source's arrival time and its shadow, so it is not inaudible, but the spectral
 * notches that let a listener tell "above" from "behind" are exactly what a
 * measured HRTF carries and this does not. A renderer that claimed otherwise
 * would be the kind of claim that survives until someone puts headphones on.
 *
 * Choosing a measured dataset instead would be choosing whose ears the delivery
 * is rendered for, and shipping their measurements; that is a decision with a
 * licensing question attached and it is not made here. What is made here is a
 * renderer that is fully described by its own source, which is why the decision
 * it reports names the model and its limits rather than a version number.
 */

/** Half the distance between the ears, in metres: the sphere this model assumes. */
const HEAD_RADIUS_METRES = 0.0875;
const SPEED_OF_SOUND_METRES_PER_SECOND = 343;
/** Brown–Duda: the shelf gain at maximum shadow, reached 150° off the ear axis. */
const MINIMUM_SHADOW_GAIN = 0.1;
const SHADOW_MAXIMUM_DEGREES = 150;
/** Closer than this, the inverse-distance law stops growing. */
const MINIMUM_RENDERED_DISTANCE = 0.25;

export interface BinauralSource {
	/** The rendered samples for this position. Not modified. */
	readonly channel: Float32Array;
	/** Degrees, ADM convention: positive azimuth to the left, elevation up. */
	readonly azimuth: number;
	readonly elevation: number;
	/** Normalized distance, where 1 is the reference radius. */
	readonly distance: number;
	/** Low-frequency effects carry no direction and are placed in the middle. */
	readonly lowFrequencyEffects?: boolean;
	/** A label for the report, so a decision can name what it placed. */
	readonly name?: string;
}

export interface BinauralRendererDecision {
	readonly renderer: 'parametric-spherical-head';
	readonly headRadiusMetres: number;
	readonly speedOfSoundMetresPerSecond: number;
	readonly sources: number;
	readonly lowFrequencySources: number;
	readonly maximumInterauralDelayMs: number;
	/** Stated in the delivery report, because a renderer that hides these is lying. */
	readonly limitations: readonly string[];
}

export interface BinauralRenderResult {
	readonly channels: readonly Float32Array[];
	readonly decision: BinauralRendererDecision;
}

export const BINAURAL_RENDERER_ID = 'parametric-spherical-head' as const;

export const BINAURAL_RENDERER_LIMITATIONS = Object.freeze([
	'No measured head-related transfer function: this is a parametric spherical-head model.',
	'No pinna model, so elevation is conveyed by arrival time and shadow rather than by spectral cues.',
	'Distance follows an inverse law clamped at a quarter of the reference radius, not a near-field model.',
]);

export function renderBinaural(
	sources: readonly BinauralSource[],
	sampleRate: number,
): BinauralRenderResult {
	if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
		throw new RangeError('A binaural render requires a positive sample rate.');
	}
	const length = sources.reduce((longest, source) => Math.max(longest, source.channel.length), 0);
	const left = new Float32Array(length);
	const right = new Float32Array(length);
	let maximumDelaySamples = 0;
	let lowFrequencySources = 0;

	for (const source of sources) {
		const distanceGain = 1 / Math.max(source.distance, MINIMUM_RENDERED_DISTANCE);
		if (source.lowFrequencyEffects) {
			lowFrequencySources += 1;
			// No direction to render, and no shadow to cast. Split by equal power so
			// the bed's low end arrives at the same level it left at.
			const gain = distanceGain * Math.SQRT1_2;
			for (let index = 0; index < source.channel.length; index += 1) {
				const sample = source.channel[index] * gain;
				left[index] += sample;
				right[index] += sample;
			}
			continue;
		}
		for (const [ear, output] of [[1, left], [-1, right]] as const) {
			const angle = earAngleRadians(source.azimuth, source.elevation, ear);
			const delaySamples = earDelaySeconds(angle) * sampleRate;
			maximumDelaySamples = Math.max(maximumDelaySamples, delaySamples);
			mixShadowedEar(output, source.channel, delaySamples, shadowGain(angle), distanceGain, sampleRate);
		}
	}

	return Object.freeze({
		channels: Object.freeze([left, right]),
		decision: Object.freeze({
			renderer: BINAURAL_RENDERER_ID,
			headRadiusMetres: HEAD_RADIUS_METRES,
			speedOfSoundMetresPerSecond: SPEED_OF_SOUND_METRES_PER_SECOND,
			sources: sources.length,
			lowFrequencySources,
			maximumInterauralDelayMs: Number(((maximumDelaySamples / sampleRate) * 1000).toFixed(4)),
			limitations: BINAURAL_RENDERER_LIMITATIONS,
		}),
	});
}

/**
 * The angle between a source and one ear's outward normal.
 *
 * Forward is x, left is y, up is z. The ears sit on the y axis, so a source
 * directly at an ear is at angle zero and one at the opposite ear is at π. An
 * elevated source is further from both ear axes, which is what makes elevation
 * shrink the arrival-time difference rather than leave it untouched.
 */
function earAngleRadians(azimuthDegrees: number, elevationDegrees: number, ear: 1 | -1): number {
	const azimuth = (azimuthDegrees * Math.PI) / 180;
	const elevation = (elevationDegrees * Math.PI) / 180;
	const projection = Math.cos(elevation) * Math.sin(azimuth) * ear;
	return Math.acos(Math.min(1, Math.max(-1, projection)));
}

/**
 * Woodworth's spherical-head arrival time, relative to the centre of the head.
 *
 * In front of the ear the wave arrives early by the chord it cuts; behind it the
 * wave creeps around the sphere and arrives late by the arc it travels. The two
 * branches meet at zero exactly where the source is broadside to the ear.
 */
function earDelaySeconds(angleRadians: number): number {
	const scale = HEAD_RADIUS_METRES / SPEED_OF_SOUND_METRES_PER_SECOND;
	return angleRadians < Math.PI / 2
		? -scale * Math.cos(angleRadians)
		: scale * (angleRadians - Math.PI / 2);
}

/**
 * The Brown–Duda head-shadow shelf gain for one ear.
 *
 * Doubles at the ear itself and falls to a tenth 150° away, then rises again
 * behind the head — the bright spot a sphere really does produce.
 */
function shadowGain(angleRadians: number): number {
	const degrees = (angleRadians * 180) / Math.PI;
	const half = MINIMUM_SHADOW_GAIN / 2;
	return 1 + half + (1 - half) * Math.cos((degrees / SHADOW_MAXIMUM_DEGREES) * Math.PI);
}

/**
 * Add one source to one ear, delayed and shadowed.
 *
 * The delay is fractional and interpolated linearly, which costs a little high
 * end at large delays; the alternative is rounding to whole samples, which
 * quantizes the one cue this model most depends on.
 */
function mixShadowedEar(
	output: Float32Array,
	input: Float32Array,
	delaySamples: number,
	alpha: number,
	distanceGain: number,
	sampleRate: number,
): void {
	// Bilinear transform of H(s) = (1 + a·s/2w0) / (1 + s/2w0), w0 = c / headRadius.
	const k = sampleRate / (SPEED_OF_SOUND_METRES_PER_SECOND / HEAD_RADIUS_METRES);
	const b0 = (1 + alpha * k) / (1 + k);
	const b1 = (1 - alpha * k) / (1 + k);
	const a1 = (1 - k) / (1 + k);
	const whole = Math.floor(delaySamples);
	const fraction = delaySamples - whole;
	let previousInput = 0;
	let previousOutput = 0;
	for (let index = 0; index < output.length; index += 1) {
		const sample = sampleAt(input, index - whole) * (1 - fraction)
			+ sampleAt(input, index - whole - 1) * fraction;
		const shadowed = b0 * sample + b1 * previousInput - a1 * previousOutput;
		previousInput = sample;
		previousOutput = shadowed;
		output[index] += shadowed * distanceGain;
	}
}

function sampleAt(input: Float32Array, index: number): number {
	return index >= 0 && index < input.length ? input[index] : 0;
}
