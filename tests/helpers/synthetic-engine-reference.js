/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The JavaScript half of the synthetic engine's deterministic reference.
 *
 * The engine's header says a JavaScript verifier recomputes its samples with
 * the same integer operations, and the addon exports `expectedSyntheticSample`
 * for exactly that comparison. This is that verifier: it shares no code with
 * the addon, so a change to the C mixer that also changed the addon's own
 * comparison function still fails here.
 *
 * Every step is integer arithmetic on 32-bit lanes — `Math.imul` for the
 * multiplies, `>>>` for the shifts — because the point of an integer mixer is
 * that the reference is bit-exact on every target rather than close enough.
 */

/** Mirrors the modes the addon admits; the numbers are the C enum's own. */
export const SYNTHETIC_MODES = Object.freeze({
	passthrough: 0,
	gain: 1,
	tone: 2,
	impulse: 3,
});

function mix32(value) {
	let mixed = value >>> 0;
	mixed = (mixed ^ (mixed >>> 16)) >>> 0;
	mixed = Math.imul(mixed, 0x7feb352d) >>> 0;
	mixed = (mixed ^ (mixed >>> 15)) >>> 0;
	mixed = Math.imul(mixed, 0x846ca68b) >>> 0;
	mixed = (mixed ^ (mixed >>> 16)) >>> 0;
	return mixed;
}

/** The (generation, channel, frame) hash the tone mode renders. */
export function deterministicSample(generation, channel, frame) {
	if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError('A frame index must be a non-negative safe integer.');
	const low = frame % 4_294_967_296 >>> 0;
	const high = Math.floor(frame / 4_294_967_296) >>> 0;
	const seeded = mix32((Math.imul(generation, 2_654_435_761) + channel) >>> 0);
	const hashed = mix32((low ^ mix32((high ^ seeded) >>> 0)) >>> 0);
	// The C maps to [-1, 1) by dividing the signed value by 2^31, which is exact
	// in both languages because the divisor is a power of two.
	return Math.fround((hashed | 0) / 2_147_483_648);
}

/** The sample the engine must produce for one channel and frame in one mode. */
export function expectedSyntheticSample({ generation, mode }, channel, frame) {
	switch (mode) {
	case SYNTHETIC_MODES.tone:
		return deterministicSample(generation, channel, frame);
	case SYNTHETIC_MODES.impulse:
		return frame === 0 ? 1 : 0;
	default:
		return 0;
	}
}
