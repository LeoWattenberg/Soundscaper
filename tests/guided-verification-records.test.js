/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// The guided records are the only place the project tracks what a person still
// has to run, watch, listen to, or decide. A row that loses its identifier, its
// result vocabulary, or its place in the roadmap's source list stops being
// something anyone can sign off, so the shape is pinned here.
const ROOT = new URL('../', import.meta.url);
const RECORDS = Object.freeze([
	{
		path: 'docs/milestones-1-to-4-guided-verification.md',
		results: ['pending', 'pass', 'fail', 'not-applicable'],
	},
	{
		path: 'docs/milestones-5-to-9-guided-verification.md',
		results: ['pending', 'pass', 'fail', 'blocked', 'not-applicable'],
	},
]);
const HEADING = /^## (?<title>.+)$/gmu;
const ROW = /^\| (?<id>[A-Z]{2,3}-\d{2}) \| (?<check>.+?) \| (?<result>[a-z-]+) \| (?<notes>.+?) \| (?<issue>.*?) \|$/u;

function sectionsOf(markdown) {
	const headings = [...markdown.matchAll(HEADING)];
	return headings.map((heading, index) => ({
		title: heading.groups.title,
		body: markdown.slice(
			heading.index,
			index + 1 < headings.length ? headings[index + 1].index : markdown.length,
		),
	}));
}

for (const record of RECORDS) {
	const markdown = await readFile(new URL(record.path, ROOT), 'utf8');
	const sections = sectionsOf(markdown);

	test(`${record.path} opens with a run identity table and closes with a completion record`, () => {
		assert.ok(sections.some(({ title }) => title === 'Run identity'), 'a run identity table is required');
		assert.equal(sections.at(-1)?.title, 'Completion record', 'the completion record comes last');
		assert.match(markdown, /Do not replace an observed failure with `not-applicable`\./u);
	});

	test(`${record.path} numbers every check row consecutively inside its section`, () => {
		const seen = new Set();
		let tables = 0;
		for (const section of sections) {
			const ids = [];
			for (const line of section.body.split('\n')) {
				if (!line.startsWith('| ') || !ROW.test(line)) continue;
				const { id, result, notes } = ROW.exec(line).groups;
				assert.ok(!seen.has(id), `${id} appears twice in ${record.path}`);
				seen.add(id);
				assert.ok(record.results.includes(result), `${id} records an unknown result "${result}"`);
				assert.ok(notes.trim().length > 0, `${id} must carry a Notes cell`);
				ids.push(id);
			}
			if (ids.length === 0) continue;
			tables += 1;
			const prefix = ids[0].split('-')[0];
			assert.deepEqual(
				ids,
				ids.map((_, index) => `${prefix}-${String(index + 1).padStart(2, '0')}`),
				`${section.title} must number ${prefix}-01 upwards without a gap`,
			);
		}
		assert.ok(tables >= 4, `${record.path} must carry several check tables`);
		assert.ok(seen.size >= 20, `${record.path} must carry a substantial number of rows`);
	});

	test(`${record.path} is reachable from the roadmap's source list`, async () => {
		const roadmap = await readFile(new URL('roadmap.md', ROOT), 'utf8');
		assert.ok(roadmap.includes(record.path), `roadmap.md must link ${record.path}`);
	});
}

test('every check table declares the same five columns', async () => {
	for (const record of RECORDS) {
		const markdown = await readFile(new URL(record.path, ROOT), 'utf8');
		const headers = markdown.match(/^\| ID \| Check \| Result \| Notes \| Issue \|$/gmu) ?? [];
		const separators = markdown.match(/^\| --- \| --- \| --- \| --- \| --- \|$/gmu) ?? [];
		assert.ok(headers.length >= 4, `${record.path} must head each check table with the five columns`);
		assert.equal(separators.length, headers.length, `${record.path} has a table without its separator row`);
	}
});
