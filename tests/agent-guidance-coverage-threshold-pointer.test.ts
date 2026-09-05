/* SPDX-License-Identifier: AGPL-3.0-only */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { COVERAGE_SCOPES } from '../scripts/lib/coverage-gates.mjs';

const guidance = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');

test('agent guidance names the module that actually holds the coverage thresholds', () => {
	assert.match(guidance, /coverage thresholds live in `scripts\/lib\/coverage-gates\.mjs`/u);
	assert.doesNotMatch(guidance, /coverage thresholds live in `\.c8rc\.json`/u);
});

test('the coverage runner configuration carries no thresholds while coverage-gates does', () => {
	const c8rc = JSON.parse(
		readFileSync(new URL('../.c8rc.json', import.meta.url), 'utf8'),
	) as Record<string, unknown>;
	for (const key of ['lines', 'branches', 'functions', 'statements', 'check-coverage']) {
		assert.equal(Object.hasOwn(c8rc, key), false, `.c8rc.json unexpectedly declares ${key}`);
	}
	assert.ok(COVERAGE_SCOPES.length > 0);
	for (const scope of COVERAGE_SCOPES) {
		assert.equal(typeof scope.thresholds.lines, 'number');
		assert.equal(typeof scope.thresholds.branches, 'number');
		assert.equal(typeof scope.thresholds.functions, 'number');
	}
});
