/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDACITY_SHORTCUT_DEFAULT_AUTOREPEAT,
	AUDACITY_SHORTCUT_INVENTORY,
	AUDACITY_SHORTCUT_SOURCE,
} from '../src/common/editor/audacity-shortcut-inventory.ts';

const EXPECTED_SOURCE = Object.freeze({
	version: '4.0.0',
	commit: '4c177d436e48c1d20f231eada44035593cb26292',
	generatedFromCommit: '2f42f1c968ad15b5ab871f3bdf56249bd311a84e',
	file: 'src/app/configs/data/shortcuts.xml',
	url: 'https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/src/app/configs/data/shortcuts.xml',
	sha256: 'cc373976cf8755b8dcae5c4517065c3818da566e6c8372fccbae2a78f9f02f06',
});

const EXPECTED_RECORDS = Object.freeze({
	'nav-next-section': Object.freeze(['F6', '`']),
	'action://delete': Object.freeze(['Del', 'Backspace']),
	'track-view-item-context-menu': Object.freeze(['Shift+F10', 'Ctrl+Shift+F10']),
	'action://trackedit/paste-insert': Object.freeze(['Shift+V']),
	'split': Object.freeze(['Ctrl+I']),
	'split-tool': Object.freeze(['S']),
	'delete-all-tracks-ripple': Object.freeze(['Ctrl+Del', 'Ctrl+Backspace']),
	'project-import': Object.freeze(['Ctrl+Shift+I']),
	'toggle-alt': Object.freeze(['NUMPAD_ENTER']),
	'action://playback/toggle-play-stop': Object.freeze(['Space']),
	'track-view-item-move-down': Object.freeze(['Ctrl+Down']),
});

test('Audacity shortcut source metadata pins the reviewed 4.0.0 XML bytes', () => {
	assert.deepEqual(AUDACITY_SHORTCUT_SOURCE, EXPECTED_SOURCE);
	assert.ok(Object.isFrozen(AUDACITY_SHORTCUT_SOURCE));
});

test('Audacity shortcut inventory contains every non-development source record exactly once', () => {
	assert.equal(AUDACITY_SHORTCUT_INVENTORY.length, 175);
	assert.equal(
		AUDACITY_SHORTCUT_INVENTORY.reduce((total, record) => total + record.sequences.length, 0),
		184,
	);
	assert.ok(Object.isFrozen(AUDACITY_SHORTCUT_INVENTORY));

	const upstreamActionIds = AUDACITY_SHORTCUT_INVENTORY.map((record) => record.upstreamActionId);
	assert.equal(new Set(upstreamActionIds).size, upstreamActionIds.length);
	for (const record of AUDACITY_SHORTCUT_INVENTORY) {
		assert.ok(Object.isFrozen(record), record.upstreamActionId);
		assert.ok(Object.isFrozen(record.sequences), record.upstreamActionId);
		assert.ok(record.sequences.length > 0, record.upstreamActionId);
		assert.equal(new Set(record.sequences).size, record.sequences.length, record.upstreamActionId);
		assert.equal(record.autorepeat, AUDACITY_SHORTCUT_DEFAULT_AUTOREPEAT, record.upstreamActionId);
	}
});

test('Audacity shortcut inventory preserves representative upstream IDs and exact sequences', () => {
	const byUpstreamActionId = new Map(
		AUDACITY_SHORTCUT_INVENTORY.map((record) => [record.upstreamActionId, record]),
	);

	for (const [upstreamActionId, sequences] of Object.entries(EXPECTED_RECORDS)) {
		assert.deepEqual(byUpstreamActionId.get(upstreamActionId)?.sequences, sequences, upstreamActionId);
	}
	assert.deepEqual(byUpstreamActionId.get('split-tool')?.sequences, ['S']);
	assert.deepEqual(byUpstreamActionId.get('split')?.sequences, ['Ctrl+I']);
	assert.equal(AUDACITY_SHORTCUT_DEFAULT_AUTOREPEAT, true);
});
