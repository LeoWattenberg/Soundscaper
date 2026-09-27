import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import {
	documentationBaseUrl,
	HANDBOOK_LANGUAGES,
	documentationUrl,
} from '../src/common/editor/documentation-links.ts';
import { handbookLocaleForPath, handbookLocaleSegment } from '../scripts/lib/handbook-locales.mjs';
import { handbookPlan } from '../scripts/lib/product-web-routing.mjs';
import { COMMITTED_LOCALE_TAGS } from '../src/common/i18n/locales.js';

test('documentation links route each product to its own manual and first-project guide', () => {
	assert.equal(documentationBaseUrl('soundscaper'), 'https://soundscaper.org/docs');
	assert.equal(documentationBaseUrl('framescaper'), 'https://framescaper.org/docs');
	assert.equal(documentationUrl('soundscaper', 'manual'), 'https://soundscaper.org/docs/');
	assert.equal(
		documentationUrl('soundscaper', 'tutorials'),
		'https://soundscaper.org/docs/tutorials/your-first-project/',
	);
	assert.equal(documentationUrl('framescaper', 'manual'), 'https://framescaper.org/docs/');
	assert.equal(
		documentationUrl('framescaper', 'tutorials'),
		'https://framescaper.org/docs/first-project/',
	);
});

test('each editor links to the handbook staged by its own build', () => {
	for (const productId of ['soundscaper', 'framescaper'] as const) {
		const handbook = handbookPlan(productId);
		assert.ok(handbook);
		assert.equal(new URL(documentationBaseUrl(productId)).pathname, handbook.basePath);
		assert.equal(new URL(documentationBaseUrl(productId)).origin, `https://${productId}.org`);
	}
});

test('documentation links reject unknown products and destinations', () => {
	assert.throws(() => documentationBaseUrl('unknown'), /Unsupported editor product/u);
	assert.throws(() => documentationUrl('unknown', 'manual'), /Unsupported editor product/u);
	assert.throws(
		() => documentationUrl('soundscaper', 'unknown' as 'manual'),
		/Unsupported documentation destination/u,
	);
});

/**
 * The handbook publishes a language by including a directory of pages for it, and
 * a link into a language it does not publish is a 404 rather than a fallback.
 * The editor cannot read the content tree, so it carries the list; this is what
 * stops a language being published without the editor learning to link into it.
 */
test('the editor knows exactly the languages the handbook publishes', () => {
	// The index includes staged additions, but excludes translation drafts that
	// are not part of the checkout CI builds and publishes. Never register links
	// to untracked drafts: a clean checkout would ship those links without pages.
	const prefix = 'handbook/src/content/docs/';
	const files = execFileSync('git', ['ls-files', '--cached', '-z', '--', prefix], {
		cwd: new URL('..', import.meta.url), encoding: 'utf8',
	}).split('\0').filter(Boolean);
	const published = new Set(files.map(path => handbookLocaleForPath(path.slice(prefix.length))));
	const locales = COMMITTED_LOCALE_TAGS.filter(locale => locale !== 'en' && published.has(locale));
	assert.deepEqual([...HANDBOOK_LANGUAGES], locales.map(handbookLocaleSegment));
});

test('a reader is taken to the handbook in the language they are reading', () => {
	assert.equal(documentationUrl('soundscaper', 'manual', 'en'), 'https://soundscaper.org/docs/');
	// A language the handbook does not publish takes the reader to English
	// rather than to a page that does not exist.
	assert.equal(documentationUrl('soundscaper', 'manual', 'kl'), 'https://soundscaper.org/docs/');
	assert.equal(documentationUrl('soundscaper', 'manual', undefined), 'https://soundscaper.org/docs/');
	for (const segment of HANDBOOK_LANGUAGES) {
		assert.equal(
			documentationUrl('soundscaper', 'tutorials', segment),
			`https://soundscaper.org/docs/${segment}/tutorials/your-first-project/`,
		);
		assert.equal(
			documentationUrl('framescaper', 'tutorials', segment),
			`https://framescaper.org/docs/${segment}/first-project/`,
		);
	}
});
