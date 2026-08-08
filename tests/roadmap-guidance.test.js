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
		/Implemented for the closed audio whole-mix\s+fallback role.*unavailable or unknown canonical feature identities.*portable `\.scape` playback.*explicit managed handoff.*fresh\s+recipient.*maintained final-mix delivery.*canonical state.*read-only and\s+unprojected/isu,
	);
	assert.match(
		roadmap,
		/- \*\*Shared \/ Electron Enhanced — Implemented for the closed full-project video\s+role and one clip-local first-party `videoEffects` relationship:\*\* unavailable\s+or unknown canonical feature identities qualify only for the full-project\s+role\. Both exact-schema relationships reach portable `\.scape`, managed\s+handoff, playback, and maintained delivery without canonical mutation\. Other\s+roles and packaged\/browser qualification remain open\./u,
	);
	assert.match(
		roadmap,
		/Implemented for point-in-time linked retained\s+video.*exact product-local binding.*exact-revision.*digest-verified.*owner-scoped range playback.*maintained visual\s+lifecycle.*without another whole-original `Blob`.*fresh\s+descriptor-free\s+shared load.*without an owned-media copy.*explicit managed\s+handoff/isu,
	);
	assert.match(
		roadmap,
		/Implemented for bounded linked PCM.*WAV, classic AIFF, and canonical first-party AIFF-C float32.*unowned and\s+pathless.*exact-revision range reads.*avoid another whole-original `Blob`.*portable `\.scape` and managed handoff.*canonical PCM/isu,
	);
	assert.match(
		roadmap,
		/Electron Enhanced — In progress.*broaden the concrete platform locator.*beyond the bounded linked-PCM and retained-video slices.*finish broader linked and unmanaged-original lifecycles beyond the maintained\s+exact- or changed-content silent retained-video and exact-content linked-PCM\s+Project Bin relink flows.*stable playback identity beyond the maintained owned canonical PCM,\s+linked-PCM, and retained-video lifecycles/isu,
	);
	assert.match(
		roadmap,
		/Implemented for managed-media ownership and bounded\s+startup reclamation.*schema-3 canonical and stage inventories.*descriptor provenance.*lease.*fencing tokens.*before body or\s+optional hard-link work.*catalog publication.*materialized inventory.*published atomically.*retires stale tracked catalog rows.*registered regular stages and bodies.*lease-fenced.*persisted bounded passes.*unmanaged.*unregistered.*legacy.*symlinked.*non-regular.*foreign content stays untouched.*compiled desktop\s+runtime.*packaged source-bearing UI qualification remains\s+open/isu,
	);
	assert.match(
		roadmap,
		/Implemented for bounded cooperative startup\s+locator reconciliation.*persistent IndexedDB opens.*before project\s+loading.*authoritative point-in-time catalog.*at most 10,000 exact project\/revision summaries.*one atomic transaction.*at most 100,000 closed binding rows.*deletes catalog-absent bindings.*source-unreachable bindings only from bounded catalog-revision-matched\s+exact-schema-9 current and retained graphs.*preserves unverifiable local\s+graphs and any surviving locator alias.*at most 128 exact\s+locator\/revision references.*durable-unavailable storage sends nothing.*invalid catalog or binding scans reject before IPC.*at most one\s+successful serialized pass per store\/process.*absent\s+startup-loaded metadata.*referenced and current-process\s+records.*external media.*never inspected or deleted.*continuous cleanup\s+beyond bounded startup and maintained save\/activation\/delete\/clear.*coordination beyond the same-database newly-published-binding root window.*hostile-renderer inventory authority.*abrupt-crash\/power-loss durability.*packaged\/OS qualification remain open/isu,
	);
	assert.match(
		roadmap,
		/Electron Enhanced \/ Shared — Implemented:.*revision- and live-history-aware\s+same-store saves and successful writable activations.*source-unreachable\s+linked-original bindings.*exact locator retirement after saves, activations,\s+project deletion, and clear.*live aliases.*external files/isu,
	);
	assert.match(
		roadmap,
		/Electron Enhanced — In progress.*continuous linked-locator cleanup beyond bounded startup and maintained\s+save\/activation\/delete\/clear.*coordination beyond the same-database\s+newly-published-binding root window/isu,
	);
	assert.doesNotMatch(
		roadmap,
		/In progress[^\n]*.*managed-media reclamation and logical row retirement/isu,
	);
	assert.doesNotMatch(
		roadmap,
		/In progress[^\n]*.*linked-locator reconciliation/isu,
	);
	assert.doesNotMatch(roadmap, /beyond bounded point-in-time whole-body import/iu);
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
