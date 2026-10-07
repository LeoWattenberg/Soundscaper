/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { editingParityCases } from './helpers/responsiveness-round4-parity.ts';

interface Receipt { readonly baseline: string; readonly cases: readonly { name: string; hash: string }[] }
void test('round4 editing retains complete baseline draft, result and diagnostic hashes', () => {
	const receipt = JSON.parse(readFileSync(new URL('./fixtures/responsiveness-round4-editing-parity.json', import.meta.url), 'utf8')) as Receipt;
	const current = editingParityCases().map(({ name, hash }) => ({ name, hash }));
	assert.equal(receipt.baseline, '138581fec362c0b4cef96f32d86f3e50194ce06f');
	assert.deepEqual(current, receipt.cases);
});
