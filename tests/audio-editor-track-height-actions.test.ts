/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDACITY_ACTION_STATUS,
	applyAudacityParityToMenus,
	audacityActionDefinition,
} from '../src/common/editor/audacity-action-parity.js';
import { AUDACITY_ACTION_ROADMAP_DISPOSITION } from '../src/common/editor/audacity-action-roadmap.ts';
import { AUDACITY_PINNED_UI_ACTIONS } from '../src/common/editor/audacity-pinned-ui-inventory.js';

// Audacity 4 registers absolute Collapse/Expand all tracks. Soundscaper
// deliberately replaced that pair with relative stepping commands of its own,
// so the upstream ids must stay inventoried, inert, and out of every menu.
test('Audacity collapse and expand all tracks stay superseded by the relative stepping commands', () => {
	for (const id of ['collapse-all-tracks', 'expand-all-tracks']) {
		const definition = audacityActionDefinition(id);
		assert.equal(definition.status, AUDACITY_ACTION_STATUS.DISABLED_UPSTREAM, id);
		assert.equal(definition.origin, 'upstream', id);
		assert.equal(definition.handler, null, `${id} must not gain a runtime handler`);
		assert.equal(definition.enableWhen, 'never', id);
		assert.equal(definition.menuVisible, false, `${id} must never render as a menu item`);
		assert.match(definition.reason.en, /superseded/u, id);
		assert.ok(definition.reason.de, id);
		assert.equal(definition.roadmapDisposition, AUDACITY_ACTION_ROADMAP_DISPOSITION.JUSTIFIED_EXCLUDED, id);
		assert.ok(
			AUDACITY_PINNED_UI_ACTIONS.some((action: { id: string }) => action.id === id),
			`${id} stays in the pinned inventory so a later upstream change cannot escape review`,
		);
	}

	for (const [id, shortcut] of [
		['decrease-all-track-heights', 'Ctrl+Shift+Down'],
		['increase-all-track-heights', 'Ctrl+Shift+Up'],
	] as const) {
		const definition = audacityActionDefinition(id);
		assert.equal(definition.status, AUDACITY_ACTION_STATUS.IMPLEMENTED, id);
		assert.equal(definition.origin, 'local', `${id} is a Soundscaper command, not an Audacity action`);
		assert.equal(definition.upstreamSource, null, id);
		assert.equal(definition.shortcut, shortcut, id);
	}

	// Parity decoration is the backstop: even if the upstream pair were added to
	// a menu again, it is stripped rather than rendered as a disabled leaf.
	const [zoom] = applyAudacityParityToMenus([{
		id: 'menu-zoom',
		label: 'Zoom',
		items: [
			{ id: 'collapse-all-tracks', label: 'Collapse all tracks', onClick: () => null },
			{ id: 'expand-all-tracks', label: 'Expand all tracks', onClick: () => null },
			{ id: 'decrease-all-track-heights', label: 'Decrease all track heights', onClick: () => null },
			{ id: 'increase-all-track-heights', label: 'Increase all track heights', onClick: () => null },
		],
	}], { locale: 'en' });
	assert.deepEqual(
		zoom.items.map((item: { id: string }) => item.id),
		['decrease-all-track-heights', 'increase-all-track-heights'],
	);
});
