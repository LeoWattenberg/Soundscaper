/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the translation bucket admits both product production and Pages preview origins', async () => {
	const policy = JSON.parse(await readFile(
		new URL('../r2-translations-cors.json', import.meta.url), 'utf8',
	));
	const origins = policy.rules?.[0]?.allowed?.origins;

	for (const origin of [
		'https://soundscaper.org',
		'https://soundscaper.pages.dev',
		'https://framescaper.org',
		'https://framescaper.pages.dev',
	]) assert.ok(origins.includes(origin), `${origin} must be admitted by translation CORS`);
});
