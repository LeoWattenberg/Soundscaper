/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { extractNyquistCatalogRows } from '../scripts/nyquist-archive-metadata.mjs';

const manifest = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/nyquist-archive/manifest.json.gz', import.meta.url))));

test('catalog extraction pairs a section heading and summary with its archived file', () => {
	const source = `# Filters\n\n### Ten Band EQ\n\nAn Equalizer (EQ) that can modify one band at a time.\n\n{% file src="../../.gitbook/assets/10bandeq.ny" %}\nDownload Plugin\n{% endfile %}\n`;
	assert.deepEqual(extractNyquistCatalogRows(source, 'nyquist-plugins/effect-plugins/filters-and-eq.md'), [{
		fileName: '10bandeq.ny', title: 'Ten Band EQ',
		description: 'An Equalizer (EQ) that can modify one band at a time.',
		sourcePage: 'https://plugins.audacityteam.org/nyquist-plugins/effect-plugins/filters-and-eq',
	}]);
});

test('catalog extraction removes links with escaped parentheses without leaking their URLs', () => {
	const source = `### Chebyshev Type I Filter\n\nType I filters have more [ripple](http://en.wikipedia.org/wiki/Ripple\\_\\(filters\\)#Frequency-domain\\_ripple) in the passband.\n\n{% file src="../../.gitbook/assets/ChebyI.ny" %}\n`;
	assert.equal(extractNyquistCatalogRows(source, 'nyquist-plugins/effect-plugins/filters-and-eq.md')[0]?.description,
		'Type I filters have more ripple in the passband.');
});

test('committed catalog metadata covers exactly the pinned archive and names the catalog examples', () => {
	const metadata = JSON.parse(readFileSync(new URL('../evidence/nyquist-plugin-publication/catalog-metadata-ed168a19631ec48d0029dfb5c17d16c339a174c1.json', import.meta.url), 'utf8'));
	assert.equal(metadata.schemaVersion, 1);
	assert.equal(metadata.archiveId, manifest.archiveId);
	assert.equal(metadata.upstream.revision, manifest.upstream.revision);
	assert.deepEqual(metadata.entries.map(({ fileName }) => fileName), manifest.artifacts.map(({ fileName }) => fileName));
	for (const [index, entry] of metadata.entries.entries()) {
		assert.ok(entry.title && entry.title.length <= 160, entry.fileName);
		assert.ok(entry.description && entry.description.length <= 700, entry.fileName);
		assert.ok(manifest.artifacts[index].sourcePages.includes(entry.sourcePage), entry.fileName);
	}
	assert.deepEqual(metadata.entries.find(({ fileName }) => fileName === '10bandeq.ny')?.title, 'Ten Band EQ');
	assert.match(metadata.entries.find(({ fileName }) => fileName === '10bandeq.ny')?.description ?? '', /one band at a time/u);
	assert.notEqual(metadata.entries.find(({ fileName }) => fileName === 'spotify.ny')?.title,
		metadata.entries.find(({ fileName }) => fileName === 'spotify-loud.ny')?.title);
	assert.match(metadata.entries.find(({ fileName }) => fileName === 'spotify.ny')?.description ?? '', /LUFS/u);
});
