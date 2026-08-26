/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// The baseline is a ratchet, not a waiver list: it exists so a new violation
// fails and so a cleared one has to be pruned. That only holds while every row
// says which rule it covers and why it is still open.
const ROOT = new URL('../', import.meta.url);
const SPEC = 'tests/browser/accessibility-wcag-sweep.spec.js';
const baseline = JSON.parse(await readFile(new URL('config/accessibility-wcag-baseline.json', ROOT), 'utf8'));

test('the accessibility baseline declares the WCAG 2.2 AA tag set it was measured with', () => {
	assert.equal(baseline.schemaVersion, 1);
	assert.deepEqual(baseline.tags, ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
	assert.deepEqual(baseline.impacts, ['critical', 'serious']);
	assert.match(baseline.reviewedAt, /^\d{4}-\d{2}-\d{2}$/u);
});

test('every recorded violation names its rule, its count, and why it is still open', () => {
	assert.ok(Array.isArray(baseline.known), 'the baseline must list its known violations');
	const seen = new Set();
	for (const row of baseline.known) {
		assert.deepEqual(Object.keys(row).sort(), ['conditionId', 'nodes', 'reason', 'routeId', 'ruleId']);
		assert.match(row.routeId, /^[a-z][a-z0-9-]*$/u);
		assert.match(row.conditionId, /^[a-z][a-z0-9-]*$/u);
		assert.match(row.ruleId, /^[a-z][a-z0-9-]*$/u);
		assert.ok(Number.isSafeInteger(row.nodes) && row.nodes > 0, `${row.ruleId} must count its nodes`);
		assert.ok(row.reason.trim().length >= 60,
			`${row.routeId}/${row.conditionId}/${row.ruleId} needs a reason a reader can act on`);
		const key = `${row.routeId}/${row.conditionId}/${row.ruleId}`;
		assert.ok(!seen.has(key), `${key} is recorded twice`);
		seen.add(key);
	}
});

test('the sweep reads the baseline rather than carrying its own copy', async () => {
	const spec = await readFile(new URL(SPEC, ROOT), 'utf8');
	assert.match(spec, /config\/accessibility-wcag-baseline\.json/u);
	assert.match(spec, /accessibilityBaseline\.tags/u, 'the tag set must come from the baseline');
	assert.match(spec, /accessibilityBaseline\.impacts/u, 'the blocking impacts must come from the baseline');
	assert.match(spec, /accessibilityBaseline\.known/u, 'the comparison must be against the baseline');
	assert.match(spec, /SOUNDSCAPER_WCAG_SWEEP/u, 'the sweep must publish its counts as a diagnostic');
});
