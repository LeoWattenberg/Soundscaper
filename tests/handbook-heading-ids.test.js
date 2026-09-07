import test from 'node:test';
import assert from 'node:assert/strict';

import rehypeHandbookHeadingIds from '../handbook/src/plugins/rehype-handbook-heading-ids.mjs';

function heading(children, tagName = 'h2') {
	const node = { type: 'element', tagName, properties: {}, children };
	rehypeHandbookHeadingIds()({ type: 'root', children: [node] });
	return node;
}

const text = (value) => ({ type: 'text', value });

/**
 * Astro derives a heading's id from its text and a translated heading has
 * different text, so a heading that is linked to writes its id out and the
 * translator carries it through as protected text.
 */
test('a heading takes the id its source writes out and stops showing the marker', () => {
	const node = heading([text('Sharing programs {#sharing-programs}')]);

	assert.equal(node.properties.id, 'sharing-programs');
	assert.deepEqual(node.children, [text('Sharing programs')]);
});

test('the marker is read from the end of a heading that carries markup', () => {
	const node = heading([
		{ type: 'element', tagName: 'code', properties: {}, children: [text('sound')] },
		text(' API {#sound-api}'),
	]);

	assert.equal(node.properties.id, 'sound-api');
	assert.deepEqual(node.children.at(-1), text(' API'));
});

test('a heading with no marker keeps the id Astro derives for it', () => {
	const node = heading([text('Limits')]);

	assert.equal(node.properties.id, undefined);
	assert.deepEqual(node.children, [text('Limits')]);
});

test('a marker that is the whole heading text leaves no empty text node behind', () => {
	const node = heading([
		{ type: 'element', tagName: 'code', properties: {}, children: [text('sound')] },
		text('{#sound}'),
	]);

	assert.equal(node.properties.id, 'sound');
	assert.equal(node.children.length, 1);
});

test('only headings are touched', () => {
	const node = heading([text('Not a heading {#id}')], 'p');

	assert.equal(node.properties.id, undefined);
});
