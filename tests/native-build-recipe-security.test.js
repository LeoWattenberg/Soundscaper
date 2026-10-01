/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import {
	mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	assertSeparateRoots,
	authenticateToolchainReceipt,
	canonicalJson,
	closedRecord,
	closedToolchainEnvironment,
	deepFreeze,
	emptyOutputRoot,
	existingDirectory,
	existingFile,
	fingerprintToolchainReceipt,
	pinnedFile,
	safeRelativePath,
	sha256,
	verifyWitnesses,
	witnessFile,
} from '../native/common/build-recipe-security.mjs';

test('build-recipe security canonicalizes and deeply freezes admitted data', () => {
	assert.equal(canonicalJson({ z: 1, a: [3, { b: 2 }] }), '{"a":[3,{"b":2}],"z":1}');
	const value = closedRecord({ one: { two: [] } }, ['one'], 'fixture');
	assert.equal(deepFreeze(value), value);
	assert.ok(Object.isFrozen(value));
	assert.ok(Object.isFrozen(value.one));
	assert.ok(Object.isFrozen(value.one.two));
	assert.throws(
		() => closedRecord({ one: 1, injected: true }, ['one'], 'fixture'),
		/fixture has missing or unsupported fields/u,
	);
});

test('build-recipe security refuses traversal and non-canonical relative paths', (context) => {
	const root = fixtureRoot(context);
	const bytes = Buffer.from('pinned');
	writeFileSync(join(root, 'pinned.txt'), bytes);
	const manifest = { sourceFiles: [{
		path: '../pinned.txt', byteLength: bytes.byteLength, sha256: sha256(bytes),
	}] };
	for (const path of ['', '.', '..', '../escape', 'safe/../escape', '/absolute', 'back\\slash']) {
		assert.equal(safeRelativePath(path), false, path);
	}
	assert.equal(safeRelativePath('safe/path+name.txt'), true);
	assert.throws(
		() => pinnedFile(root, manifest, '../pinned.txt', []),
		/Local build input \.\.\/pinned\.txt is not source-manifest pinned/u,
	);
});

test('build-recipe security refuses symlinked files and directories', (context) => {
	const root = fixtureRoot(context);
	const directory = join(root, 'directory');
	const file = join(root, 'file');
	mkdirSync(directory);
	writeFileSync(file, 'fixture');
	const directoryLink = join(root, 'directory-link');
	const fileLink = join(root, 'file-link');
	symlinkSync(directory, directoryLink, 'dir');
	symlinkSync(file, fileLink, 'file');
	assert.throws(() => existingDirectory(directoryLink, 'fixture directory'), /canonical non-symlink/u);
	assert.throws(() => existingFile(fileLink, 'fixture file'), /canonical non-symlink/u);
});

test('build-recipe security refuses repository output and pairwise root overlap', (context) => {
	const root = fixtureRoot(context);
	const repository = join(root, 'repository');
	const output = join(repository, 'output');
	mkdirSync(output, { recursive: true });
	assert.throws(
		() => emptyOutputRoot(output, repository),
		/output root must remain outside the repository/u,
	);
	assert.throws(
		() => assertSeparateRoots([repository, output]),
		/source and output roots must not overlap/u,
	);
});

test('build-recipe security detects admitted witness drift', (context) => {
	const root = fixtureRoot(context);
	const path = join(root, 'input');
	writeFileSync(path, 'before');
	const witnesses = [];
	witnessFile(path, witnesses);
	writeFileSync(path, 'after');
	assert.throws(
		() => verifyWitnesses(witnesses),
		/Build input drifted after recipe admission/u,
	);
});

test('build-recipe security rejects hostile toolchain environments', () => {
	const allowed = new Set(['PATH', 'SDKROOT']);
	assert.deepEqual(
		closedToolchainEnvironment({ SDKROOT: '/sdk', PATH: '/tools' }, allowed),
		{ PATH: '/tools', SDKROOT: '/sdk' },
	);
	assert.throws(
		() => closedToolchainEnvironment({ PATH: '/tools', NODE_OPTIONS: '--require=attack' }, allowed),
		/Toolchain environment NODE_OPTIONS is unsupported/u,
	);
	assert.throws(
		() => closedToolchainEnvironment({ PATH: '/tools\0attack' }, allowed),
		/Toolchain environment PATH is unsupported/u,
	);
});

test('build-recipe security authenticates exact tool-role receipts', (context) => {
	const root = fixtureRoot(context);
	const executable = join(root, 'compiler');
	writeFileSync(executable, 'compiler');
	const body = {
		schemaVersion: 1,
		targetId: 'linux-x64',
		hostRuntime: 'linux-x64',
		executables: { c: { path: executable, sha256: sha256(readFileSync(executable)) } },
		environment: { PATH: '/tools' },
	};
	const identitySha256 = fingerprintToolchainReceipt(body, 'fixture toolchain receipt body');
	const receiptPath = join(root, 'receipt.json');
	writeFileSync(receiptPath, JSON.stringify({ ...body, identitySha256 }));
	const witnesses = [];
	const receipt = authenticateToolchainReceipt({
		pathValue: receiptPath,
		identityValue: identitySha256,
		target: { id: 'linux-x64', hostRuntime: 'linux-x64' },
		roles: ['c'],
		allowedEnvironment: new Set(['PATH']),
		witnesses,
		receiptBodyName: 'fixture toolchain receipt body',
		identityError: 'The fixture toolchain identity drifted.',
	});
	assert.equal(receipt.identitySha256, identitySha256);
	assert.deepEqual(receipt.executables.c, body.executables.c);
	assert.ok(witnesses.length >= 2);

	writeFileSync(executable, 'forged compiler');
	assert.throws(() => authenticateToolchainReceipt({
		pathValue: receiptPath,
		identityValue: identitySha256,
		target: { id: 'linux-x64', hostRuntime: 'linux-x64' },
		roles: ['c'],
		allowedEnvironment: new Set(['PATH']),
		witnesses: [],
		receiptBodyName: 'fixture toolchain receipt body',
		identityError: 'The fixture toolchain identity drifted.',
	}), /Toolchain executable c drifted/u);
});

function fixtureRoot(context) {
	const root = mkdtempSync(join(tmpdir(), 'build-recipe-security-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}
