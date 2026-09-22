/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { KOKORO_VOICES_BY_LANGUAGE } from '../src/common/editor/assistance/kokoro-voices-v1.ts';
import { KOKORO_LANGUAGE_CANARIES } from './electron/local-assistance-models/kokoro-language-canaries.js';

test('packaged Kokoro canaries cover all nine language variants with a published voice and bounded script', () => {
	assert.deepEqual(KOKORO_LANGUAGE_CANARIES.map(({ language }) => language),
		Object.keys(KOKORO_VOICES_BY_LANGUAGE));
	assert.equal(new Set(KOKORO_LANGUAGE_CANARIES.map(({ voice }) => voice)).size, 9);
	for (const { language, voice, script, speed } of KOKORO_LANGUAGE_CANARIES) {
		assert.ok(KOKORO_VOICES_BY_LANGUAGE[language].includes(voice), `${voice} belongs to ${language}.`);
		assert.ok(script.trim().length > 5);
		assert.ok(Buffer.byteLength(script, 'utf8') < 64 * 1024);
		assert.ok(!script.includes('\0'));
		if (language !== 'a' && language !== 'b') {
			assert.ok(Array.from(script).some((symbol) => symbol.codePointAt(0) > 127),
				`${language} must exercise multilingual text normalization.`);
		}
		assert.equal(speed, 1);
	}
});
