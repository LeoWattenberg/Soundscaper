/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { contextSubmenuPosition } from '../vendor/audacity-design-system/components/src/ContextMenuItem/context-submenu-position.ts';

const viewport = { width: 800, height: 600 };
const submenu = { width: 240, height: 300 };

test('context submenus open beside their row when the viewport has room', () => {
	assert.deepEqual(contextSubmenuPosition(
		{ left: 100, right: 360, top: 80 }, submenu, viewport,
	), { left: 360, top: 80 });
});

test('context submenus flip and clamp at the viewport edges', () => {
	assert.deepEqual(contextSubmenuPosition(
		{ left: 550, right: 790, top: 500 }, submenu, viewport,
	), { left: 310, top: 290 });
	assert.deepEqual(contextSubmenuPosition(
		{ left: 5, right: 795, top: -20 }, { width: 900, height: 700 }, viewport,
	), { left: 10, top: 10 });
});
