/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryUrl = new URL('../', import.meta.url);
const IMPLEMENTATION_COMMIT = '573579b65852148d121e8f73046c57700ac93757';
const IMPLEMENTATION_TIMESTAMP = '2026-08-28T18:34:28+02:00';

async function json(path) {
	return JSON.parse(await readFile(new URL(path, repositoryUrl), 'utf8'));
}

async function text(path) {
	return readFile(new URL(path, repositoryUrl), 'utf8');
}

test('WP-9.0.0 freezes exactly two independent family-v1 project baselines', async () => {
	const compatibility = await json('config/project-compatibility.json');
	const decision = compatibility.baselineDecision;

	assert.equal(compatibility.releaseCandidate, '1.0.0-rc.1');
	assert.deepEqual(
		compatibility.projectSchema.baselines.map(({ schemaFamily, currentVersion,
			minimumReadableVersion, retainedMigrationSources, futureMigrationFloorVersion }) => ({
			schemaFamily, currentVersion, minimumReadableVersion,
			retainedMigrationSources, futureMigrationFloorVersion,
		})),
		[
			{
				schemaFamily: 'soundscaper', currentVersion: 1, minimumReadableVersion: 1,
				retainedMigrationSources: [], futureMigrationFloorVersion: 1,
			},
			{
				schemaFamily: 'framescaper', currentVersion: 1, minimumReadableVersion: 1,
				retainedMigrationSources: [], futureMigrationFloorVersion: 1,
			},
		],
	);
	assert.equal(
		compatibility.projectSchema.futureMigrationPolicy,
		'every-supported-successor-must-migrate-from-family-v1',
	);
	assert.deepEqual(compatibility.historicalPreReleaseLineage.retainedMigrationSources, []);
	assert.equal(decision.workPackage, 'WP-9.0.0');
	assert.equal(Object.hasOwn(decision, 'status'), false);
	assert.equal(Object.hasOwn(decision, 'approver'), false);
	assert.equal(Object.hasOwn(decision, 'decisionDate'), false);
	assert.equal(decision.commit, IMPLEMENTATION_COMMIT);
	assert.equal(decision.commitTimestamp, IMPLEMENTATION_TIMESTAMP);
	assert.equal(decision.releaseDecision, 'repository-owner-on-v1.0.0-tag');
	assert.equal(decision.stableReleaseAdmission, undefined);
});

test('capability and security registers carry the same RC identities without admission state', async () => {
	const capabilities = await json('config/production-capabilities.json');
	const security = await json('config/production-security-matrix.json');
	const expected = [
		{ schemaFamily: 'soundscaper', schemaVersion: 1 },
		{ schemaFamily: 'framescaper', schemaVersion: 1 },
	];

	assert.deepEqual(
		capabilities.projectSchemaBaselines.map(({ schemaFamily, schemaVersion }) => ({
			schemaFamily, schemaVersion,
		})),
		expected,
	);
	for (const baseline of capabilities.projectSchemaBaselines) {
		assert.deepEqual(baseline.scapeFormatVersions, [1]);
		assert.equal(baseline.attachedScapeFormatVersion, 1);
	}
	assert.deepEqual(security.projectIdentityBaseline.identities, expected);
	assert.equal(security.projectIdentityBaseline.archiveFormatVersion, 1);
	assert.doesNotMatch(JSON.stringify(capabilities.productVersions), /admission/iu);
	assert.doesNotMatch(JSON.stringify(security.productVersions), /admission/iu);
});

test('the decision and release guidance preserve the freeze and point to owner QA', async () => {
	const [decision, soundscaperQa, framescaperQa, release] = await Promise.all([
		text('docs/wp-9.0.0-baseline-decision.md'),
		text('docs/qa/soundscaper.md'),
		text('docs/qa/framescaper.md'),
		text('docs/release-policy.md'),
	]);

	assert.match(decision, /Leo Wattenberg/u);
	assert.ok(decision.includes(IMPLEMENTATION_COMMIT));
	assert.ok(decision.includes(IMPLEMENTATION_TIMESTAMP));
	assert.match(decision, /exactly two independent/u);
	assert.match(decision, /historical/iu);
	assert.match(soundscaperQa, /owner-operated checklist/iu);
	assert.match(framescaperQa, /owner-operated checklist/iu);
	assert.match(release, /pushing the stable tag is the owner's\s+release decision/iu);
	assert.match(release, /release:soundscaper:prepare/iu);
	assert.match(release, /Framescaper keeps its independent tag namespace/iu);
});
