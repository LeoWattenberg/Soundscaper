/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SCAPE_FORMAT_VERSION } from '../src/common/editor/scape-project.js';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);

test('project compatibility policy matches both maintained family-v1 schemas and Scape v1', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));

	assert.equal(policy.schemaVersion, 1);
	assert.deepEqual(
		policy.projectSchema.baselines.map(({ schemaFamily, currentVersion,
			minimumReadableVersion, retainedMigrationSources }) => ({
			schemaFamily, currentVersion, minimumReadableVersion, retainedMigrationSources,
		})),
		[
			{ schemaFamily: 'soundscaper', currentVersion: 1, minimumReadableVersion: 1, retainedMigrationSources: [] },
			{ schemaFamily: 'framescaper', currentVersion: 1, minimumReadableVersion: 1, retainedMigrationSources: [] },
		],
	);
	assert.equal(policy.projectSchema.futureMigrationPolicy,
		'every-supported-successor-must-migrate-from-family-v1');
	assert.equal(policy.portableArchive.currentFormatVersion, SCAPE_FORMAT_VERSION);
	assert.deepEqual(policy.portableArchive.advertisedFormatVersions, [1]);
	assert.deepEqual(policy.portableArchive.manifestProjectIdentity, ['schemaFamily', 'schemaVersion']);
	assert.equal(policy.portableArchive.futureFormatBehavior, 'reject-before-persistence');
	assert.equal(
		policy.portableArchive.roundTripGuarantee,
		'current-schema-semantic-plus-bounded-tagged-binary-not-byte-identical',
	);
});

test('baseline storage and desktop identities are exact and predecessor-free', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const [soundscaper, framescaper] = policy.projectSchema.baselines;

	assert.deepEqual(soundscaper, {
		schemaFamily: 'soundscaper', currentVersion: 1, minimumReadableVersion: 1,
		retainedMigrationSources: [], futureMigrationFloorVersion: 1,
		browserDatabase: 'kw-media-soundscaper-editor-v1',
		desktopLibraryRoot: 'kw.media/soundscaper-project-library/v1',
		desktopLibrarySchemaVersion: 1, sqliteUserVersion: 1,
		ipcNamespace: 'soundscaper:v1:project-library:*',
	});
	assert.deepEqual(framescaper, {
		schemaFamily: 'framescaper', currentVersion: 1, minimumReadableVersion: 1,
		retainedMigrationSources: [], futureMigrationFloorVersion: 1,
		browserDatabase: 'kw-media-framescaper-editor-v1',
		desktopLibraryRoot: 'kw.media/framescaper-project-library/v1',
		desktopLibrarySchemaVersion: 1, sqliteUserVersion: 1,
		ipcNamespace: 'framescaper:v1:project-library:*',
	});
	assert.match(policy.historicalPreReleaseLineage.status, /provenance-only.*not-readable.*not-migrated/iu);
});
