/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const config = JSON.parse(await readFile(
	new URL('../config/quality-budgets.json', import.meta.url), 'utf8',
)) as Record<string, unknown>;

test('quality budgets describe diagnostics without release or lab state', () => {
	assert.deepEqual(Object.keys(config), [
		'schemaVersion', 'fixtures', 'measurements', 'thresholds', 'workloads',
	]);
	const serialized = JSON.stringify(config);
	assert.doesNotMatch(serialized, /qualifiedWorkloadIds|acceptedResultCohorts|qualificationEligible|activationGate/u);
	assert.doesNotMatch(serialized, /environmentIds|softwareInputs|measurementPolicy|passRatio|defectRate/u);
	assert.doesNotMatch(serialized, /owner-windows-x64-rtx3090-01|RTX 3090|capture-device-matrix/iu);
});

test('measurements and workloads explicitly state blocking or observational behavior', () => {
	const measurements = config.measurements as Array<Record<string, unknown>>;
	const workloads = config.workloads as Array<Record<string, unknown>>;
	assert.ok(measurements.length > 0);
	assert.ok(workloads.length > 0);
	for (const entry of [...measurements, ...workloads]) {
		assert.match(String(entry.behavior), /^(?:blocking|observational)$/u);
	}
});
