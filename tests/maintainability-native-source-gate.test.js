/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

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
