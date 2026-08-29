/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const roadmapUrl = new URL('../roadmap.md', import.meta.url);
const roadmapReferenceUrls = [
	new URL('../config/production-capabilities.json', import.meta.url),
	new URL('../config/production-licensing-matrix.json', import.meta.url),
	new URL('../config/project-compatibility.json', import.meta.url),
	new URL('../config/quality-budgets.json', import.meta.url),
];

test('roadmap remains a concise forward-looking guide for agents', async () => {
	const roadmap = await readFile(roadmapUrl, 'utf8');
	const lineCount = roadmap.split('\n').length;

	// The ceiling exists to keep the roadmap a map rather than a record: it stops
	// agents accumulating evidence — measurements, run results, dated outcomes,
	// historical narrative — in a file whose job is to say what is next. That
	// material belongs in the owning plan documents and machine-readable
	// registers, which is why the assertions below also forbid test counts,
	// green-run notes, and observed timings. The remaining lines are therefore
	// room for genuinely new scope, not spare capacity: it was raised from 1_000
	// when milestones 8+C and 9+ were added, and the correct response to hitting
	// it again is a new owning document, not a compression pass over the
	// milestone sections that are already here.
	assert.ok(lineCount <= 1_400, `roadmap grew to ${lineCount} lines`);
	assert.match(roadmap, /## How to use this roadmap/iu);
	assert.match(roadmap, /### Agent operating rules/iu);
	assert.match(roadmap, /earliest incomplete prerequisite/iu);
	assert.match(roadmap, /implementation evidence.*owning modules.*focused tests/isu);
	assert.match(
		roadmap,
		/2\. Shared platform\/storage\/media.*implemented.*release qualification belongs to milestone 9/iu,
	);
	assert.match(
		roadmap,
		/3\. Editorial foundations.*software implementation active.*qualification belongs to milestone 9/iu,
	);
	assert.match(
		roadmap,
		/8\+C\. Framescaper product origin.*Implemented for family-v1.*immediate no-legacy cutover.*permanent transfer routes/iu,
	);
	assert.match(
		roadmap,
		/8\. Framescaper capture.*Implemented and active.*MIDI moves to post-1\.0 milestone 9\+/iu,
	);
	assert.match(
		roadmap,
		/9\+\. Post-1\.0 extensions.*MIDI and installable distribution/iu,
	);
	const milestoneNine = roadmap.slice(
		roadmap.indexOf('## 9. Final convergence and qualification'),
		roadmap.indexOf('## 9+. Post-1.0 extensions'),
	);
	const postRelease = roadmap.slice(roadmap.indexOf('## 9+. Post-1.0 extensions'));
	assert.doesNotMatch(milestoneNine, /\bMIDI\b/iu);
	assert.match(
		milestoneNine,
		/11 dual-product soak runtime cells.*22 real eight-hour\s+runs/isu,
		'Milestone 9 must distinguish soak cells from product/environment behavior cells',
	);
	assert.match(postRelease, /### 8B\. MIDI.*legacy packet identifier.*excluded from stable 1\.0/isu);
	assert.match(roadmap, /### Frozen closure scope/iu);
	assert.match(roadmap, /config\/milestone-2-closure\.json/iu);
	assert.match(roadmap, /Unnamed work\s+cannot block closure/iu);
	assert.match(roadmap, /scopeRevision.*milestone 3 or\s+later/isu);
	assert.match(roadmap, /### Open closure items, in priority order/iu);
	assert.match(
		roadmap,
		/Soundscaper no longer emits.*old Framescaper app.*no legacy user\s+population.*transfer routes.*remain\s+permanent/isu,
	);
	assert.match(roadmap, /## 2\. Shared platform, storage, and media foundation.*### Exit gate/isu);
	assert.match(roadmap, /docs\/production-threat-model\.md/iu);
	assert.match(roadmap, /docs\/project-compatibility\.md/iu);
	assert.doesNotMatch(roadmap, /\b\d+ test files\b/iu);
	assert.doesNotMatch(roadmap, /It remained green at/iu);
	assert.doesNotMatch(roadmap, /observed .* seconds/iu);
});

test('roadmap separates hosted exact-media qualification from open owner-host profiles', async () => {
	const roadmap = await readFile(roadmapUrl, 'utf8');
	assert.match(
		roadmap,
		/Windows x64.*RTX 3090.*reference.*M1\s+preview.*M4 production parity.*M4B-2\s+keyed parity.*passed/isu,
	);
	assert.match(
		roadmap,
		/reviewed hosted\s+hardware-lower-bound cohort.*qualifies.*current M4 production.*M4B-2\s+exact-media workloads/isu,
	);
	assert.match(
		roadmap,
		/M1 preview and M3 long-form timing.*remain\s+`pending-external`.*all four owner-host packaged-runtime profiles.*remain\s+open/isu,
	);
});

test('machine-readable policy links resolve to current roadmap headings', async () => {
	const roadmap = await readFile(roadmapUrl, 'utf8');
	const headings = new Set([...roadmap.matchAll(/^#{1,6}\s+(.+)$/gmu)]
		.map(([, heading]) => githubHeadingSlug(heading)));

	for (const referenceUrl of roadmapReferenceUrls) {
		const policy = await readFile(referenceUrl, 'utf8');
		for (const [, anchor] of policy.matchAll(/roadmap\.md#([a-z0-9-]+)/gu)) {
			assert.ok(headings.has(anchor), `${referenceUrl.pathname} references missing #${anchor}`);
		}
	}
});

function githubHeadingSlug(heading) {
	return heading
		.toLowerCase()
		.replace(/[^\p{Letter}\p{Number} _-]/gu, '')
		.replace(/\s/gu, '-');
}
