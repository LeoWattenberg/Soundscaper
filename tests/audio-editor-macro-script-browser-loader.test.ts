/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { macroPreludeImportSource } from '../src/common/editor/macro-script/browser-prelude-loader.ts';

test('the macro prelude is a static same-origin module dependency', () => {
	assert.equal(
		macroPreludeImportSource('/assets/sandbox-prelude-abc123.js', 'https://soundscaper.org/en/'),
		'import "https://soundscaper.org/assets/sandbox-prelude-abc123.js";',
	);
	assert.equal(
		macroPreludeImportSource('/assets/sandbox-prelude-abc123.js', 'soundscaper-app://bundle/en/'),
		'import "soundscaper-app://bundle/assets/sandbox-prelude-abc123.js";',
	);
});
