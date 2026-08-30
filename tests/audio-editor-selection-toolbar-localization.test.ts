/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('selection toolbar accessible name comes from the localization catalog', async () => {
	const source = await readFile(
		new URL('../src/common/editor/ui/toolbar/AudioEditorTransportControls.jsx', import.meta.url),
		'utf8',
	);

	assert.match(source, /setAttribute\('aria-label', copy\.selectionToolbar\)/u);
	assert.doesNotMatch(source, /setAttribute\('aria-label', 'Selection toolbar'\)/u);
});
