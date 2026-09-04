import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import rehypeVerdictTables from '../handbook/src/plugins/rehype-verdict-tables.mjs';

const COMPARISON_PAGE = 'handbook/src/content/docs/start/how-soundscaper-compares.md';
// Generated from the repository by `scripts/docs-reference.mjs`, and the reason
// the transform cannot read its opt-in out of the shape of the cells.
const PLATFORMS_PAGE = 'handbook/src/content/docs/reference/generated/platforms.md';

const text = (value) => ({ type: 'text', value });
const element = (tagName, children) => ({ type: 'element', tagName, properties: {}, children });
const row = (cells) => element('tr', cells.map((cell) => element('td', Array.isArray(cell) ? cell : [text(cell)])));

const table = (rows) => element('table', [element('tbody', rows.map(row))]);

// The transform reads the source path of the page it was handed, so every tree
// is transformed as if it came from one: the comparison page unless said
// otherwise.
const transform = (tree, page = COMPARISON_PAGE) => {
	rehypeVerdictTables()(tree, { path: page });
	return tree;
};

const classesOf = (node) => node.properties?.className ?? [];

const cellsOf = (tree) => tree.children[0].children.flatMap((tr) => tr.children);

/** The body rows of every Markdown table in a page, header and rule dropped. */
const tablesIn = (source) => {
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
	return tables;
};

const VERDICT_WORDS = new Set(['Yes', 'Partial', 'No']);

/** The shape the transform used to take as the whole opt-in, on its own. */
const readsAsVerdicts = (rows) =>
	rows.length > 0 && rows.every((cells) => cells.length > 1 && cells.slice(1).every((cell) => VERDICT_WORDS.has(cell)));

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
 * The comparison page is the reason the transform exists, and asking for the
 * colouring does not by itself earn it: a row added later with a cell that
 * qualifies its verdict in prose would silently turn the colouring off for that
 * whole table, so the committed page is checked against the same shape rule the
 * transform applies on top of the opt-in.
 */
test('every comparison table on the committed page still qualifies', async () => {
	const tables = tablesIn(await readFile(COMPARISON_PAGE, 'utf8'));

	assert.ok(tables.length >= 12, `expected the comparison tables, found ${tables.length}`);
	for (const rows of tables) {
		const tree = transform(table(rows));
		assert.deepEqual(classesOf(tree), ['verdict-table'], `uncoloured table starting with row: ${rows[0]?.join(' | ')}`);
	}
});

/**
 * The trap the opt-in exists for. `reference/generated/platforms.md` lists the
 * browser engines against a `Tested automatically` column of bare `Yes` cells,
 * which is exactly the shape a comparison matrix has, so shape alone tinted a
 * generated support table green and badged it with a verdict semantic the
 * reference page never claimed - and would have turned a row red on its own the
 * day the generator writes `No` for an engine that is not tested yet.
 */
test('a generated reference page keeps its Yes/No tables plain', async () => {
	const tables = tablesIn(await readFile(PLATFORMS_PAGE, 'utf8'));
	const shaped = tables.filter(readsAsVerdicts);
	assert.ok(shaped.length >= 1, 'expected the browser support table to still read as bare verdicts');

	for (const rows of tables) {
		const tree = transform(table(rows), PLATFORMS_PAGE);
		assert.deepEqual(classesOf(tree), [], `coloured table starting with row: ${rows[0]?.join(' | ')}`);
		for (const cell of cellsOf(tree)) assert.deepEqual(classesOf(cell), []);
	}

	// The same rows do get coloured on the page that asked for it, so what the
	// generated page is spared is the opt-in and not the shape of its cells.
	assert.deepEqual(classesOf(transform(table(shaped[0]), COMPARISON_PAGE)), ['verdict-table']);
});

test('a Yes/No table on a page that never asked for the colouring is left alone', () => {
	const tree = transform(table([
		['Chromium (Chrome, Edge)', 'Yes'],
		['Firefox', 'Yes'],
		['WebKit (Safari)', 'No'],
	]), 'handbook/src/content/docs/reference/generated/languages.md');

	assert.deepEqual(classesOf(tree), []);
	for (const cell of cellsOf(tree)) assert.deepEqual(classesOf(cell), []);
});

test('a render with no source path colours nothing rather than guessing', () => {
	const tree = table([['Chromium (Chrome, Edge)', 'Yes']]);
	rehypeVerdictTables()(tree);

	assert.deepEqual(classesOf(tree), []);
	for (const cell of cellsOf(tree)) assert.deepEqual(classesOf(cell), []);
});
