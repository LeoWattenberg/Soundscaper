/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const config = JSON.parse(await readFile(
	new URL('../config/quality-budgets.json', import.meta.url), 'utf8',
)) as Record<string, unknown>;

test('quality budgets describe diagnostics without release qualification state', () => {
	assert.deepEqual(Object.keys(config), [
		'schemaVersion', 'groundedAt', 'offlineCacheNarrative', 'measurementPolicy',
		'units', 'softwareInputs', 'environments', 'fixtures', 'workloads',
	]);
	const serialized = JSON.stringify(config);
	assert.doesNotMatch(serialized, /qualif/iu);
	assert.doesNotMatch(serialized, /qualifiedWorkloadIds|acceptedResultCohorts|qualificationEligible|qualificationBasis|qualificationEvidencePublished/u);
	assert.doesNotMatch(serialized, /release-qualification-matrix|soundscaper-stable-1-release-matrix/u);
	assert.doesNotMatch(serialized, /native-os-lab-matrix|capture-os-browser-lab-matrix|framescaper-web-vcr-runtime-matrix/u);
	assert.doesNotMatch(serialized, /humanReviewBlocks|soak-cohorts|"cohorts"|ofx\.unqualifiedTargets/u);
});

test('diagnostic environments and workloads retain runnable measurements and thresholds', () => {
	const environments = config.environments as Array<Record<string, unknown>>;
	const fixtures = config.fixtures as Array<Record<string, unknown>>;
	const workloads = config.workloads as Array<Record<string, unknown>>;
	assert.ok(environments.length > 0);
	assert.ok(fixtures.length > 0);
	assert.ok(workloads.length > 0);
	assert.equal(new Set(environments.map(({ id }) => id)).size, environments.length);
	assert.equal(new Set(fixtures.map(({ id }) => id)).size, fixtures.length);
	assert.equal(new Set(workloads.map(({ id }) => id)).size, workloads.length);
	for (const workload of workloads) {
		assert.ok(Array.isArray(workload.fixtureIds) && workload.fixtureIds.length > 0, String(workload.id));
		assert.ok(Array.isArray(workload.thresholds) && workload.thresholds.length > 0, String(workload.id));
		assert.match(String(workload.status), /^(?:active|planned|optional|blocked)$/u);
	}
});
