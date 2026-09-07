import test from 'node:test';
import assert from 'node:assert/strict';

import rehypeHandbookBase from '../handbook/src/plugins/rehype-handbook-base.mjs';

function page(href, path) {
	const tree = {
		type: 'root',
		children: [{ type: 'element', tagName: 'a', properties: { href }, children: [] }],
	};
	rehypeHandbookBase()(tree, { path });
	return tree.children[0].properties.href;
}

function image(src, path) {
	const tree = {
		type: 'root',
		children: [{ type: 'element', tagName: 'img', properties: { src }, children: [] }],
	};
	rehypeHandbookBase()(tree, { path });
	return tree.children[0].properties.src;
}

const ENGLISH = '/home/user/repo/handbook/src/content/docs/start/web-or-desktop.md';
const FRENCH = '/home/user/repo/handbook/src/content/docs/fr/start/web-or-desktop.md';

test('an English page takes the handbook base alone', () => {
	assert.equal(page('/reference/', ENGLISH), '/docs/reference/');
	assert.equal(page('/docs/reference/', ENGLISH), '/docs/reference/');
	assert.equal(page('https://soundscaper.org/en/', ENGLISH), 'https://soundscaper.org/en/');
	assert.equal(page('#anchor', ENGLISH), '#anchor');
	assert.equal(page('//example.com/', ENGLISH), '//example.com/');
});

/**
 * A translated page carries the English links it was translated from, so
 * without the language a reader following one silently leaves the language
 * they were reading. Starlight generates every page in every language, filling
 * an untranslated one with the English text, so the language segment always
 * names a page that exists.
 */
test('a translated page keeps its reader in the language they are reading', () => {
	assert.equal(page('/reference/', FRENCH), '/docs/fr/reference/');
	assert.equal(page('/', FRENCH), '/docs/fr/');
	assert.equal(page('/docs/reference/', FRENCH), '/docs/reference/');
});

/** Images are one file for every language, so they take the base without a language. */
test('an image keeps the plain base in every language', () => {
	assert.equal(image('/media/waveform.png', FRENCH), '/docs/media/waveform.png');
	assert.equal(image('/media/waveform.png', ENGLISH), '/docs/media/waveform.png');
});

test('a document rendered from outside the content tree is treated as English', () => {
	assert.equal(page('/reference/', undefined), '/docs/reference/');
	assert.equal(page('/reference/', 'file:///tmp/scratch.md'), '/docs/reference/');
});
