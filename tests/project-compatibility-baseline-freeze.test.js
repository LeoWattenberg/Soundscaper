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
	assert.equal(decision.approver, 'Leo Wattenberg');
	assert.equal(decision.decisionDate, '2026-08-28');
	assert.equal(decision.commit, IMPLEMENTATION_COMMIT);
	assert.equal(decision.commitTimestamp, IMPLEMENTATION_TIMESTAMP);
	assert.match(decision.stableReleaseAdmission, /^blocked-/u);
});

test('capability and security registers carry the same RC identities without admitting stable 1.0', async () => {
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
	assert.match(capabilities.releaseCandidate.stable1Admission, /^blocked-/u);
	assert.match(security.releaseCandidate.stable1Admission, /^blocked-/u);
});

test('the decision and release guidance record the freeze while every stable row stays pending', async () => {
	const [decision, guided, release] = await Promise.all([
		text('docs/wp-9.0.0-baseline-decision.md'),
		text('docs/milestone-9-guided-verification.md'),
		text('docs/release-policy.md'),
	]);

	assert.match(decision, /Leo Wattenberg/u);
	assert.ok(decision.includes(IMPLEMENTATION_COMMIT));
	assert.ok(decision.includes(IMPLEMENTATION_TIMESTAMP));
	assert.match(decision, /exactly two independent/u);
	assert.match(decision, /stable 1\.0 admission remains\s+blocked/iu);
	const releaseRows = guided.split('\n').filter((line) => /^\| REL-\d{2} \|/u.test(line));
	assert.equal(releaseRows.length, 14);
	for (const row of releaseRows) assert.match(row, /\| pending \| pending \|/u);
	assert.match(release, /`1\.0\.0-rc\.1`/u);
	assert.match(release, /Soundscaper-only `v1\.0\.0` workflow is supported only after/iu);
	assert.match(release, /Framescaper retains its separate[\s\S]*deferred from Soundscaper Stable 1\.0/iu);
});
