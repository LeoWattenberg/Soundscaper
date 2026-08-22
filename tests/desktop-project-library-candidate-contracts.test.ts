/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperDesktopProjectLibraryV13Handshake,
	createFramescaperDesktopProjectLibraryV13Paths,
	validateFramescaperDesktopProjectLibraryV13Handshake,
	validateFramescaperDesktopProjectLibraryV13Paths,
} from '../desktop/project-library-v13-contract.ts';
import {
	createFramescaperDesktopProjectLibraryV14Handshake,
	createFramescaperDesktopProjectLibraryV14Paths,
	validateFramescaperDesktopProjectLibraryV14Handshake,
	validateFramescaperDesktopProjectLibraryV14Paths,
} from '../desktop/project-library-v14-contract.ts';
import {
	createFramescaperDesktopProjectLibraryV15Handshake,
	createFramescaperDesktopProjectLibraryV15Paths,
	validateFramescaperDesktopProjectLibraryV15Handshake,
} from '../desktop/project-library-v15-contract.ts';
import {
	createFramescaperDesktopProjectLibraryV16Handshake,
	createFramescaperDesktopProjectLibraryV16Paths,
	validateFramescaperDesktopProjectLibraryV16Handshake,
} from '../desktop/project-library-v16-contract.ts';

test('V13 through V16 keep distinct exact handshakes, scopes, and database identities', () => {
	const contracts = [
		{
			handshake: createFramescaperDesktopProjectLibraryV13Handshake(),
			paths: createFramescaperDesktopProjectLibraryV13Paths('/var/lib/framescaper'),
			library: 13, project: 22, database: 15, scope: 'v13',
		},
		{
			handshake: createFramescaperDesktopProjectLibraryV14Handshake(),
			paths: createFramescaperDesktopProjectLibraryV14Paths('/var/lib/framescaper'),
			library: 14, project: 24, database: 16, scope: 'v14',
		},
		{
			handshake: createFramescaperDesktopProjectLibraryV15Handshake(),
			paths: createFramescaperDesktopProjectLibraryV15Paths('/var/lib/framescaper'),
			library: 15, project: 25, database: 17, scope: 'v15',
		},
		{
			handshake: createFramescaperDesktopProjectLibraryV16Handshake(),
			paths: createFramescaperDesktopProjectLibraryV16Paths('/var/lib/framescaper'),
			library: 16, project: 26, database: 18, scope: 'v16',
		},
	] as const;
	for (const contract of contracts) {
		assert.equal(contract.handshake.version, 1);
		assert.equal(contract.handshake.desktopLibrarySchemaVersion, contract.library);
		assert.equal(contract.handshake.projectSchemaVersion, contract.project);
		assert.equal(contract.handshake.desktopDatabaseUserVersion, contract.database);
		assert.deepEqual(contract.handshake.desktopLibraryScope, [
			'kw.media', 'scape-project-library', contract.scope,
		]);
		assert.match(contract.paths.libraryRoot, new RegExp(`/${contract.scope}$`, 'u'));
	}
	assert.equal(new Set(contracts.map(({ paths }) => paths.databasePath)).size, 4);
});

test('V13 and V14 validators are closed and reject adjacent generation drift', () => {
	const v13 = createFramescaperDesktopProjectLibraryV13Handshake();
	const v14 = createFramescaperDesktopProjectLibraryV14Handshake();
	assert.deepEqual(validateFramescaperDesktopProjectLibraryV13Handshake(v13), v13);
	assert.deepEqual(validateFramescaperDesktopProjectLibraryV14Handshake(v14), v14);
	assert.throws(() => validateFramescaperDesktopProjectLibraryV13Handshake(v14), /unsupported/iu);
	assert.throws(() => validateFramescaperDesktopProjectLibraryV14Handshake(v13), /unsupported/iu);
	assert.throws(() => validateFramescaperDesktopProjectLibraryV13Handshake({ ...v13, extra: true }), /fields/iu);
	assert.deepEqual(
		validateFramescaperDesktopProjectLibraryV13Paths(
			createFramescaperDesktopProjectLibraryV13Paths('/var/lib/framescaper'),
		),
		createFramescaperDesktopProjectLibraryV13Paths('/var/lib/framescaper'),
	);
	assert.deepEqual(
		validateFramescaperDesktopProjectLibraryV14Paths(
			createFramescaperDesktopProjectLibraryV14Paths('/var/lib/framescaper'),
		),
		createFramescaperDesktopProjectLibraryV14Paths('/var/lib/framescaper'),
	);
});

test('each later validator refuses the immediately preceding handshake', () => {
	assert.throws(
		() => validateFramescaperDesktopProjectLibraryV15Handshake(
			createFramescaperDesktopProjectLibraryV14Handshake(),
		),
		/unsupported/iu,
	);
	assert.throws(
		() => validateFramescaperDesktopProjectLibraryV16Handshake(
			createFramescaperDesktopProjectLibraryV15Handshake(),
		),
		/unsupported/iu,
	);
});
