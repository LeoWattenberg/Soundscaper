/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { m5bQualityBudgetSha256 } from './m5b-quality-pipeline.mjs';
import {
	createM5bQualityResultV2,
	validateM5bQualityMeasurementV2,
} from './m5b-quality-pipeline-v2.mjs';
import { NATIVE_OS_LAB_PROFILES_V2 } from './native-os-lab-schema.mjs';
import { deepFreeze } from './measurement-admission.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

export const M5B_QUALITY_COHORT_LAB_PROFILE_IDS_V2 = Object.freeze(
	NATIVE_OS_LAB_PROFILES_V2
		.filter(({ productId }) => productId === 'framescaper')
		.map(({ id }) => id),
);

export function createM5bQualityCohortV2(
	profileId,
	measurementsValue,
	configValue,
	budgetSha256 = m5bQualityBudgetSha256(configValue),
) {
	const measurements = snapshotStrictJsonData(measurementsValue, '5B V2 cohort measurements');
	if (!Array.isArray(measurements)
		|| measurements.length !== M5B_QUALITY_COHORT_LAB_PROFILE_IDS_V2.length
		|| Reflect.ownKeys(measurements).length !== measurements.length + 1) {
		throw new TypeError(`A 5B V2 cohort requires exactly ${M5B_QUALITY_COHORT_LAB_PROFILE_IDS_V2.length} dense profile measurements.`);
	}
	const validated = measurements.map((measurement) => (
		validateM5bQualityMeasurementV2(profileId, measurement, configValue, budgetSha256)
	));
	const profileIds = validated.map(({ labBinding }) => labBinding.profileId);
	if (new Set(profileIds).size !== M5B_QUALITY_COHORT_LAB_PROFILE_IDS_V2.length
		|| !M5B_QUALITY_COHORT_LAB_PROFILE_IDS_V2.every((id) => profileIds.includes(id))) {
		throw new TypeError('A 5B V2 cohort contains duplicate or missing lab profiles.');
	}
	if (new Set(validated.map(({ sourceRevision }) => sourceRevision)).size !== 1) {
		throw new TypeError('Every 5B V2 cohort profile must bind the same source revision.');
	}
	for (const platformId of [...new Set(validated.map((measurement) => measurement.platformId))]) {
		const rows = validated.filter((measurement) => measurement.platformId === platformId);
		const first = rows[0].labBinding;
		if (rows.some(({ labBinding }) => (
			!isDeepStrictEqual(labBinding.physicalHost, first.physicalHost)
			|| !isDeepStrictEqual(labBinding.artifacts, first.artifacts)
		))) throw new TypeError(`5B V2 cohort profiles for ${platformId} must bind one host and artifact set.`);
	}
	const ordered = M5B_QUALITY_COHORT_LAB_PROFILE_IDS_V2.map((labProfileId) => {
		const index = validated.findIndex(({ labBinding }) => labBinding.profileId === labProfileId);
		return { raw: measurements[index], validated: validated[index] };
	});
	const profiles = ordered.map(({ raw, validated: measurement }) => deepFreeze({
		...createM5bQualityResultV2(profileId, raw, configValue, budgetSha256),
		measurementSha256: createHash('sha256').update(JSON.stringify(measurement)).digest('hex'),
	}));
	const failed = profiles.some(({ status }) => status === 'failed');
	const accepted = profiles.every(({ status }) => status === 'accepted');
	const blockers = [...new Set(profiles.flatMap((profileResult) => [
		...profileResult.qualificationBlockers,
		...(profileResult.status === 'failed'
			? [`Lab profile ${profileResult.labProfileId} failed its metric gate.`]
			: []),
	]))];
	return deepFreeze({
		schemaVersion: 2,
		qualificationScope: 'complete-framescaper-profile-cohort',
		status: failed ? 'failed' : accepted ? 'accepted' : 'pending-external',
		profileId: profiles[0].profileId,
		workloadId: profiles[0].workloadId,
		fixtureId: profiles[0].fixtureId,
		environmentId: profiles[0].environmentId,
		budgetSha256,
		sourceRevision: validated[0].sourceRevision,
		labProfileIds: M5B_QUALITY_COHORT_LAB_PROFILE_IDS_V2,
		profiles,
		qualificationEvidencePublished: accepted,
		qualificationBlockers: blockers,
		evaluation: { passed: accepted, failures: blockers },
	});
}

export async function writeM5bQualityCohortV2(
	outputDirectory,
	profileId,
	measurements,
	cohortValue,
	configValue,
	budgetSha256 = m5bQualityBudgetSha256(configValue),
) {
	if (typeof outputDirectory !== 'string' || outputDirectory.length < 1
		|| outputDirectory.length > 4_096) {
		throw new TypeError('The 5B V2 cohort output directory is invalid.');
	}
	const expected = createM5bQualityCohortV2(
		profileId, measurements, configValue, budgetSha256,
	);
	const candidate = snapshotStrictJsonData(cohortValue, '5B V2 cohort');
	if (!isDeepStrictEqual(candidate, expected)) {
		throw new Error('The 5B V2 cohort does not match its recomputed profile evidence.');
	}
	const bytes = Buffer.from(`${JSON.stringify(expected, null, '\t')}\n`, 'utf8');
	const path = join(outputDirectory, `${expected.workloadId}.complete-profile.${expected.status}.json`);
	await mkdir(outputDirectory, { recursive: true });
	await writeFile(path, bytes, { flag: 'wx' });
	return Object.freeze({
		path,
		byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		cohort: expected,
	});
}
