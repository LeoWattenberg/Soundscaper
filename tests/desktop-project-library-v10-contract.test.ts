/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import test from 'node:test';

import {
	DESKTOP_PROJECT_LIBRARY_V10_APPLICATION_ID,
	DESKTOP_PROJECT_LIBRARY_V10_DATABASE_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION,
	createFramescaperDesktopProjectLibraryV10Handshake,
	createFramescaperDesktopProjectLibraryV10Paths,
	validateFramescaperDesktopProjectLibraryV10Handshake,
	validateFramescaperDesktopProjectLibraryV10Owner,
} from '../desktop/project-library-v10-contract.ts';
import {
	FRAMESCAPER_DESKTOP_LIBRARY_PROXY_MEDIA_ENCODING,
	createFramescaperDesktopLibraryProxyMediaBinding,
	isFramescaperDesktopLibraryProxyMediaBindingId,
	proxyRelativeFileForFramescaperDesktopLibraryBinding,
} from '../desktop/project-library-v10-media-binding.ts';
import {
	DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
	DESKTOP_LIBRARY_SCHEMA_VERSION,
	createDesktopProjectLibraryPaths,
} from '../desktop/project-library-contract.ts';
import {
	DESKTOP_PROJECT_LIBRARY_APPLICATION_ID,
	DESKTOP_PROJECT_LIBRARY_DATABASE_VERSION,
} from '../desktop/project-library-database.ts';

const ROOT = resolve(import.meta.dirname, '..');
const DIGEST = 'a'.repeat(64);

test('reserves a physically separate exact Framescaper V10 desktop identity', () => {
	assert.equal(FRAMESCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION, 10);
	assert.equal(FRAMESCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION, 18);
	assert.equal(DESKTOP_PROJECT_LIBRARY_V10_DATABASE_VERSION, 12);
	assert.notEqual(FRAMESCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION, DESKTOP_LIBRARY_SCHEMA_VERSION);
	assert.notEqual(FRAMESCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION, DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION);
	assert.notEqual(DESKTOP_PROJECT_LIBRARY_V10_DATABASE_VERSION, DESKTOP_PROJECT_LIBRARY_DATABASE_VERSION);
	assert.notEqual(DESKTOP_PROJECT_LIBRARY_V10_APPLICATION_ID, DESKTOP_PROJECT_LIBRARY_APPLICATION_ID);

	const root = resolve('/tmp/framescaper-v10-contract');
	const paths = createFramescaperDesktopProjectLibraryV10Paths(root);
	const legacy = createDesktopProjectLibraryPaths(root);
	assert.equal(isAbsolute(paths.libraryRoot), true);
	assert.equal(relative(root, paths.libraryRoot), join('kw.media', 'scape-project-library', 'v10'));
	assert.equal(relative(paths.libraryRoot, paths.databasePath), 'library.sqlite3');
	assert.equal(relative(paths.libraryRoot, paths.projectsRoot), 'projects');
	assert.equal(relative(paths.libraryRoot, paths.managedMediaRoot), 'media');
	assert.notEqual(paths.libraryRoot, legacy.libraryRoot);
	assert.equal(Object.isFrozen(paths), true);
	assert.throws(() => createFramescaperDesktopProjectLibraryV10Paths('relative'), /absolute/iu);
});

test('admits only a closed Framescaper owner', () => {
	const owner = validateFramescaperDesktopProjectLibraryV10Owner({
		product: 'framescaper', processId: 42, instanceId: 'framescaper-v10-owner',
	});
	assert.deepEqual(owner, {
		product: 'framescaper', processId: 42, instanceId: 'framescaper-v10-owner',
	});
	assert.equal(Object.isFrozen(owner), true);
	for (const value of [
		{ ...owner, product: 'soundscaper' },
		{ ...owner, product: 'framescaper', extra: true },
		{ product: 'framescaper', processId: 42 },
	]) assert.throws(() => validateFramescaperDesktopProjectLibraryV10Owner(value), TypeError);
});

test('creates and validates one closed exact V10 cross-realm handshake', () => {
	const handshake = createFramescaperDesktopProjectLibraryV10Handshake();
	assert.deepEqual(handshake, {
		kind: 'framescaper-project-library-handshake',
		version: 1,
		owner: 'framescaper',
		projectSchemaVersion: 18,
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		storageDatabaseName: 'kw-media-framescaper-editor-v18',
		desktopLibrarySchemaVersion: 10,
		desktopDatabaseUserVersion: 12,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v10'],
	});
	assert.equal(Object.isFrozen(handshake), true);
	assert.equal(Object.isFrozen(handshake.scapeFormatVersions), true);
	assert.equal(Object.isFrozen(handshake.desktopLibraryScope), true);
	assert.notEqual(createFramescaperDesktopProjectLibraryV10Handshake(), handshake);
	const validated = validateFramescaperDesktopProjectLibraryV10Handshake({
		...handshake,
		scapeFormatVersions: [...handshake.scapeFormatVersions],
		desktopLibraryScope: [...handshake.desktopLibraryScope],
	});
	assert.deepEqual(validated, handshake);
	assert.notEqual(validated, handshake);
	for (const replacement of [
		{ owner: 'soundscaper' },
		{ projectSchemaVersion: 17 },
		{ scapeFormatVersions: [1] },
		{ attachedScapeFormatVersion: 1 },
		{ storageDatabaseName: 'kw-media-audio-editor' },
		{ desktopLibrarySchemaVersion: 9 },
		{ desktopDatabaseUserVersion: 11 },
		{ desktopLibraryScope: ['kw.media', 'scape-project-library', 'v9'] },
	]) assert.throws(
		() => validateFramescaperDesktopProjectLibraryV10Handshake({ ...handshake, ...replacement }),
		TypeError,
	);
	assert.throws(
		() => validateFramescaperDesktopProjectLibraryV10Handshake({ ...handshake, extra: true }),
		TypeError,
	);
});

test('derives the exact V10 proxy binding and portable proxy path', () => {
	assert.equal(FRAMESCAPER_DESKTOP_LIBRARY_PROXY_MEDIA_ENCODING, 'video-proxy-v1');
	const binding = createFramescaperDesktopLibraryProxyMediaBinding(
		'project-v18', 'video-proxy-sha256:abc', 7, DIGEST,
	);
	assert.match(binding.id, /^p[a-f0-9]{64}$/u);
	assert.equal(binding.relativeFile, `proxy/${binding.id.slice(1, 3)}/${binding.id}.bin`);
	assert.equal(binding.category, 'proxy');
	assert.equal(Object.isFrozen(binding), true);
	assert.equal(isFramescaperDesktopLibraryProxyMediaBindingId(binding.id), true);
	assert.equal(proxyRelativeFileForFramescaperDesktopLibraryBinding(binding.id), binding.relativeFile);
	assert.deepEqual(
		createFramescaperDesktopLibraryProxyMediaBinding(
			'project-v18', 'video-proxy-sha256:abc', 7, DIGEST,
		),
		binding,
	);
	for (const value of [`m${DIGEST}`, `v${DIGEST}`, `t${DIGEST}`, `p${'A'.repeat(64)}`, 'p']) {
		assert.equal(isFramescaperDesktopLibraryProxyMediaBindingId(value), false);
		assert.throws(() => proxyRelativeFileForFramescaperDesktopLibraryBinding(value), TypeError);
	}
	assert.throws(
		() => createFramescaperDesktopLibraryProxyMediaBinding('', 'key', 0, DIGEST),
		/non-empty/iu,
	);
	assert.throws(
		() => createFramescaperDesktopLibraryProxyMediaBinding('project-v18', 'key', -1, DIGEST),
		/non-negative/iu,
	);
	assert.throws(
		() => createFramescaperDesktopLibraryProxyMediaBinding('project-v18', 'key', 0, 'A'.repeat(64)),
		/digest/iu,
	);
});

test('keeps the V10 foundation dormant and the V9 owners textually unchanged', async () => {
	const contract = await readFile(resolve(ROOT, 'desktop/project-library-v10-contract.ts'), 'utf8');
	const binding = await readFile(resolve(ROOT, 'desktop/project-library-v10-media-binding.ts'), 'utf8');
	for (const source of [contract, binding]) {
		assert.doesNotMatch(source, /project-library-contract\.ts|project-library-database\.ts/iu);
		assert.doesNotMatch(source, /main\.mjs|preload\.mjs|ipc|electron/iu);
	}
	const legacyContract = await readFile(resolve(ROOT, 'desktop/project-library-contract.ts'), 'utf8');
	const legacyDatabase = await readFile(resolve(ROOT, 'desktop/project-library-database.ts'), 'utf8');
	const legacyBinding = await readFile(resolve(ROOT, 'desktop/project-library-media-binding.ts'), 'utf8');
	assert.doesNotMatch(legacyContract, /V10|schemaVersion\s*=\s*10|projectSchemaVersion\s*=\s*18/iu);
	assert.doesNotMatch(legacyDatabase, /V10|DATABASE_VERSION\s*=\s*12/iu);
	assert.doesNotMatch(legacyBinding, /video-proxy-v1|\^\[mvtp\]/u);
});
