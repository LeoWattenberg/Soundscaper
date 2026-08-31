/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('native-media OpenFX export authority values are weakly retained', async () => {
	const source = await readFile(new URL(
		'../src/framescaper/video-export-strategy-native-media.ts', import.meta.url,
	), 'utf8');
	assert.doesNotMatch(source, /new Map<string, ExportAuthorityNativeMedia>/u);
	assert.match(source, /WeakRef<ExportAuthorityNativeMedia>/u);
	assert.match(source, /FinalizationRegistry/u);
	assert.match(source, /\.deref\(\)/u);
});
