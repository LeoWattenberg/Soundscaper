/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AUDACITY_ACTION_DEFINITIONS } from '../src/common/editor/audacity-action-inventory.js';
import {
	APPLICATION_MENU_REFERENCE_BY_ID,
	APPLICATION_MENU_REFERENCE_ENTRIES,
} from '../src/common/editor/ui/application-menu-reference.ts';

test('the supplemental application-menu reference is a frozen unique lookup', () => {
	assert.ok(Object.isFrozen(APPLICATION_MENU_REFERENCE_ENTRIES));
	assert.ok(Object.isFrozen(APPLICATION_MENU_REFERENCE_BY_ID));
	assert.ok(APPLICATION_MENU_REFERENCE_ENTRIES.length > 200);

	const manifestIds = new Set(AUDACITY_ACTION_DEFINITIONS.map(({ id }) => id));
	const ids = new Set<string>();
	for (const entry of APPLICATION_MENU_REFERENCE_ENTRIES) {
		assert.ok(Object.isFrozen(entry), entry.id);
		assert.ok(Object.isFrozen(entry.locations), entry.id);
		assert.ok(Object.isFrozen(entry.products), entry.id);
		assert.equal(entry.id.trim(), entry.id);
		assert.ok(entry.id.length > 0, entry.id);
		assert.ok(entry.label.trim().length > 0, entry.id);
		assert.ok(entry.locations.length > 0, entry.id);
		assert.ok(entry.locations.every((location) => location.trim().length > 0), entry.id);
		assert.ok(entry.products.length > 0, entry.id);
		assert.ok(entry.products.every((product) => product === 'soundscaper' || product === 'framescaper'), entry.id);
		assert.ok(entry.kind === 'command' || entry.kind === 'setting' || entry.kind === 'link', entry.id);
		assert.equal(ids.has(entry.id), false, entry.id);
		assert.equal(manifestIds.has(entry.id), false, entry.id);
		ids.add(entry.id);
		assert.equal(APPLICATION_MENU_REFERENCE_BY_ID[entry.id], entry);
	}

	assert.deepEqual(Object.keys(APPLICATION_MENU_REFERENCE_BY_ID).sort(), [...ids].sort());
});

test('dynamic application-menu rows have one stable documentation family each', () => {
	for (const id of ['recent-project', 'workspace-custom', 'framescaper-external-display']) {
		assert.ok(APPLICATION_MENU_REFERENCE_BY_ID[id], id);
	}
});
