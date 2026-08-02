/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

test('linked-video compatibility policy qualifies bounded same-store source reachability', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-desktop-linked-retained-video-original');
	assert.ok(rule);
	assert.match(
		rule.requiredOutcome,
		/opt-in maintained controller save.*queued write execution.*complete live-session.*Undo.*Redo.*clipboard.*cache roots.*direct caller.*without authoritative roots.*no destructive source cleanup/iu,
	);
	assert.match(
		rule.requiredOutcome,
		/exact-schema-9 current project.*every retained revision.*timeline.*Project Bin.*feature fallback.*durable roots.*first- or third-party provenance/iu,
	);
	assert.match(
		rule.requiredOutcome,
		/malformed, older-schema, future-schema.*over-bound current or revision state.*suppress.*64 retained revisions.*100,000 aggregate roots.*100,000 binding rows.*128 unique exact locator/iu,
	);
	assert.match(
		rule.requiredOutcome,
		/after project and retained-revision publication.*one atomic memory or IndexedDB binding prune.*Desktop.*after an exact remote acknowledgement.*latest-project-mutation lock.*bind-before-canonical-import.*transiently protected.*durable or authoritative live root/iu,
	);
	assert.match(
		rule.requiredOutcome,
		/project cleanup failure.*save successful.*report.*later opted-in save retry.*re-inventory.*same-store aliases.*before exact release.*no external-file stat, write, deletion, or body load/iu,
	);
	assert.match(
		rule.requiredOutcome,
		/same live store and renderer lifecycle.*separate stores, profiles, processes.*crash windows.*hostile rows.*publication, prune, and exact release.*one cross-boundary transaction.*unqualified/iu,
	);

	assert.match(
		rule.currentBehavior,
		/autosave and maintained explicit saves.*snapshot.*complete live-session source identities.*queued write begins.*all open-tab Undo and Redo histories.*clipboard.*render-cache protection.*direct store callers.*omit.*protectedLinkedVideoSourceIds.*retain every binding/iu,
	);
	assert.match(
		rule.currentBehavior,
		/current exact-schema-9 document.*every retained exact-schema-9 revision.*timeline clips, Project Bin clips, and every feature-requirement fallback.*without provenance gating.*at most 64.*100,000.*128.*fails? closed.*no binding deletion/iu,
	);
	assert.match(
		rule.currentBehavior,
		/after the project and revision save.*one compensated memory batch or one IndexedDB readwrite transaction.*Desktop.*exact canonical acknowledgement.*same latest-mutation serialization lock.*transient source set.*binding publication.*durable graph.*authoritative live roots/iu,
	);
	assert.match(
		rule.currentBehavior,
		/prune failure.*committed cleanup error.*resolved save.*later opted-in save.*retries.*complete current binding inventory.*surviving alias.*suppresses.*exact locator-ID and revision release.*never loads the linked body or stats, writes, or deletes the selected external video/iu,
	);

	for (const evidence of [
		'src/common/editor/controller/project-retention-service.ts',
		'src/common/editor/controller/project-save-service.ts',
		'src/common/editor/storage/linked-video-original-project-reachability-repository.ts',
		'src/common/editor/storage/linked-video-original-project-save.ts',
		'tests/audio-editor-desktop-shared-project-mutation-serialization.test.ts',
		'tests/audio-editor-linked-video-project-reachability-repository.test.ts',
		'tests/audio-editor-linked-video-project-save-lifecycle.test.ts',
		'tests/audio-editor-linked-video-project-save-reconciliation.test.ts',
		'tests/audio-editor-project-save-options.test.ts',
		'tests/audio-editor-project-services.test.ts',
	]) assert.ok(rule.evidence.includes(evidence), `missing compatibility evidence: ${evidence}`);

	const documentation = (await readFile(documentationUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.match(
		documentation,
		/opt-in maintained controller save.*queued write begins.*Undo.*Redo.*clipboard.*render-cache.*direct store callers.*no destructive source-level cleanup/iu,
	);
	assert.match(
		documentation,
		/current exact-schema-9 project.*every retained exact-schema-9 revision.*timeline clips, Project Bin clips, and every feature-requirement fallback.*first-party or third-party provenance.*64 retained revisions.*100,000.*128/iu,
	);
	assert.match(
		documentation,
		/Desktop.*exact canonical remote acknowledgement.*latest-project-mutation lock.*bind-before-canonical-import.*transient protection.*prune failure.*project save remains successful.*later opted-in save.*retry/iu,
	);
	assert.match(
		documentation,
		/before exact release.*re-inventories.*same-store bindings.*surviving.*alias suppresses.*no external-file stat, write, deletion, or body load/iu,
	);
	assert.match(
		documentation,
		/separate stores, profiles.*processes.*crash windows.*do not qualify.*hostile-row.*not one cross-boundary transaction/iu,
	);
});
