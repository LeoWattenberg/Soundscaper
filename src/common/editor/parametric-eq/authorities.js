/* SPDX-License-Identifier: AGPL-3.0-only */

/** Preserve designed-section order while grouping adjacent sections from one semantic band. */
export function groupParametricEqSections(sections) {
	const groups = [];
	for (const section of sections) {
		const previous = groups[groups.length - 1];
		if (previous?.[0]?.bandId === section.bandId) previous.push(section);
		else groups.push([section]);
	}
	return groups;
}

/** Normalize the shared floating-point sample-rate contract used by JS EQ paths. */
export function normalizeParametricEqSampleRate(value) {
	const sampleRate = Number(value);
	if (!Number.isFinite(sampleRate) || sampleRate < 8_000 || sampleRate > 768_000) {
		throw new RangeError('Parametric EQ sample rate must be between 8,000 and 768,000 Hz.');
	}
	return sampleRate;
}
