/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
	createM5bQualityResult,
	m5bQualityBudgetSha256,
	validateM5bQualityMeasurement,
} from './m5b-quality-pipeline.mjs';
import { deepFreeze } from './measurement-admission.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

export const M5B_QUALITY_COHORT_PLATFORM_IDS = Object.freeze([
	'windowsX64', 'windowsArm64', 'macosArm64', 'linuxX64', 'linuxArm64',
]);

/**
 * Assemble one qualification unit. Individual collectors can accept a target,
 * but only this exact five-target cohort may publish qualification evidence.
 */
export function createM5bQualityCohort(profileId, measurementsValue, configValue) {
	const measurements = snapshotStrictJsonData(measurementsValue, '5B quality cohort measurements');
	if (!Array.isArray(measurements) || measurements.length !== M5B_QUALITY_COHORT_PLATFORM_IDS.length
		|| Reflect.ownKeys(measurements).length !== measurements.length + 1) {
		throw new TypeError('A 5B quality cohort requires exactly five dense target measurements.');
	}
	const validated = measurements.map((measurement) => (
		validateM5bQualityMeasurement(profileId, measurement, configValue)
	));
	const platforms = validated.map(({ platformId }) => platformId);
	if (new Set(platforms).size !== M5B_QUALITY_COHORT_PLATFORM_IDS.length
		|| !M5B_QUALITY_COHORT_PLATFORM_IDS.every((platformId) => platforms.includes(platformId))) {
		throw new TypeError('A 5B quality cohort contains duplicate or missing target platforms.');
	}
	const sourceRevisions = new Set(validated.map(({ sourceRevision }) => sourceRevision));
	if (sourceRevisions.size !== 1) {
		throw new TypeError('Every 5B quality cohort target must bind the same source revision.');
	}
	const ordered = M5B_QUALITY_COHORT_PLATFORM_IDS.map((platformId) => (
		validated.find((measurement) => measurement.platformId === platformId)
	));
	const targets = ordered.map((measurement) => deepFreeze({
		...createM5bQualityResult(profileId, measurement, configValue),
		measurementSha256: createHash('sha256').update(JSON.stringify(measurement)).digest('hex'),
	}));
	const failed = targets.some(({ status }) => status === 'failed');
	const accepted = targets.every(({ status }) => status === 'accepted');
	const blockers = [...new Set(targets.flatMap((target) => [
		...target.qualificationBlockers,
		...(target.status === 'failed'
			? [`Target ${target.platformId} failed its metric gate.`]
			: []),
	]))];
	return deepFreeze({
		schemaVersion: 1,
		qualificationScope: 'five-target-cohort',
		status: failed ? 'failed' : accepted ? 'accepted' : 'pending-external',
		profileId: targets[0].profileId,
		workloadId: targets[0].workloadId,
		fixtureId: targets[0].fixtureId,
		environmentId: targets[0].environmentId,
		budgetSha256: m5bQualityBudgetSha256(configValue),
		sourceRevision: validated[0].sourceRevision,
		platformIds: M5B_QUALITY_COHORT_PLATFORM_IDS,
		targets,
		qualificationEvidencePublished: accepted,
		qualificationBlockers: blockers,
		evaluation: {
			passed: accepted,
			failures: blockers,
		},
	});
}

/** Write one recomputed cohort artifact; caller-provided publication flags have no authority. */
export async function writeM5bQualityCohort(
	outputDirectoryValue,
	profileId,
	measurements,
	cohortValue,
	configValue,
) {
	if (typeof outputDirectoryValue !== 'string' || outputDirectoryValue.length < 1
		|| outputDirectoryValue.length > 4_096) {
		throw new TypeError('The 5B quality cohort output directory is invalid.');
	}
	const expected = createM5bQualityCohort(profileId, measurements, configValue);
	const candidate = snapshotStrictJsonData(cohortValue, '5B quality cohort');
	if (!isDeepStrictEqual(candidate, expected)) {
		throw new Error('The 5B quality cohort does not match its recomputed five-target evidence.');
	}
	const bytes = Buffer.from(`${JSON.stringify(expected, null, '\t')}\n`, 'utf8');
	const path = join(
		outputDirectoryValue,
		`${expected.workloadId}.five-target.${expected.status}.json`,
	);
	await mkdir(outputDirectoryValue, { recursive: true });
	await writeFile(path, bytes, { flag: 'wx' });
	return Object.freeze({ path, byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'), cohort: expected });
}
