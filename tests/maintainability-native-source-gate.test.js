/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

import { collectMaintainedSourceFiles } from '../scripts/lib/maintained-source-files.mjs';
import {
	MAINTAINED_SOURCE_ROOTS,
	isMaintainedSourceFile,
} from '../scripts/lib/maintained-source-policy.mjs';

test('the maintained source roots include the first-party native tree', () => {
	assert.ok(MAINTAINED_SOURCE_ROOTS.includes('native'));
});

test('the maintainability gate recognizes native source and build-language files', () => {
	for (const name of [
		'unit.c', 'unit.cc', 'unit.cpp', 'unit.cxx',
		'unit.h', 'unit.hh', 'unit.hpp', 'unit.hxx',
		'unit.inc', 'unit.m', 'unit.mm', 'rule.cmake', 'CMakeLists.txt',
	]) assert.equal(isMaintainedSourceFile(name), true, name);

	for (const name of ['payload.node', 'fixture.scapefx', 'manifest.json', 'THIRD_PARTY_NOTICES.md']) {
		assert.equal(isMaintainedSourceFile(name), false, name);
	}
});

test('the maintainability gate walks nested native source directories', () => {
	const directory = mkdtempSync(join(tmpdir(), 'soundscaper-maintained-source-'));
	try {
		mkdirSync(join(directory, 'codec', 'native'), { recursive: true });
		mkdirSync(join(directory, 'node_modules', 'dependency'), { recursive: true });
		mkdirSync(join(directory, 'test-results', 'fixture'), { recursive: true });
		writeFileSync(join(directory, 'codec', 'native', 'codec.c'), 'int codec(void);\n');
		writeFileSync(join(directory, 'node_modules', 'dependency', 'ignored.c'), 'int ignored(void);\n');
		writeFileSync(join(directory, 'test-results', 'fixture', 'ignored.cpp'), 'int ignored();\n');

		assert.deepEqual(
			collectMaintainedSourceFiles(directory).map((path) => relative(directory, path)),
			[join('codec', 'native', 'codec.c')],
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
