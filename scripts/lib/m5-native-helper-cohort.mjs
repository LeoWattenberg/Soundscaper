/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { createM5NativeHelperResult } from '../collect-m5-native-helper-quality.mjs';
import { NATIVE_OS_LAB_PROFILES_V2 } from './native-os-lab-schema.mjs';
import { deepFreeze } from './measurement-admission.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';
import { qualityBudgetSha256 } from './quality-budget-config-digest.mjs';

export const M5_NATIVE_HELPER_COHORT_PROFILE_IDS_V2 = Object.freeze(
	NATIVE_OS_LAB_PROFILES_V2
		.filter(({ productId }) => productId === 'soundscaper')
		.map(({ id }) => id),
);

export function createM5NativeHelperCohort(
	measurementsValue,
	configValue,
	budgetSha256 = qualityBudgetSha256(configValue),
) {
	const measurements = snapshotStrictJsonData(measurementsValue, 'M5 native-helper cohort measurements');
	if (!Array.isArray(measurements)
		|| measurements.length !== M5_NATIVE_HELPER_COHORT_PROFILE_IDS_V2.length
		|| Reflect.ownKeys(measurements).length !== measurements.length + 1) {
		throw new TypeError(`An M5 native-helper cohort requires exactly ${M5_NATIVE_HELPER_COHORT_PROFILE_IDS_V2.length} dense profile measurements.`);
	}
	const results = measurements.map((measurement) => (
		createM5NativeHelperResult(measurement, configValue, budgetSha256)
	));
	if (results.some(({ schemaVersion }) => schemaVersion !== 2)) {
		throw new TypeError('An M5 native-helper cohort accepts schema V2 measurements only.');
	}
	const profileIds = results.map(({ observedLabBinding }) => observedLabBinding.profileId);
	if (new Set(profileIds).size !== M5_NATIVE_HELPER_COHORT_PROFILE_IDS_V2.length
		|| !M5_NATIVE_HELPER_COHORT_PROFILE_IDS_V2.every((id) => profileIds.includes(id))) {
		throw new TypeError('An M5 native-helper cohort contains duplicate or missing lab profiles.');
	}
	const sourceRevisions = new Set(results.map(({ observedLabBinding }) => (
		observedLabBinding.artifacts.sourceRevision
	)));
	if (sourceRevisions.size !== 1) {
		throw new TypeError('Every M5 native-helper cohort profile must bind the same source revision.');
	}
	if (results.some((result) => result.budgetSha256 !== budgetSha256)) {
		throw new TypeError('Every M5 native-helper cohort profile must bind the exact quality budget.');
	}
	for (const platformId of [...new Set(results.map(({ platformId }) => platformId))]) {
		const rows = results.filter((result) => result.platformId === platformId);
		const first = rows[0].observedLabBinding;
		if (rows.some(({ observedLabBinding }) => (
			!isDeepStrictEqual(observedLabBinding.physicalHost, first.physicalHost)
			|| !isDeepStrictEqual(observedLabBinding.artifacts, first.artifacts)
		))) throw new TypeError(`M5 native-helper profiles for ${platformId} must bind one host and artifact set.`);
	}
	const profiles = M5_NATIVE_HELPER_COHORT_PROFILE_IDS_V2.map((labProfileId) => {
		const index = results.findIndex(({ observedLabBinding }) => (
			observedLabBinding.profileId === labProfileId
		));
		return deepFreeze({
			...results[index],
			measurementSha256: createHash('sha256')
				.update(JSON.stringify(measurements[index])).digest('hex'),
		});
	});
	const failed = profiles.some(({ status }) => status === 'failed');
	const accepted = profiles.every(({ status }) => status === 'accepted');
	const blockers = [...new Set(profiles.flatMap((profile) => [
		...profile.qualificationBlockers,
		...(profile.status === 'failed'
			? [`Lab profile ${profile.observedLabBinding.profileId} failed its metric gate.`]
			: []),
	]))];
	return deepFreeze({
		schemaVersion: 2,
		qualificationScope: 'complete-soundscaper-audio-profile-cohort',
		status: failed ? 'failed' : accepted ? 'accepted' : 'pending-external',
		workloadId: profiles[0].workloadId,
		fixtureId: profiles[0].fixtureId,
		environmentId: profiles[0].environmentId,
		budgetSha256,
		sourceRevision: profiles[0].observedLabBinding.artifacts.sourceRevision,
		labProfileIds: M5_NATIVE_HELPER_COHORT_PROFILE_IDS_V2,
		profiles,
		qualificationEvidencePublished: accepted,
		qualificationBlockers: blockers,
		evaluation: { passed: accepted, failures: blockers },
	});
}

export async function writeM5NativeHelperCohort(
	outputDirectory,
	measurements,
	cohortValue,
	configValue,
	budgetSha256 = qualityBudgetSha256(configValue),
) {
	if (typeof outputDirectory !== 'string' || outputDirectory.length < 1
		|| outputDirectory.length > 4_096) {
		throw new TypeError('The M5 native-helper cohort output directory is invalid.');
	}
	const expected = createM5NativeHelperCohort(measurements, configValue, budgetSha256);
	const candidate = snapshotStrictJsonData(cohortValue, 'M5 native-helper cohort');
	if (!isDeepStrictEqual(candidate, expected)) {
		throw new Error('The M5 native-helper cohort does not match its recomputed profile evidence.');
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
