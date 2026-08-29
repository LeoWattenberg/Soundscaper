/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// This is the only record allowed to carry human-check results. Historical
// paths remain as link-only compatibility stubs so old evidence and bookmarks
// do not create a second sign-off authority.
const ROOT = new URL('../', import.meta.url);
const RECORD = Object.freeze({
	path: 'docs/milestone-9-guided-verification.md',
	results: ['pending', 'pass', 'fail', 'blocked', 'not-applicable'],
});
const LEGACY_PATHS = Object.freeze([
	'docs/milestones-1-to-4-guided-verification.md',
	'docs/milestones-5-to-9-guided-verification.md',
]);
const EXPECTED_PREFIX_COUNTS = Object.freeze({
	SB: 9,
	FB: 17,
	SD: 5,
	FD: 6,
	PI: 4,
	SW: 5,
	FW: 6,
	PW: 4,
	SN: 12,
	FN: 14,
	SDL: 9,
	FDL: 10,
	LA: 17,
	CAP: 10,
	REL: 14,
	GAT: 10,
});
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

function expectedIds() {
	return Object.entries(EXPECTED_PREFIX_COUNTS).flatMap(([prefix, count]) =>
		Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(2, '0')}`));
}

const markdown = await readFile(new URL(RECORD.path, ROOT), 'utf8');
const sections = sectionsOf(markdown);

test('the milestone-9 record owns one campaign identity and final completion record', () => {
	assert.equal(sections.filter(({ title }) => title === 'Run identity').length, 1);
	assert.equal(sections.filter(({ title }) => title === 'Execution ledger').length, 1);
	assert.equal(sections.at(-1)?.title, 'Completion record');
	assert.match(markdown, /Do not replace an observed failure with `not-applicable`\./u);
	assert.match(markdown, /human checks block only the stable 1\.0 release/iu);
	assert.match(markdown, /never block builds,\s+tests, feature admission, or surface visibility/iu);
});

test('the milestone-9 record preserves every one of the 152 stable row IDs', () => {
	const seen = new Set();
	const actual = [];
	let tables = 0;
	for (const section of sections) {
		const ids = [];
		for (const line of section.body.split('\n')) {
			if (!line.startsWith('| ')) continue;
			const match = ROW.exec(line);
			if (!match) continue;
			const { id, result, notes } = match.groups;
			assert.ok(!seen.has(id), `${id} appears twice in ${RECORD.path}`);
			seen.add(id);
			actual.push(id);
			assert.ok(RECORD.results.includes(result), `${id} records an unknown result "${result}"`);
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
	assert.ok(tables >= 16, `${RECORD.path} must retain every check table`);
	assert.deepEqual(new Set(actual), new Set(expectedIds()));
	assert.equal(seen.size, 152);
});

test('stable qualification checks only the MIDI absence fence, never future MIDI design', () => {
	const row = markdown.split('\n').find((line) => line.startsWith('| GAT-01 |'));
	assert.ok(row, 'GAT-01 must remain in the closed 152-row inventory');
	assert.match(row, /stable-1\.0 MIDI absence fence/iu);
	assert.match(row, /future MIDI.*post-1\.0.*cannot block stable/iu);
	assert.doesNotMatch(row, /review a public pinned Audacity design|migration and opaque-preservation plans/iu);
});

test('every canonical check table declares the same five columns', () => {
	const headers = markdown.match(/^\| ID \| Check \| Result \| Notes \| Issue \|$/gmu) ?? [];
	const separators = markdown.match(/^\| --- \| --- \| --- \| --- \| --- \|$/gmu) ?? [];
	assert.equal(headers.length, 16);
	assert.equal(separators.length, headers.length);
});

test('Web VCR human checks validate enabled-lazy behavior without becoming feature gates', () => {
	assert.match(
		markdown,
		/\| GAT-02 \|.*packaged Framescaper.*default-hidden.*direct user action.*lazily.*Soundscaper.*browser routes.*no Web VCR/isu,
	);
	assert.match(
		markdown,
		/\| GAT-04 \|.*framescaperWebVcr` is `true`.*stable 1\.0 admission only.*never disable.*720p.*1080p.*4K/isu,
	);
});

test('legacy paths are non-authoritative stubs pointing to the milestone-9 record', async () => {
	for (const path of LEGACY_PATHS) {
		const stub = await readFile(new URL(path, ROOT), 'utf8');
		assert.match(stub, /non-authoritative compatibility stub/iu);
		assert.match(stub, /milestone-9-guided-verification\.md/u);
		assert.doesNotMatch(stub, /^\| [A-Z]{2,3}-\d{2} \|/gmu);
		assert.doesNotMatch(stub, /^## (?:Run identity|Completion record)$/gmu);
	}
});

test('the canonical record remains reachable while the roadmap link migrates', async () => {
	const roadmap = await readFile(new URL('roadmap.md', ROOT), 'utf8');
	const direct = roadmap.includes(RECORD.path);
	const throughCompatibilityStub = LEGACY_PATHS.some((path) => roadmap.includes(path));
	assert.ok(direct || throughCompatibilityStub);
	assert.match(
		roadmap,
		/every human.*checkpoint.*milestone 9.*stable 1\.0.*never.*(?:build|building).*test.*package.*runtime/isu,
	);
	assert.doesNotMatch(roadmap, /8B.*Blocked|Blocked.*Audacity/iu);
});
