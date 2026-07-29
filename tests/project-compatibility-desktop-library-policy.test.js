/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

test('shared desktop project policy pins the current editor handoff boundary', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-desktop-project-catalog-commit');

	assert.ok(rule);
	assert.deepEqual(rule.evidence, [
		'desktop/project-library-contract.ts',
		'desktop/project-library-projects.ts',
		'desktop/project-library-host.ts',
		'desktop/project-library-editor-service.ts',
		'desktop/project-library-ipc.js',
		'desktop/preload.mjs',
		'desktop/main.mjs',
		'src/common/editor/storage/desktop-shared-project-repository.ts',
		'src/common/editor/storage.js',
		'src/common/editor/app.js',
		'tests/desktop-project-library-projects.test.ts',
		'tests/desktop-project-library-handoff.test.ts',
		'tests/desktop-project-library-editor-service.test.ts',
		'tests/desktop-project-library-ipc.test.js',
		'tests/audio-editor-desktop-shared-project-repository.test.ts',
		'tests/desktop-project-library-editor-handoff.test.ts',
		'tests/desktop-project-library-packaging.test.js',
	]);
	assert.match(
		rule.requiredOutcome,
		/desktop editor.*fully validates.*exact-current-schema.*bounded pathless main-process service.*latest metadata.*catalog pointer.*fenced lease.*without exposing filesystem paths.*catalog entry IDs.*lease capabilities.*renderer/iu,
	);
	assert.match(
		rule.currentBehavior,
		/metadata schema 2.*separate opaque library entry ID.*project identity.*exact schema 9.*project revision.*byte length.*SHA-256.*immutable revision-and-digest path/iu,
	);
	assert.match(
		rule.currentBehavior,
		/main-only.*canonicalizes.*bounded tagged-binary Scape codec.*non-raiseable 256 MiB.*root schema, identity, title, and revision.*writes and syncs.*stage file.*atomically renames.*verifies.*catalog descriptor.*exact \+1 catalog revision.*fenced metadata journal/iu,
	);
	assert.match(
		rule.currentBehavior,
		/host serializes commits.*renews.*draining admitted work.*identity service.*owner-scoped IPC.*bounded project summaries.*canonical documents.*renderer-owner revocation.*fences new work.*drains admitted operations/iu,
	);
	assert.match(
		rule.currentBehavior,
		/renderer repository.*fully validates exact schema 9.*before local mutation.*product-local shadow.*shared latest document.*authoritative.*fails closed.*incomplete desktop bridge/iu,
	);
	assert.match(
		rule.currentBehavior,
		/composed source-free editor fixture.*creates and autosaves in Soundscaper.*same identity and revision.*fresh Framescaper-local store.*next revision in Framescaper.*media catalog remains empty/iu,
	);
	assert.match(
		rule.currentBehavior,
		/full schema 9 controller activation validation.*editor-owned.*managed-media publication.*cross-product source-byte availability.*orphan reclamation.*packaged preload\/IPC\/executable handoff.*per-platform parent-directory or power-loss durability.*outside.*earlier Soundscaper shared-library migration.*deferred and unsupported/iu,
	);

	const documentation = await readFile(documentationUrl, 'utf8');
	assert.match(documentation, /Shared desktop current-schema persistence/u);
	assert.match(
		documentation,
		/metadata schema 2.*separate opaque library entry\s+ID.*exact schema 9.*project revision.*byte length.*SHA-256.*immutable revision-and-digest path/isu,
	);
	assert.match(
		documentation,
		/main process.*bounded tagged-binary Scape codec.*256 MiB.*root schema, identity, title, and\s+revision.*writes and syncs.*stage file.*atomic\s+rename.*verifies.*exact \+1\s+catalog revision.*fenced journal/isu,
	);
	assert.match(
		documentation,
		/identity service.*owner-scoped IPC.*bounded project\s+summaries.*canonical documents.*renderer loss.*fence new work.*drain operations/isu,
	);
	assert.match(
		documentation,
		/renderer repository.*fully validates.*exact\s+schema 9.*before local mutation.*shared catalog is authoritative.*product-local IndexedDB.*remote commit failure.*retryable local shadow.*incomplete shared-project bridge.*fails closed/isu,
	);
	assert.match(
		documentation,
		/composed source-free editor fixture.*creates and autosaves in Soundscaper.*same identity and\s+revision.*fresh Framescaper-local store.*next revision in\s+Framescaper.*empty shared media catalog.*not one\s+packaged preload\/IPC\/multi-process/isu,
	);
	assert.match(
		documentation,
		/full schema 9 controller activation validation.*editor-owned.*managed-media publication.*cross-product source-byte availability.*orphan reclamation.*packaged cross-product lifecycle.*per-platform parent-directory and\s+power-loss durability.*outside.*earlier Soundscaper shared-library\s+migration.*deferred and unsupported.*Audacity.*separate boundary/isu,
	);
});
