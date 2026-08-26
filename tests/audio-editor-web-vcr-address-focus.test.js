/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PANEL = new URL('../src/common/editor/ui/workspace/WebVcrPanel.tsx', import.meta.url);

/**
 * The address field stays editable while a page is still resolving, and the
 * embedded browser reports every URL it settles on. Reseeding unconditionally
 * replaced whatever the operator was typing with the page's own URL.
 */
test('the Web VCR address field is not reseeded while it has focus', async () => {
	const source = await readFile(PANEL, 'utf8');
	const effect = /useEffect\(\(\) => \{([\s\S]*?)\n\t\}, \[navigationGeneration, navigationUrl\]\);/u
		.exec(source);
	assert.ok(effect, 'the address reseed effect is present');

	assert.match(
		effect[1],
		/activeElement\) return;/u,
		'a focused field keeps what the operator typed',
	);
	assert.match(effect[1], /setAddress\(navigationUrl\);/u, 'an unfocused field still tracks the page');
});
