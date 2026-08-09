/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

test('linked-original compatibility policy qualifies bounded save and activation source reachability', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-kindful-linked-original-save-roots');
	assert.ok(rule);
	assert.match(
		rule.requiredOutcome,
		/opt-in maintained controller save.*terminal successful writable project activation.*queued write or serialized maintenance execution.*complete live-session.*kindful.*audio.*video.*Undo.*Redo.*clipboard.*recording.*render-cache.*direct save.*without authoritative roots.*activation.*without current write ownership.*no destructive source cleanup/iu,
	);
	assert.match(
		rule.requiredOutcome,
		/exact-schema-12 current project.*every retained revision.*timeline.*Project Bin.*feature fallback.*durable roots.*first- or third-party provenance/iu,
	);
	assert.match(
		rule.requiredOutcome,
		/malformed, older-schema, future-schema.*over-bound current or revision state.*suppress.*64 retained revisions.*100,000 aggregate roots.*100,000 binding rows.*128 unique exact locator/iu,
	);
	assert.match(
		rule.requiredOutcome,
		/after project and retained-revision publication or terminal activation.*one atomic memory or IndexedDB binding prune.*Desktop.*exact remote acknowledgement.*serialized activation.*latest-project-mutation lock/iu,
	);
	assert.match(
		rule.requiredOutcome,
		/maintained binding, replacement, and alias publication.*closed scalar provisional root.*exact binding generation.*same compensated memory batch or IndexedDB readwrite transaction.*exact unlink or rollback.*pair/iu,
	);
	assert.match(
		rule.requiredOutcome,
		/same-database bind-before-canonical-import.*independent cleanup.*exact durable graph membership or (?:a )?matching owner token.*consume.*caller wildcard.*must not consume.*stale owner.*replacement root.*failed or suppressed maintenance.*consume no root/iu,
	);
	assert.match(rule.requiredOutcome, /roots must not expire by time.*bounded safe leak.*pre-root binding rows.*need not be backfilled/iu);
	assert.match(
		rule.requiredOutcome,
		/project cleanup failure.*save or activation successful.*report.*later opted-in save or writable activation.*retry.*previously failed locator release.*rejects again.*not starve unrelated activation pruning.*re-inventory.*same-store aliases.*before exact release.*no external-file stat, write, deletion, or body load/iu,
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
		/same IndexedDB database.*independent browser connections.*binding\/root transaction.*different databases or profiles.*project catalog or main locator registry.*crash windows.*hostile rows.*publication, prune, and exact release.*one cross-boundary transaction.*unqualified/iu,
	);

	assert.match(
		rule.currentBehavior,
		/queued autosaves, flushes, inactive-tab saves, and project-switch or analysis explicit saves.*frozen, deduplicated.*kind.*audio.*video.*sourceId.*queued write executes.*terminal successful writable activation.*durable IndexedDB.*lifecycle.*latest-project-mutation.*revalidates.*active project.*write lock.*collects.*all open-tab Undo and Redo histories.*clipboard media kind.*recording.*render-cache.*direct store callers.*omit.*authoritative.*retain every binding/iu,
	);
	assert.match(
		rule.currentBehavior,
		/same sourceId.*audio and video.*distinct.*wrong-kind metadata.*does not retain.*protectedLinkedVideoSourceIds.*compatibility facade.*direct callers/iu,
	);
	assert.match(
		rule.currentBehavior,
		/current exact-schema-12 document.*every retained exact-schema-12 revision.*timeline clips, Project Bin clips, and every feature-requirement fallback.*without provenance gating.*at most 64.*100,000.*128.*fails? closed.*no binding deletion/iu,
	);
	assert.match(
		rule.currentBehavior,
		/after the project and revision save or terminal activation.*one compensated memory batch or one IndexedDB readwrite transaction.*Desktop.*exact canonical acknowledgement.*serialized activation.*same latest-mutation serialization lock/iu,
	);
	assert.match(
		rule.currentBehavior,
		/every maintained new or replacement binding and copied alias.*closed scalar provisional root.*projectId.*kind.*sourceId.*bindingToken.*same compensated memory mutation or IndexedDB readwrite transaction.*exact unlink and determinate rollback.*pair/iu,
	);
	assert.match(
		rule.currentBehavior,
		/rooted binding.*same[- ]database.*independent cleanup.*exact durable current or retained graph.*matching local owner token.*consumes.*caller live root.*retains.*does not consume.*stale owner.*cannot consume.*replacement root.*suppressed or failed maintenance.*settles no roots/iu,
	);
	assert.match(
		rule.currentBehavior,
		/startup.*no owner token.*catalog-live rooted unreachable.*survives.*exact durable graph.*consumes.*catalog-absent.*binding\/root pair.*deleted.*invalid or unverifiable graph.*retained/iu,
	);
	assert.match(rule.currentBehavior, /roots have no time expiry.*bounded metadata.*version-8 upgrade.*does not backfill.*pre-root rows/iu);
	assert.match(
		rule.currentBehavior,
		/prune failure.*committed cleanup error.*resolved save or activation.*later opted-in save or writable activation.*retries.*previously failed pending release.*rejects again.*unrelated activation cleanup.*complete current binding inventory.*surviving alias.*suppresses.*exact locator-ID and revision release/iu,
	);
	assert.match(
		rule.currentBehavior,
		/memory and IndexedDB.*no-owned-PCM linked WAV.*last durable revision.*live audio root.*canonical.*readable.*exact locator.*once.*last root disappears.*external WAV.*untouched/iu,
	);
	assert.match(
		rule.currentBehavior,
		/same-database binding\/root publication.*independent browser connections.*different databases or profiles.*project-catalog and main-registry coordination.*crash or power-loss durability.*hostile storage or renderer authority.*relink or watch.*packaged executable or operating-system.*legacy private librar/iu,
	);

	for (const evidence of [
		'src/common/editor/controller/project-retention-service.ts',
		'src/common/editor/controller/project-save-service.ts',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/storage/desktop-shared-project-repository.ts',
		'src/common/editor/storage/linked-original-lifecycle-coordinator.ts',
		'src/common/editor/storage/linked-original-pair-writer.ts',
		'src/common/editor/storage/linked-original-project-binding-prune.ts',
		'src/common/editor/storage/linked-original-project-open-maintenance.ts',
		'src/common/editor/storage/linked-original-project-reachability-repository.ts',
		'src/common/editor/storage/linked-original-project-save.ts',
		'src/common/editor/storage/linked-original-provisional-root.ts',
		'src/common/editor/storage/linked-original-store-service.ts',
		'src/common/editor/storage/linked-original-transient-binding-reference.ts',
		'src/common/editor/storage/linked-video-original-project-reachability-repository.ts',
		'src/common/editor/storage/linked-video-original-project-save.ts',
		'tests/audio-editor-linked-audio-project-save-reconciliation.test.ts',
		'tests/audio-editor-linked-original-lifecycle.test.ts',
		'tests/audio-editor-linked-original-project-save.test.ts',
		'tests/audio-editor-linked-original-project-open-maintenance.test.ts',
		'tests/audio-editor-linked-original-provisional-root-reachability.test.ts',
		'tests/audio-editor-linked-original-provisional-root-startup.test.ts',
		'tests/audio-editor-linked-original-provisional-root-writers.test.ts',
		'tests/audio-editor-linked-original-provisional-root.test.ts',
		'tests/audio-editor-linked-original-transient-binding-reference.test.ts',
		'tests/audio-editor-desktop-shared-project-mutation-serialization.test.ts',
		'tests/audio-editor-project-switch-playback-apply.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/audio-editor-project-retention-service.test.ts',
		'tests/audio-editor-linked-video-project-reachability-repository.test.ts',
		'tests/audio-editor-linked-video-project-save-lifecycle.test.ts',
		'tests/audio-editor-linked-video-project-save-reconciliation.test.ts',
		'tests/audio-editor-project-save-options.test.ts',
		'tests/audio-editor-project-services.test.ts',
		'tests/browser/audio-editor-storage-migration.spec.js',
	]) assert.ok(rule.evidence.includes(evidence), `missing compatibility evidence: ${evidence}`);

	const documentation = (await readFile(documentationUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.match(
		documentation,
		/opt-in maintained controller save.*terminal successful writable activation.*queued autosaves, flushes, inactive-tab saves, and project-switch or analysis explicit saves.*queued write executes.*activation.*lifecycle and latest-project-mutation.*active project and write-lock identity.*roots.*inside.*serialized.*kindful.*Undo.*Redo.*clipboard.*recording.*render-cache.*direct store callers.*no destructive source-level cleanup/iu,
	);
	assert.match(
		documentation,
		/same textual source ID.*audio and video.*distinct.*wrong-kind.*does not retain.*protectedLinkedVideoSourceIds.*compatibility facade/iu,
	);
	assert.match(
		documentation,
		/current exact-schema-12 project.*every retained exact-schema-12 revision.*timeline clips, Project Bin clips, and every feature-requirement fallback.*first-party or third-party provenance.*64 retained revisions.*100,000.*128/iu,
	);
	assert.match(
		documentation,
		/Desktop.*exact canonical remote acknowledgement.*successful activation.*latest-project-mutation lock.*provisional root.*prune failure.*project save or activation remains successful.*later opted-in save or writable activation.*retry/iu,
	);
	assert.match(
		documentation,
		/closed scalar.*project.*kind.*source.*binding token.*same compensated memory.*IndexedDB.*exact unlink.*pair.*same-database bind-before-canonical-import.*independent cleanup/iu,
	);
	assert.match(
		documentation,
		/durable current or retained graph.*exact owner token.*consume.*caller wildcard.*does not consume.*stale owner.*replacement root.*suppressed (?:or|and) failed.*consume no root/iu,
	);
	assert.match(
		documentation,
		/startup.*no owner token.*catalog-live rooted.*(?:retained|remains).*unreachable.*unverifiable.*durable.*consumes.*catalog(?:-absent| absence).*pair/iu,
	);
	assert.match(documentation, /roots have no time expiry.*bounded metadata leak.*version-8 upgrade.*does not backfill.*pre-root binding rows/iu);
	assert.match(
		documentation,
		/before exact release.*re-inventories.*same-store bindings.*surviving.*alias suppresses.*previously failed pending exact release.*rejects again.*not starve unrelated activation pruning/iu,
	);
	assert.match(
		documentation,
		/memory and IndexedDB.*no-owned-PCM linked WAV.*last durable revision.*live audio root.*canonically readable.*last root disappears.*exact locator.*once.*external WAV.*untouched/iu,
	);
	assert.match(
		documentation,
		/same IndexedDB database.*independent browser connections.*different databases or profiles.*project catalog.*main locator registry.*crash windows.*do not qualify.*hostile-row.*not one cross-boundary transaction/iu,
	);
});
