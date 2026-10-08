/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { evaluateQualityWorkload, qualityFixture, workloadThresholds } from '../scripts/lib/quality-budget-config.mjs';
import { PHOTO_LARGE_LIBRARY_SPECIFICATION_V1 as SPEC } from '../src/lightscaper/quality/large-library-workload-v1.ts';

const config: unknown = JSON.parse(await readFile(new URL('../config/quality-budgets.json', import.meta.url), 'utf8'));
const workload = 'l3-photo-library-large';
const metrics = {
	'photoLibrary.resultMismatchCount': 0,
	'photoLibrary.originalDigestMismatchCount': 0,
	'photoLibrary.maximumRenderedPhotos': 64,
	'photoLibrary.maximumPublishedBatchPhotos': 16,
	'photoLibrary.maximumCandidatePhotos': 64,
	'photoLibrary.importP95Ms': 1,
	'photoLibrary.scrollFrameIntervalP95Ms': 1,
	'photoLibrary.filterP95Ms': 1,
	'photoLibrary.searchP95Ms': 1,
};

test('the quality register binds the executable large-library fixture and production batch/page bounds', () => {
	const fixture = qualityFixture(config, SPEC.id) as { specification: Record<string, unknown>; limitation: string };
	for (const [key, value] of Object.entries(SPEC)) if (key !== 'id') assert.equal(fixture.specification[key], value, key);
	assert.match(fixture.limitation, /catalog scaling/u); assert.match(fixture.limitation, /large-image decoding/u);
	assert.equal(evaluateQualityWorkload(config, workload, metrics).passed, true);
});

test('large-library correctness and bounded working sets block independently of observational timing', () => {
	const thresholds = workloadThresholds(config, workload) as Array<{ metricId: string; behavior: string }>;
	assert.deepEqual(thresholds.filter(metric => metric.behavior === 'observational').map(metric => metric.metricId), [
		'photoLibrary.importP95Ms', 'photoLibrary.scrollFrameIntervalP95Ms', 'photoLibrary.filterP95Ms', 'photoLibrary.searchP95Ms',
	]);
	for (const [key, value] of [['photoLibrary.resultMismatchCount', 1], ['photoLibrary.originalDigestMismatchCount', 1],
		['photoLibrary.maximumRenderedPhotos', 65], ['photoLibrary.maximumPublishedBatchPhotos', 17], ['photoLibrary.maximumCandidatePhotos', 65]] as const) {
		const failed = evaluateQualityWorkload(config, workload, { ...metrics, [key]: value });
		assert.equal(failed.passed, false); assert.equal(failed.failures.length, 1);
	}
	const slow = evaluateQualityWorkload(config, workload, { ...metrics, 'photoLibrary.importP95Ms': 100_001,
		'photoLibrary.scrollFrameIntervalP95Ms': 1_001, 'photoLibrary.filterP95Ms': 10_001, 'photoLibrary.searchP95Ms': 50_001 });
	assert.equal(slow.passed, true); assert.equal(slow.warnings.length, 4);
	assert.equal(evaluateQualityWorkload(config, workload, { ...metrics, 'photoLibrary.searchP95Ms': NaN }).passed, false);
});
