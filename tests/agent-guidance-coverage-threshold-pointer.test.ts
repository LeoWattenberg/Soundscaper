/* SPDX-License-Identifier: AGPL-3.0-only */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { COVERAGE_GATE_CONFIGURATION_URL, COVERAGE_SCOPES } from '../scripts/lib/coverage-gates.mjs';

const guidance = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');

test('agent guidance names the file that actually holds the coverage floors', () => {
	assert.match(guidance, /coverage floors live in `config\/coverage-gates\.json`/u);
	assert.doesNotMatch(guidance, /coverage (?:thresholds|floors) live in `\.c8rc\.json`/u);
	assert.doesNotMatch(guidance, /coverage (?:thresholds|floors) live in `scripts\/lib\/coverage-gates\.mjs`/u);
});

test('agent guidance names the ratchet that raises a floor a scope has outgrown', () => {
	assert.match(guidance, /`npm run coverage:tighten`/u);
	const { scripts } = JSON.parse(
		readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
	) as { scripts: Record<string, string> };
	assert.equal(scripts['coverage:tighten'], 'node scripts/tighten-coverage-gates.mjs');
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

	const configured = JSON.parse(
		readFileSync(COVERAGE_GATE_CONFIGURATION_URL, 'utf8'),
	) as { scopes: { id: string }[] };
	assert.deepEqual(configured.scopes.map(({ id }) => id), COVERAGE_SCOPES.map(({ id }) => id));
});
