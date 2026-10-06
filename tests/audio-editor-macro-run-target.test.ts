/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { macroStartsWithCommand } from '../src/common/editor/ui/inspector/macro-run-target.ts';

test('a leading command supplies its own target, while effects still need audio', () => {
	assert.equal(macroStartsWithCommand([{ kind: 'command', command: 'NewMonoTrack' }]), true);
	assert.equal(macroStartsWithCommand([{ kind: 'command', command: 'Select' }, { type: 'fade-out' }]), true);
	assert.equal(macroStartsWithCommand([{ type: 'fade-out' }, { kind: 'command', command: 'Select' }]), false);
	assert.equal(macroStartsWithCommand([{ kind: 'command', enabled: false }, { type: 'fade-out' }]), false);
	assert.equal(macroStartsWithCommand([]), false);
});
