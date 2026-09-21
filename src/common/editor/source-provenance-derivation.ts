/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	copySourceProvenance,
	mergeSourceProvenance,
	normalizeSourceProvenance,
	type SourceProvenanceV1,
} from './source-provenance.ts';

export const INCOMPLETE_DERIVED_ATTRIBUTION_WARNING =
	'This derived source also contains one or more inputs whose attribution is unavailable because they predate provenance tracking.';

export interface SourceProvenanceCarrier {
	readonly provenance?: SourceProvenanceV1;
}

/**
 * Carry every known import contribution into a newly rendered source.
 *
 * An absent value means the inputs predate provenance tracking. A present
 * value, including a generated or recorded root with no contributions, marks
 * the output as a deliberate derived-media result.
 */
export function deriveSourceProvenance(
	inputs: readonly SourceProvenanceCarrier[],
): SourceProvenanceV1 | undefined {
	let hasUntrackedInput = false;
	const values = inputs.flatMap(({ provenance }) => {
		const copy = copySourceProvenance(provenance);
		if (!copy) hasUntrackedInput = true;
		return copy ? [copy] : [];
	});
	if (!values.length) return undefined;
	const merged = mergeSourceProvenance(values);
	const contribution = merged.contributions[0];
	if (!hasUntrackedInput || !contribution
		|| contribution.warnings.includes(INCOMPLETE_DERIVED_ATTRIBUTION_WARNING)) return merged;
	return normalizeSourceProvenance({
		...merged,
		contributions: [{
			...contribution,
			warnings: [...contribution.warnings, INCOMPLETE_DERIVED_ATTRIBUTION_WARNING],
		}, ...merged.contributions.slice(1)],
	});
}
