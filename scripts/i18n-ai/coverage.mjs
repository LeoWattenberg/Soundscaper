/* SPDX-License-Identifier: AGPL-3.0-only */

import { ENGLISH_COPY } from '../../src/common/i18n/catalogs.js';

const LEGACY_KEYS = new Set(Object.keys(ENGLISH_COPY));

/** Keep the existing catalog completeness obligation distinct from new English fallback. */
export function editorTranslationCoverage(assessment, englishCopy, excludedKeys) {
	const excluded = new Set(excludedKeys);
	const coverage = {
		legacy: { total: 0, excluded: 0, current: 0, stale: 0, missing: 0 },
		additional: { total: 0, excluded: 0, current: 0, stale: 0, missing: 0 },
	};
	const scope = key => LEGACY_KEYS.has(key) ? coverage.legacy : coverage.additional;
	for (const key of Object.keys(englishCopy)) {
		scope(key).total += 1;
		if (excluded.has(key)) scope(key).excluded += 1;
	}
	for (const key of Object.keys(assessment.current)) scope(key).current += 1;
	for (const key of assessment.stale) scope(key).stale += 1;
	for (const key of assessment.missing) scope(key).missing += 1;
	return Object.freeze({ legacy: Object.freeze(coverage.legacy), additional: Object.freeze(coverage.additional) });
}
