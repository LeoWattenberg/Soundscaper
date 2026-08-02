/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);
const CONTROL_ID = 'maintained-save-kindful-linked-original-binding-reachability';

test('the security matrix qualifies maintained save- and activation-triggered linked-original cleanup narrowly', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'shared-desktop-project-library-integrity');
	const control = risk?.currentControls.find(({ id }) => id === CONTROL_ID);
	assert.ok(control);

	for (const path of [
		'src/common/editor/app.js',
		'src/common/editor/session.js',
		'src/common/editor/controller/project-admin-service.ts',
		'src/common/editor/controller/project-retention-service.ts',
		'src/common/editor/controller/project-save-service.ts',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/storage/desktop-shared-project-repository.ts',
		'src/common/editor/storage/linked-original-lifecycle-coordinator.ts',
		'src/common/editor/storage/linked-original-project-open-maintenance.ts',
		'src/common/editor/storage/linked-original-project-reachability-repository.ts',
		'src/common/editor/storage/linked-original-project-save.ts',
		'src/common/editor/storage/linked-original-store-service.ts',
		'src/common/editor/storage/linked-video-original-lifecycle-coordinator.ts',
		'src/common/editor/storage/linked-video-original-project-reachability-repository.ts',
		'src/common/editor/storage/linked-video-original-project-save.ts',
		'src/common/editor/storage/project-publication-options.ts',
		'src/common/editor/storage/project-repository.ts',
		'src/common/editor/storage.js',
		'tests/audio-editor-desktop-shared-project-mutation-serialization.test.ts',
		'tests/audio-editor-linked-audio-project-save-reconciliation.test.ts',
		'tests/audio-editor-linked-original-lifecycle.test.ts',
		'tests/audio-editor-linked-original-project-save.test.ts',
		'tests/audio-editor-linked-original-project-open-maintenance.test.ts',
		'tests/audio-editor-project-switch-playback-apply.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/audio-editor-linked-video-project-reachability-repository.test.ts',
		'tests/audio-editor-linked-video-project-save-lifecycle.test.ts',
		'tests/audio-editor-linked-video-project-save-reconciliation.test.ts',
		'tests/audio-editor-project-admin-service-coverage.test.ts',
		'tests/audio-editor-project-retention-service.test.ts',
		'tests/audio-editor-project-save-options.test.ts',
		'tests/audio-editor-project-services.test.ts',
		'tests/audio-editor-session.test.js',
		'tests/production-security-linked-video-save-cleanup.test.js',
	]) assert.ok(control.evidence.some((item) => item.path === path), path);

	assert.match(control.summary, /queued autosaves, flushes, inactive-tab saves, and project-switch or analysis explicit saves.*terminal successful writable project activation.*kindful.*audio.*video.*live Undo\/Redo histories.*clipboard.*recording.*render-cache.*queued write or serialized maintenance executes/isu);
	assert.match(control.summary, /durable IndexedDB.*skips read-only, failed, save-triggered, memory, and degraded activation.*lifecycle.*latest-project-mutation.*revalidates.*active project.*write-lock identity.*collects.*roots inside.*serialized ownership/isu);
	assert.match(control.summary, /direct saves without authoritative roots.*skip destructive source-level cleanup/isu);
	assert.match(control.summary, /same textual source ID.*kind-distinct.*wrong-kind.*does not retain.*protectedLinkedVideoSourceIds.*compatibility facade/isu);
	assert.match(control.summary, /exact-schema-9 current project and at most 64 retained revisions.*timeline clips, Project Bin clips, and all feature-fallback declarations.*future, invalid, missing-current-revision, duplicate, or over-bound.*suppress(?:es)? cleanup/isu);
	assert.match(control.summary, /100,000 aggregate roots.*100,000 closed binding rows.*128 unique exact locator\/revision pairs/isu);
	assert.match(control.summary, /after project publication and revision pruning or terminal activation.*Desktop.*exact remote acknowledgement.*serialized activation.*per-project latest-mutation lock.*one atomic local binding transaction/isu);
	assert.match(control.summary, /bind-before-project.*transient protection.*suppressed or failed maintenance.*one-successful-maintenance-pass transient protection.*(?:cleanup|prune) failure.*committed report-only error.*binding batch is preserved.*save or activation remains successful.*previously failed pending release.*rejects again.*not starve unrelated activation cleanup/isu);
	assert.match(control.summary, /re-inventories aliases.*exact locator revision/isu);
	assert.match(control.summary, /memory and IndexedDB.*no-owned-PCM linked WAV.*last durable revision.*live audio root.*canonically readable.*exact locator.*once.*last root disappears.*external WAV.*untouched/isu);
	assert.match(control.summary, /cooperative one-live-store-and-renderer.*separate stores, profiles, renderers, or processes.*abrupt crash or power loss.*hostile IndexedDB authority.*hostile renderer authority.*unqualified/isu);
	assert.match(control.summary, /project publication, local binding transaction, and main locator retirement remain separate/isu);
	assert.match(control.summary, /relink or watch.*audio range playback.*packaged executable or operating-system.*third-party activation gating.*legacy private librar/isu);
});

test('the threat model records the same maintained save boundary and residuals', async () => {
	const documentation = (await readFile(threatModelUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.match(documentation, /maintained save- and successful-writable-activation-triggered kindful linked-original binding reachability/iu);
	assert.match(documentation, /controller.*queued autosaves, flushes, inactive-tab saves, and project-switch or analysis explicit saves.*successful writable activation.*live Undo\/Redo.*clipboard.*recording.*render-cache.*direct unqualified save.*skip/isu);
	assert.match(documentation, /durable IndexedDB.*read-only, failed, save-triggered, memory, or degraded activation.*lifecycle.*latest-project-mutation.*active project.*write-lock identity.*roots.*serialized/isu);
	assert.match(documentation, /same textual source ID.*kind-distinct.*wrong-kind.*does not retain.*protectedLinkedVideoSourceIds.*compatibility facade/isu);
	assert.match(documentation, /current exact schema 9 project.*64 retained revisions.*timeline.*Project Bin.*all feature-fallback declarations/isu);
	assert.match(documentation, /100,000 aggregate roots.*100,000 (?:closed )?binding rows.*128.*locator/isu);
	assert.match(documentation, /Desktop.*remote acknowledgement.*successful activation.*latest-mutation lock.*atomic local binding.*transient bind-before-project/isu);
	assert.match(documentation, /suppressed or failed maintenance.*one-successful-maintenance-pass transient protection.*report-only.*save or activation succeeds.*previously failed pending release.*rejects again.*unrelated activation cleanup.*alias.*exact locator/isu);
	assert.match(documentation, /memory and IndexedDB.*no-owned-PCM linked WAV.*last durable revision.*canonical.*readable.*live audio root.*last root disappears.*exact locator.*once.*external WAV.*untouched/isu);
	assert.match(documentation, /one live store and renderer.*separate stores, profiles, renderers, or processes.*abrupt crash or power loss.*hostile IndexedDB.*hostile renderer.*unqualified/isu);
	assert.match(documentation, /project publication, (?:the )?local binding transaction, and main locator retirement.*separate/isu);
	assert.match(documentation, /Source-level cleanup outside maintained saves and successful writable activations.*general continuous cleanup beyond same-store save\/activation\/delete\/clear/isu);
	assert.doesNotMatch(documentation, /Source-level and general continuous cleanup beyond same-store project deletion and clear/iu);
});
