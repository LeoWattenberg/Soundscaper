import test from 'node:test';
import assert from 'node:assert/strict';

import {
	DOCUMENTATION_BASE_URL,
	HANDBOOK_LANGUAGES,
	documentationUrl,
} from '../src/common/editor/documentation-links.ts';
import { handbookLocaleSegment, handbookTranslationLocales } from '../scripts/lib/handbook-locales.mjs';
import { handbookPlan } from '../scripts/lib/product-web-routing.mjs';

test('documentation links route each product to its own manual and first-project guide', () => {
	assert.equal(DOCUMENTATION_BASE_URL, 'https://soundscaper.org/docs');
	assert.equal(documentationUrl('soundscaper', 'manual'), 'https://soundscaper.org/docs/soundscaper/');
	assert.equal(
		documentationUrl('soundscaper', 'tutorials'),
		'https://soundscaper.org/docs/soundscaper/first-project/',
	);
	assert.equal(documentationUrl('framescaper', 'manual'), 'https://soundscaper.org/docs/framescaper/');
	assert.equal(
		documentationUrl('framescaper', 'tutorials'),
		'https://soundscaper.org/docs/framescaper/first-project/',
	);
});

test('the handbook the editor links to is the one the Soundscaper build stages', () => {
	const handbook = handbookPlan('soundscaper');
	assert.ok(handbook);
	assert.equal(new URL(DOCUMENTATION_BASE_URL).pathname, handbook.basePath);
	assert.equal(new URL(DOCUMENTATION_BASE_URL).origin, 'https://soundscaper.org');
	assert.equal(handbookPlan('framescaper'), null);
});

test('documentation links reject unknown products and destinations', () => {
	assert.throws(() => documentationUrl('unknown', 'manual'), /Unsupported editor product/u);
	assert.throws(
		() => documentationUrl('soundscaper', 'unknown' as 'manual'),
		/Unsupported documentation destination/u,
	);
});

/**
 * The handbook publishes a language by having a directory of pages for it, and
 * a link into a language it does not publish is a 404 rather than a fallback.
 * The editor cannot read the content tree, so it carries the list; this is what
 * stops a language being published without the editor learning to link into it.
 */
test('the editor knows exactly the languages the handbook publishes', () => {
	assert.deepEqual([...HANDBOOK_LANGUAGES], handbookTranslationLocales().map(handbookLocaleSegment));
});

test('a reader is taken to the handbook in the language they are reading', () => {
	assert.equal(documentationUrl('soundscaper', 'manual', 'en'), 'https://soundscaper.org/docs/soundscaper/');
	// A language the handbook does not publish takes the reader to English
	// rather than to a page that does not exist.
	assert.equal(documentationUrl('soundscaper', 'manual', 'kl'), 'https://soundscaper.org/docs/soundscaper/');
	assert.equal(documentationUrl('soundscaper', 'manual', undefined), 'https://soundscaper.org/docs/soundscaper/');
	for (const segment of HANDBOOK_LANGUAGES) {
		assert.equal(
			documentationUrl('soundscaper', 'tutorials', segment),
			`https://soundscaper.org/docs/${segment}/soundscaper/first-project/`,
		);
	}
});
