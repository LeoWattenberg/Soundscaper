/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import rehypeGeneratedPageSections from '../handbook/src/plugins/rehype-generated-page-sections.mjs';

function element(tagName, children = [], properties = {}) {
	return { type: 'element', tagName, properties, children };
}

function text(value) {
	return { type: 'text', value };
}

function transform(children, path) {
	const tree = { type: 'root', children };
	rehypeGeneratedPageSections()(tree, { path });
	return tree;
}

test('an older translated model page gains a localized purpose and a closed test disclosure', () => {
	const tree = transform([
		element('p', [text('Sprachbereiche vor der Transkription finden.')]),
		element('h2', [text('Was der paketierte Test prüft')], { id: 'what-the-packaged-test-checks' }),
		element('p', [text('Fall und Eingabe.')]),
		element('h2', [text('Ergebnis prüfen')], { id: 'review-the-result' }),
	], '/repo/handbook/src/content/docs/de/reference/local-models/silero-vad-v6.md');

	assert.equal(tree.children[0].tagName, 'h2');
	assert.equal(tree.children[0].properties.id, 'purpose-and-use-case');
	assert.equal(tree.children[0].children[0].value, 'Zweck und Anwendungsfall');
	assert.equal(tree.children[2].tagName, 'details');
	assert.deepEqual(tree.children[2].properties, { id: 'what-the-packaged-test-checks' });
	assert.equal(tree.children[2].properties.open, undefined);
	assert.equal(tree.children[2].children[0].tagName, 'summary');
	assert.equal(tree.children[2].children[0].children[0].value, 'Was der paketierte Test prüft');
	assert.equal(tree.children[3].properties.id, 'review-the-result');
});

test('older guide and tutorial translations reuse their localized provenance heading as the summary', () => {
	for (const [path, expectedPurpose, spec] of [
		['fr/guides/editing/split-a-clip.md', 'À quoi sert ce guide', 'soundscaper-guides.spec.js'],
		['fr/tutorials/your-first-project.md', 'À quoi sert ce tutoriel', 'soundscaper-tutorials.spec.js'],
	]) {
		const tree = transform([
			element('p', [text('Une introduction utile.')]),
			element('h2', [text('À propos de cette page')], { id: 'about' }),
			element('p', [element('code', [text(`tests/browser/${spec}`)])]),
		], `/repo/handbook/src/content/docs/${path}`);
		assert.equal(tree.children[0].children[0].value, expectedPurpose);
		assert.equal(tree.children[0].properties.id, path.includes('/guides/')
			? 'what-this-guide-is-for'
			: 'what-this-tutorial-is-for');
		assert.equal(tree.children[2].tagName, 'details');
		assert.equal(tree.children[2].children[0].children[0].value, 'À propos de cette page');
	}
});

test('current pages with their own purpose heading and details are unchanged', () => {
	const original = [
		element('h2', [text('Purpose and use case')], { id: 'purpose-and-use-case' }),
		element('p', [text('Find speech regions.')]),
		element('details', [element('summary', [text('What the desktop test checks')])], {
			id: 'what-the-packaged-test-checks',
		}),
	];
	const tree = transform(original, '/repo/handbook/src/content/docs/reference/local-models/silero-vad-v6.md');
	assert.deepEqual(tree.children, original);
});

test('a current guide purpose heading is not duplicated', () => {
	const original = [
		element('h2', [text('What this guide is for')], { id: 'what-this-guide-is-for' }),
		element('p', [text('Split one clip into two.')]),
		element('details', [element('summary', [text('How this guide stays correct')])]),
	];
	const tree = transform(original, '/repo/handbook/src/content/docs/guides/editing/split-a-clip.md');
	assert.deepEqual(tree.children, original);
});

test('a current guide index does not turn the heading before its disclosure into a summary', () => {
	const original = [
		element('h2', [element('a', [text('Analysis')], { href: '/guides/analysis/' })], { id: 'analysis' }),
		element('p', [text('Measure and inspect a recording.')]),
		element('details', [
			element('summary', [text('How the guides stay correct')]),
			element('p', [element('code', [text('tests/browser/soundscaper-guides.spec.js')])]),
		]),
	];
	const tree = transform(original, '/repo/handbook/src/content/docs/guides/index.md');
	assert.equal(tree.children[0].tagName, 'h2');
	assert.equal(tree.children[0].children[0].tagName, 'a');
	assert.equal(tree.children[1].tagName, 'p');
	assert.equal(tree.children[2].tagName, 'details');
	assert.equal(tree.children[2].children[0].tagName, 'summary');
});

test('a raw current disclosure also protects the heading before it', () => {
	const tree = transform([
		element('h2', [element('a', [text('Analysis')], { href: '/guides/analysis/' })], { id: 'analysis' }),
		element('p', [text('Measure and inspect a recording.')]),
		{ type: 'raw', value: '<details><summary>How the guides stay correct</summary>tests/browser/soundscaper-guides.spec.js</details>' },
	], '/repo/handbook/src/content/docs/guides/index.md');
	assert.equal(tree.children[0].tagName, 'h2');
	assert.equal(tree.children[2].type, 'raw');
});
