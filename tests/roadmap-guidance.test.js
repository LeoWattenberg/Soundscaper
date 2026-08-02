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

	assert.ok(lineCount <= 1_000, `roadmap grew to ${lineCount} lines`);
	assert.match(roadmap, /## How to use this roadmap/iu);
	assert.match(roadmap, /### Agent operating rules/iu);
	assert.match(roadmap, /earliest incomplete prerequisite/iu);
	assert.match(roadmap, /implementation evidence.*owning modules.*focused tests/isu);
	assert.match(roadmap, /2\. Shared platform\/storage\/media.*current priority/iu);
	assert.match(roadmap, /### Remaining work, in priority order/iu);
	assert.match(roadmap, /## 2\. Shared platform, storage, and media foundation.*### Exit gate/isu);
	assert.match(
		roadmap,
		/Shared.*Implemented for disposable previews.*trusted retained-original digest.*versioned recipe.*outside project history.*not editorial proxies/isu,
	);
	assert.match(
		roadmap,
		/Implemented for the maintained first-party\s+audio fallback.*exact-schema audio whole-mix source.*only by\s+its feature requirement.*explicit managed handoff.*editable\s+original.*fresh recipient.*controller-owned manifest digest check.*recipient document.*read-only.*canonical state.*unprojected/isu,
	);
	assert.match(
		roadmap,
		/Implemented for the maintained first-party\s+video-effects fallback.*exact-schema video fallback.*unavailable video-effects requirement.*explicit managed handoff.*manifest-only fallback.*editable\s+retained original.*fresh recipient.*both exact bodies.*canonical shadow.*separate controller digest check.*Canonical project.*unchanged.*generic fallback.*browser or packaged qualification remain open/isu,
	);
	assert.match(
		roadmap,
		/Implemented for managed-media ownership and bounded\s+startup reclamation.*schema-3 canonical and stage inventories.*descriptor provenance.*lease.*fencing tokens.*before body or\s+optional hard-link work.*catalog publication.*materialized inventory.*published atomically.*retires stale tracked catalog rows.*registered regular stages and bodies.*lease-fenced.*persisted bounded passes.*unmanaged.*unregistered.*legacy.*symlinked.*non-regular.*foreign content stays untouched.*compiled desktop\s+runtime.*packaged source-bearing UI qualification remains\s+open/isu,
	);
	assert.doesNotMatch(
		roadmap,
		/In progress[^\n]*.*managed-media reclamation and logical row retirement/isu,
	);
	assert.match(roadmap, /docs\/production-threat-model\.md/iu);
	assert.match(roadmap, /docs\/project-compatibility\.md/iu);
	assert.doesNotMatch(roadmap, /\b\d+ test files\b/iu);
	assert.doesNotMatch(roadmap, /It remained green at/iu);
	assert.doesNotMatch(roadmap, /observed .* seconds/iu);
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
