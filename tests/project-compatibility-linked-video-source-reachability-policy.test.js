/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

test('linked-original compatibility policy qualifies bounded kindful same-store source reachability', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-kindful-linked-original-save-roots');
	assert.ok(rule);
	assert.match(
		rule.requiredOutcome,
		/opt-in maintained controller save.*queued write execution.*complete live-session.*kindful.*audio.*video.*Undo.*Redo.*clipboard.*recording.*render-cache.*direct caller.*without authoritative roots.*no destructive source cleanup/iu,
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
		/same textual source ID.*kind-distinct.*wrong-kind.*must not retain/iu,
	);
	assert.match(
		rule.requiredOutcome,
		/memory and IndexedDB.*linked WAV.*no owned PCM.*last durable revision.*canonical.*readable.*live audio root.*release.*exact locator.*once.*last live root.*external file.*untouched/iu,
	);
	assert.match(
		rule.requiredOutcome,
		/same live store and renderer lifecycle.*separate stores, profiles, processes.*crash windows.*hostile rows.*publication, prune, and exact release.*one cross-boundary transaction.*unqualified/iu,
	);

	assert.match(
		rule.currentBehavior,
		/queued autosaves, flushes, inactive-tab saves, and project-switch or analysis explicit saves.*frozen, deduplicated.*kind.*audio.*video.*sourceId.*queued write executes.*all open-tab Undo and Redo histories.*clip and fallback references.*clipboard media kind.*recording.*render-cache.*direct store callers.*omit.*authoritative.*retain every binding/iu,
	);
	assert.match(
		rule.currentBehavior,
		/same sourceId.*audio and video.*distinct.*wrong-kind metadata.*does not retain.*protectedLinkedVideoSourceIds.*compatibility facade.*direct callers/iu,
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
		/suppressed or failed maintenance.*one-save transient protection.*prune failure.*committed cleanup error.*resolved save.*later opted-in save.*retries.*complete current binding inventory.*surviving alias.*suppresses.*exact locator-ID and revision release/iu,
	);
	assert.match(
		rule.currentBehavior,
		/memory and IndexedDB.*no-owned-PCM linked WAV.*last durable revision.*live audio root.*canonical.*readable.*exact locator.*once.*last root disappears.*external WAV.*untouched/iu,
	);
	assert.match(
		rule.currentBehavior,
		/cross-store or cross-process coordination.*relink or watch.*audio range playback.*packaged executable or operating-system.*third-party activation gating.*legacy private librar/iu,
	);

	for (const evidence of [
		'src/common/editor/controller/project-retention-service.ts',
		'src/common/editor/controller/project-save-service.ts',
		'src/common/editor/storage/linked-original-lifecycle-coordinator.ts',
		'src/common/editor/storage/linked-original-project-reachability-repository.ts',
		'src/common/editor/storage/linked-original-project-save.ts',
		'src/common/editor/storage/linked-video-original-project-reachability-repository.ts',
		'src/common/editor/storage/linked-video-original-project-save.ts',
		'tests/audio-editor-linked-audio-project-save-reconciliation.test.ts',
		'tests/audio-editor-linked-original-lifecycle.test.ts',
		'tests/audio-editor-linked-original-project-save.test.ts',
		'tests/audio-editor-desktop-shared-project-mutation-serialization.test.ts',
		'tests/audio-editor-project-retention-service.test.ts',
		'tests/audio-editor-linked-video-project-reachability-repository.test.ts',
		'tests/audio-editor-linked-video-project-save-lifecycle.test.ts',
		'tests/audio-editor-linked-video-project-save-reconciliation.test.ts',
		'tests/audio-editor-project-save-options.test.ts',
		'tests/audio-editor-project-services.test.ts',
	]) assert.ok(rule.evidence.includes(evidence), `missing compatibility evidence: ${evidence}`);

	const documentation = (await readFile(documentationUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.match(
		documentation,
		/opt-in maintained controller save.*queued autosaves, flushes, inactive-tab saves, and project-switch or analysis explicit saves.*queued write executes.*kindful.*Undo.*Redo.*clipboard.*recording.*render-cache.*direct store callers.*no destructive source-level cleanup/iu,
	);
	assert.match(
		documentation,
		/same textual source ID.*audio and video.*distinct.*wrong-kind.*does not retain.*protectedLinkedVideoSourceIds.*compatibility facade/iu,
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
		/suppressed (?:or|and) failed.*one-save transient protection.*before exact release.*re-inventories.*same-store bindings.*surviving.*alias suppresses/iu,
	);
	assert.match(
		documentation,
		/memory and IndexedDB.*no-owned-PCM linked WAV.*last durable revision.*live audio root.*canonically readable.*last root disappears.*exact locator.*once.*external WAV.*untouched/iu,
	);
	assert.match(
		documentation,
		/separate stores, profiles.*processes.*crash windows.*do not qualify.*hostile-row.*not one cross-boundary transaction/iu,
	);
});
