import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import rehypeVerdictTables from '../handbook/src/plugins/rehype-verdict-tables.mjs';

const COMPARISON_PAGE = 'handbook/src/content/docs/start/how-soundscaper-compares.md';

const text = (value) => ({ type: 'text', value });
const element = (tagName, children) => ({ type: 'element', tagName, properties: {}, children });
const row = (cells) => element('tr', cells.map((cell) => element('td', Array.isArray(cell) ? cell : [text(cell)])));

const table = (rows) => element('table', [element('tbody', rows.map(row))]);

const transform = (tree) => {
	rehypeVerdictTables()(tree);
	return tree;
};

const classesOf = (node) => node.properties?.className ?? [];

const cellsOf = (tree) => tree.children[0].children.flatMap((tr) => tr.children);

/**
 * The colouring is what a reader scans instead of reading the cell, so the
 * cases that matter are the two ends: a table where every comparison cell is a
 * verdict earns the classes, and one where any of them is prose keeps none.
 */
test('a comparison matrix has its verdict cells classed and its verdict word wrapped', () => {
	const tree = transform(table([
		['Native project format', 'Yes — a lossless portable archive', 'Partial — one project tempo', 'No'],
	]));

	const [capability, yes, partial, no] = cellsOf(tree);
	assert.deepEqual(classesOf(capability), []);
	assert.deepEqual(classesOf(yes), ['verdict-cell', 'verdict-cell--yes']);
	assert.deepEqual(classesOf(partial), ['verdict-cell', 'verdict-cell--partial']);
	assert.deepEqual(classesOf(no), ['verdict-cell', 'verdict-cell--no']);
	assert.deepEqual(classesOf(tree), ['verdict-table']);

	const [badge, detail] = yes.children;
	assert.equal(badge.tagName, 'span');
	assert.deepEqual(classesOf(badge), ['verdict', 'verdict--yes']);
	assert.deepEqual(badge.children, [text('Yes')]);
	// The em dash is dropped: the badge separates the verdict from its detail.
	assert.deepEqual(detail, text(' a lossless portable archive'));
	// A bare verdict is the badge and nothing else: no separator is left behind.
	assert.equal(no.children.length, 1);
	assert.deepEqual(no.children[0].children, [text('No')]);
});

test('a verdict whose detail opens with markup keeps the word space the em dash held', () => {
	const tree = transform(table([
		['Native project format', [text('Yes — '), element('code', [text('.sscape')]), text(', a portable archive')]],
	]));

	const [, cell] = cellsOf(tree);
	assert.deepEqual(cell.children[1], text(' '));
	assert.equal(cell.children[2].tagName, 'code');
});

test('one prose cell leaves the whole table uncoloured', () => {
	const tree = transform(table([
		['Audacity label text', 'Yes', 'Yes'],
		// The generated inventories put Yes/No columns beside prose ones, where a
		// red No would read as a fault rather than as a fact.
		['`.liscape`', 'No shipping product', 'Every product'],
	]));

	assert.deepEqual(classesOf(tree), []);
	for (const cell of cellsOf(tree)) assert.deepEqual(classesOf(cell), []);
});

test('the first column is read as the row label, never as a verdict', () => {
	const tree = transform(table([['No', 'Yes']]));

	const [label, verdict] = cellsOf(tree);
	assert.deepEqual(classesOf(label), []);
	assert.deepEqual(label.children, [text('No')]);
	assert.deepEqual(classesOf(verdict), ['verdict-cell', 'verdict-cell--yes']);
});

/**
 * The comparison page is the reason the transform exists, and it opts in by
 * shape alone. A row added later with a cell that qualifies its verdict in
 * prose would silently turn the colouring off for that whole table, so the
 * committed page is checked against the same rule the transform applies.
 */
test('every comparison table on the committed page still qualifies', async () => {
	const source = await readFile(COMPARISON_PAGE, 'utf8');
	const tables = [];
	let current = null;
	for (const line of source.split('\n')) {
		if (!line.trimStart().startsWith('|')) {
			current = null;
			continue;
		}
		const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
		if (current === null) {
			current = [];
			tables.push(current);
			continue;
		}
		if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
		current.push(cells);
	}

	assert.ok(tables.length >= 12, `expected the comparison tables, found ${tables.length}`);
	for (const rows of tables) {
		const tree = transform(table(rows));
		assert.deepEqual(classesOf(tree), ['verdict-table'], `uncoloured table starting with row: ${rows[0]?.join(' | ')}`);
	}
});
