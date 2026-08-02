/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);
const CONTROL_ID = 'maintained-save-linked-video-binding-reachability';

test('the security matrix qualifies maintained save-triggered linked-video cleanup narrowly', async () => {
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
		'src/common/editor/storage/desktop-shared-project-repository.ts',
		'src/common/editor/storage/linked-video-original-lifecycle-coordinator.ts',
		'src/common/editor/storage/linked-video-original-project-reachability-repository.ts',
		'src/common/editor/storage/linked-video-original-project-save.ts',
		'src/common/editor/storage/project-publication-options.ts',
		'src/common/editor/storage/project-repository.ts',
		'src/common/editor/storage.js',
		'tests/audio-editor-desktop-shared-project-mutation-serialization.test.ts',
		'tests/audio-editor-linked-video-project-reachability-repository.test.ts',
		'tests/audio-editor-linked-video-project-save-lifecycle.test.ts',
		'tests/audio-editor-linked-video-project-save-reconciliation.test.ts',
		'tests/audio-editor-project-admin-service-coverage.test.ts',
		'tests/audio-editor-project-save-options.test.ts',
		'tests/audio-editor-project-services.test.ts',
		'tests/audio-editor-session.test.js',
		'tests/production-security-linked-video-save-cleanup.test.js',
	]) assert.ok(control.evidence.some((item) => item.path === path), path);

	assert.match(control.summary, /queued autosave, explicit flush, project-switch, and inactive-tab saves.*live Undo\/Redo histories and clipboard.*frozen deduplicated.*write reaches the save queue/isu);
	assert.match(control.summary, /direct saves without authoritative roots.*skip destructive source-level cleanup/isu);
	assert.match(control.summary, /exact-schema-9 current project and at most 64 retained revisions.*timeline clips, Project Bin clips, and all feature-fallback declarations.*future, invalid, missing-current-revision, duplicate, or over-bound.*suppress(?:es)? cleanup/isu);
	assert.match(control.summary, /100,000 aggregate roots.*100,000 closed binding rows.*128 unique exact locator\/revision pairs/isu);
	assert.match(control.summary, /after project publication and revision pruning.*Desktop.*exact remote acknowledgement.*per-project latest-mutation lock.*one atomic local binding transaction/isu);
	assert.match(control.summary, /bind-before-project.*transient protection.*(?:cleanup|prune) failure.*committed report-only error.*binding batch is preserved.*save remains successful/isu);
	assert.match(control.summary, /re-inventories aliases.*exact locator revision.*neither binding pruning nor locator retirement loads, stats, hashes, writes, or deletes an external video body/isu);
	assert.match(control.summary, /cooperative one-live-store-and-renderer.*separate stores, profiles, renderers, or processes.*abrupt crash or power loss.*hostile IndexedDB authority.*hostile renderer authority.*unqualified/isu);
	assert.match(control.summary, /project publication, local binding transaction, and main locator retirement remain separate/isu);
});

test('the threat model records the same maintained save boundary and residuals', async () => {
	const documentation = await readFile(threatModelUrl, 'utf8');
	assert.match(documentation, /maintained save-triggered linked-video binding reachability/iu);
	assert.match(documentation, /controller.*live Undo\/Redo.*clipboard.*direct unqualified saves.*skip/isu);
	assert.match(documentation, /exact schema 9.*current.*retained revisions.*all feature-fallback declarations.*64 revisions.*100,000 aggregate roots.*100,000 (?:closed )?binding rows.*128.*locator/isu);
	assert.match(documentation, /Desktop.*remote acknowledgement.*latest-mutation lock.*atomic local binding.*transient bind-before-project/isu);
	assert.match(documentation, /committed report-only.*save succeeds.*alias.*exact locator.*external video body/isu);
	assert.match(documentation, /one live store and renderer.*separate stores, profiles, renderers, or processes.*abrupt crash or power loss.*hostile IndexedDB.*hostile renderer.*unqualified/isu);
	assert.match(documentation, /project publication, (?:the )?local binding transaction, and main locator retirement.*separate/isu);
});
