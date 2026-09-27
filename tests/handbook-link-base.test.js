import test from 'node:test';
import assert from 'node:assert/strict';

import rehypeHandbookBase from '../handbook/src/plugins/rehype-handbook-base.mjs';

function page(href, path, productId = 'soundscaper') {
	const tree = {
		type: 'root',
		children: [{ type: 'element', tagName: 'a', properties: { href }, children: [] }],
	};
	rehypeHandbookBase({ productId })(tree, { path });
	return tree.children[0].properties.href;
}

function linkedText(href, label, path, productId = 'soundscaper') {
	const tree = {
		type: 'root',
		children: [{
			type: 'element',
			tagName: 'a',
			properties: { href },
			children: [{ type: 'text', value: label }],
		}],
	};
	rehypeHandbookBase({ productId })(tree, { path });
	return tree.children[0];
}

function image(src, path, productId = 'soundscaper') {
	const tree = {
		type: 'root',
		children: [{ type: 'element', tagName: 'img', properties: { src }, children: [] }],
	};
	rehypeHandbookBase({ productId })(tree, { path });
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

test('a Soundscaper page sends Framescaper documentation to its own origin', () => {
	assert.equal(
		page('/framescaper/first-project/', ENGLISH),
		'https://framescaper.org/docs/first-project/',
	);
	assert.equal(
		page('/framescaper/video-export/', FRENCH),
		'https://framescaper.org/docs/fr/video-export/',
	);
});

test('a Framescaper page keeps its tutorials local and sends shared audio guides to Soundscaper', () => {
	assert.equal(page('/framescaper/first-project/', ENGLISH, 'framescaper'), '/docs/first-project/');
	assert.equal(page('/framescaper/video-export/', FRENCH, 'framescaper'), '/docs/fr/video-export/');
	assert.equal(
		page('/guides/', ENGLISH, 'framescaper'),
		'https://soundscaper.org/docs/guides/',
	);
	assert.equal(
		page('/projects-and-data/project-files/', FRENCH, 'framescaper'),
		'https://soundscaper.org/docs/fr/projects-and-data/project-files/',
	);
	assert.equal(page('/', FRENCH, 'framescaper'), '/docs/fr/');
});

test('retired absolute Framescaper editor links follow its own origin', () => {
	assert.equal(
		page('https://soundscaper.org/framescaper/en/', ENGLISH, 'framescaper'),
		'https://framescaper.org/en/',
	);
	const link = linkedText(
		'https://soundscaper.org/framescaper/en/',
		'soundscaper.org/framescaper/en',
		FRENCH,
		'framescaper',
	);
	assert.equal(link.properties.href, 'https://framescaper.org/en/');
	assert.equal(link.children[0].value, 'framescaper.org/en');
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

test('an unsupported product is refused', () => {
	assert.throws(() => rehypeHandbookBase({ productId: 'lightscaper' }), /Unsupported handbook product/u);
});
