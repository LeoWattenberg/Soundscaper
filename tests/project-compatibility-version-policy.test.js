/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';
import { SCAPE_FORMAT_VERSION } from '../src/common/editor/scape-project.js';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);

test('project compatibility policy matches the maintained schema and archive format', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));

	assert.equal(policy.schemaVersion, 1);
	assert.equal(policy.projectSchema.currentVersion, AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION);
	assert.equal(policy.projectSchema.minimumReadableVersion, AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION);
	assert.deepEqual(policy.projectSchema.retainedMigrationSources, []);
	assert.equal(policy.portableArchive.currentFormatVersion, SCAPE_FORMAT_VERSION);
	assert.equal(policy.portableArchive.futureFormatBehavior, 'reject-before-persistence');
	assert.equal(
		policy.portableArchive.roundTripGuarantee,
		'current-schema-semantic-plus-bounded-tagged-binary-not-byte-identical',
	);
});

test('Framescaper revision identities select V28 and keep dormant candidates inert', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const contract = policy.framescaperRevisionContract;
	assert.deepEqual(contract.selected, {
		browserProjectVersion: 28,
		desktopProjectVersion: 28,
		status: 'selected-milestone-5-software-complete-not-qualified',
	});
	assert.deepEqual(contract.historicalReimportPolicy, {
		projectVersions: [27],
		desktopLibraryVersion: 18,
		behavior: 'explicit-validated-reimport-creates-v28-source-remains-immutable',
	});
	assert.deepEqual(contract.desktopLibraryImport, {
		sourceLibraryVersion: 18,
		sourceSqliteUserVersion: 20,
		sourceScope: 'v18',
		targetLibraryVersion: 19,
		targetSqliteUserVersion: 21,
		targetScope: 'v19',
		behavior: 'idempotent-crash-resumable-copy-forward-source-immutable',
	});
	assert.deepEqual(contract.dormantCandidateCustody, {
		minimumProjectVersion: 25,
		maximumProjectVersion: 26,
		candidateProjectVersions: [25, 26],
		unownedProjectVersions: [],
		selectedV28Behavior: 'opaque-read-only-no-candidate-validation-migration-authoring-or-overwrite',
		candidateBehavior: 'exact-version-only-authenticated-dormant-profile',
		custodyBehavior: 'preserve-opaque-read-only-no-activation-native-authority-or-release-qualification',
		capabilityBehavior: 'known-unavailable-default-off',
	});
	assert.deepEqual(contract.revisions, [
		[19, 11, 13, 'v11', 5, [8], 'reserved-dormant-boundary'],
		[20, 17, 19, 'v17', 6, [7, 8], 'maintained-explicit-reimport-source'],
		[22, 13, 15, 'v13', 7, [9], 'maintained-explicit-reimport-source'],
		[24, 14, 16, 'v14', 8, [10], 'maintained-explicit-reimport-source'],
		[25, 15, 17, 'v15', 9, [11], 'dormant-professional-media-candidate'],
		[26, 16, 18, 'v16', 10, [12], 'dormant-openfx-candidate'],
		[27, 18, 20, 'v18', 11, [13], 'maintained-explicit-reimport-source'],
		[28, 19, 21, 'v19', 12, [14], 'selected-milestone-5-software-complete-not-qualified'],
	].map(([projectVersion, desktopLibraryVersion, sqliteUserVersion, scope,
		clipboardVersion, renderPlanVersions, status]) => ({
		projectVersion, desktopLibraryVersion, sqliteUserVersion, scope,
		clipboardVersion, renderPlanVersions, status,
	})));
	assert.match(contract.futureSchemaBehavior, /opaque-read-only.*known.*unavailable/iu);
	const custody = policy.rules.find(({ id }) => id === 'framescaper-v22-v26-compatibility-custody');
	assert.ok(custody);
	assert.equal(custody.status, 'implemented');
	assert.match(custody.requiredOutcome, /V22 through V27.*custody.*V28.*V25\/V26/iu);
	assert.match(custody.currentBehavior, /V28.*explicitly reimports.*V27.*V25 and V26.*opaque read-only/iu);
	assert.match(custody.currentBehavior, /default-off/iu);
});
