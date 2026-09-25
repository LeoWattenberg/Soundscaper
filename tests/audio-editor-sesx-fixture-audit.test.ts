/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseSesxDocument, sesxAudioReferences } from '../src/common/editor/sesx-import.ts';

const SOURCE_REVISION = 'fe11457895060e78f3db4a16e75f33d9397e5d1f';
const SOURCE_SHA256 = '686d892fba582cc1ffbb23c52c20a123db4b4cd2e0aacc7b2b8cfb7aa42753b1';
const PINNED_BYTES = Object.freeze({
	'audition-22.2-metronome.sesx': '7474bcd5958801a661c75f6c73cebe50dc40f5ad10d4b987ca9737adceb63620',
	'LICENSE-synthgirl-root.txt': '064108e439012dac68d697cd24d4e91997a1383ee6f9bb6f7e411f45b59391ea',
	'LICENSE-synthgirl-app.txt': 'ad69beb21ecae8c01d997ae66979b8d2d4ed70f3d8294694f55c5384c51241c1',
});

test('SESX interoperability fixture retains pinned bytes, source provenance and MIT notices', () => {
	for (const [name, expected] of Object.entries(PINNED_BYTES)) {
		const bytes = readFileSync(new URL(`./fixtures/sesx/${name}`, import.meta.url));
		assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, name);
	}
	const readme = readFileSync(new URL('./fixtures/sesx/README.md', import.meta.url), 'utf8');
	assert.ok(readme.includes(SOURCE_REVISION));
	assert.ok(readme.includes(SOURCE_SHA256));
	for (const name of ['LICENSE-synthgirl-root.txt', 'LICENSE-synthgirl-app.txt']) {
		assert.match(readFileSync(new URL(`./fixtures/sesx/${name}`, import.meta.url), 'utf8'), /MIT License/u);
		assert.ok(readme.includes(name));
	}
	const xml = readFileSync(new URL('./fixtures/sesx/audition-22.2-metronome.sesx', import.meta.url), 'utf8');
	const document = parseSesxDocument(xml);
	assert.equal(document.tracks.length, 2);
	assert.equal(document.tracks.reduce((count, track) => count + track.clips.length, 0), 3);
	assert.equal(sesxAudioReferences(document).length, 3);
});
