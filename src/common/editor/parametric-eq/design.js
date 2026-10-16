/*
 * Double-precision parametric EQ section design.
 *
 * Bells and cut filters follow Martin Vicanek's matched-second-order method:
 * analog poles are impulse-invariant and numerator coefficients are fitted in
 * the digital domain. Shelves use his matched two-pole Butterworth equations.
 * The resulting transfer functions are realized with Cytomic's input-mixing,
 * trapezoidal-integrated SVF rather than a direct-form recurrence.
 */

import { packParametricEqParams } from './parameters.js';
import { designBandSections, designAuditionSection, biquadToTpt, normalizeParametricEqSampleRate as normalizeSampleRate } from '../first-party-effects/parametric-eq/coefficients.ts';
export { designBandSections, designMatchedSection, designMatchedShelf, biquadToTpt, sectionMagnitudeSquared } from '../first-party-effects/parametric-eq/coefficients.ts';

export function designParametricEq(params, sampleRate, options = {}) {
	const rate = normalizeSampleRate(sampleRate);
	const packet = packParametricEqParams(params, options.effectId);
	const auditionBandId = options.auditionBandId == null ? null : String(options.auditionBandId);
	const sections = [];
	for (const band of packet.bands) {
		if (auditionBandId != null && band.id !== auditionBandId) continue;
		const coefficients = auditionBandId == null
			? designBandSections(band, rate)
			: [designAuditionSection(band, rate)];
		for (let index = 0; index < coefficients.length; index += 1) {
			const coefficient = coefficients[index];
			const neutralGainBand = (band.type === 'peaking'
				|| band.type === 'lowshelf'
				|| band.type === 'highshelf')
				&& band.gainDb === 0;
			sections.push({
				bandId: band.id,
				bandType: band.type,
				// A neutral gain band still runs and keeps its state warm, but its
				// dry path is selected exactly so 0 dB is bit-transparent.
				bandEnabled: auditionBandId == null ? band.enabled : true,
				bandWet: auditionBandId == null ? band.enabled && !neutralGainBand : true,
				sectionIndex: index,
				coefficients: coefficient,
				tpt: biquadToTpt(coefficient),
			});
		}
	}
	return {
		packet,
		sampleRate: rate,
		auditionBandId,
		sections,
		outputGain: auditionBandId == null ? 10 ** (packet.outputGainDb / 20) : 1,
		outputGainDb: auditionBandId == null ? packet.outputGainDb : 0,
		topologyKey: sections.map((section) => `${section.bandId}:${section.bandType}:${section.sectionIndex}`).join('|'),
	};
}
