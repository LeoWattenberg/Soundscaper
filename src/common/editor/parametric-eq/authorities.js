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

export { normalizeParametricEqSampleRate } from '../first-party-effects/parametric-eq/coefficients.ts';
