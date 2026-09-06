/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SOUNDSCAPER_GUIDE_GROUPS } from '../handbook/guides/soundscaper.mjs';
import { SOUNDSCAPER_TUTORIALS } from '../handbook/guides/tutorials.mjs';

/**
 * The front page lists the tutorials and the how-to categories by hand, because
 * it is a splash page with a hero rather than a generated index. The catalogs
 * it mirrors are the same ones the generated indexes are rendered from, so a
 * category or tutorial added to a catalog without being added here would leave
 * the front page quietly incomplete. This holds the page to the catalogs, in
 * their order and in their words.
 */
const FRONT_PAGE = new URL('../handbook/src/content/docs/index.md', import.meta.url);

function positionsOf(page, lines) {
	return lines.map((line) => {
		const position = page.indexOf(line);
		assert.notEqual(position, -1, `The handbook front page must list:\n${line}`);
		return position;
	});
}

function assertAscending(positions, what) {
	for (let index = 1; index < positions.length; index += 1) {
		assert.ok(positions[index] > positions[index - 1], `The front page lists the ${what} out of catalog order.`);
	}
}

test('the front page lists every how-to category as the catalog states it', async () => {
	const page = await readFile(FRONT_PAGE, 'utf8');
	const lines = SOUNDSCAPER_GUIDE_GROUPS.map((group) => (
		`- [${group.title}](/guides/${group.slug}/) — ${group.description}`
	));
	assertAscending(positionsOf(page, lines), 'how-to categories');
	assert.match(page, /\]\(\/guides\/\)/u, 'The front page must link to the full guide index.');
});

test('the front page lists every tutorial as the catalog states it', async () => {
	const page = await readFile(FRONT_PAGE, 'utf8');
	const lines = SOUNDSCAPER_TUTORIALS.map((tutorial) => (
		`- [${tutorial.title}](/tutorials/${tutorial.id}/) — ${tutorial.description}`
	));
	assertAscending(positionsOf(page, lines), 'tutorials');
	assert.match(page, /\]\(\/tutorials\/\)/u, 'The front page must link to the full tutorial index.');
});
