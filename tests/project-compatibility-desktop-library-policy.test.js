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
		'desktop/project-library-reclamation.ts',
		'desktop/project-library-host.ts',
		'desktop/project-library-editor-service.ts',
		'desktop/project-library-ipc.js',
		'desktop/preload.mjs',
		'desktop/main.mjs',
		'src/common/editor/persisted-audio-effect-validation.ts',
		'src/common/editor/project-v9-document-validation.ts',
		'src/common/editor/project-v9-media-validation.ts',
		'src/common/editor/project-v9-validation-primitives.ts',
		'src/common/editor/project-v9-validation.ts',
		'src/common/editor/project-v9.ts',
		'src/common/editor/storage/desktop-shared-project-repository.ts',
		'src/common/editor/storage.js',
		'src/common/editor/app.js',
		'tests/audio-editor-project-v9-validation.test.ts',
		'tests/persisted-audio-effect-validation.test.ts',
		'tests/desktop-project-library-projects.test.ts',
		'tests/desktop-project-library-reclamation.test.ts',
		'tests/desktop-project-library-handoff.test.ts',
		'tests/desktop-project-library-editor-service.test.ts',
		'tests/desktop-project-library-ipc.test.js',
		'tests/audio-editor-desktop-shared-project-repository.test.ts',
		'tests/desktop-project-library-editor-handoff.test.ts',
		'tests/desktop-project-library-packaging.test.js',
	]);
	assert.match(
		rule.requiredOutcome,
		/bounded pathless main-owned service.*validates.*maintained exact-current-schema project domain.*before host staging.*catalog publication.*before returning.*shared read document.*renderer repeats validation.*defense in depth.*without receiving filesystem paths.*catalog entry IDs.*lease capabilities/iu,
	);
	assert.match(
		rule.requiredOutcome,
		/main-owned startup reclamation.*preserves every current or recoverable catalog reference.*before removing an immutable project file/iu,
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
		/main-owned identity service.*shared strict exact-V9 maintained-persistence-domain validator.*before permitting host staging.*catalog publication.*renderer commit.*validates.*loaded commit result.*stored project again.*before returning.*canonical document.*strictly checks core project, document, media, and graph structures.*without loading legacy migrations.*executable effect and worker runtimes.*all audio effects.*cloneable.*generic effect identity, enabled, and parameter structure.*type-specific semantic checks.*missing-effect compatibility metadata.*parametric EQ.*other first- and third-party effect payload semantics.*not gated/iu,
	);
	assert.match(
		rule.currentBehavior,
		/host serializes commits.*renews.*draining admitted work.*identity service.*owner-scoped IPC.*bounded project summaries.*canonical documents.*renderer-owner revocation.*fences new work.*drains admitted operations/iu,
	);
	assert.match(
		rule.currentBehavior,
		/after journal recovery.*before host exposure.*100,000 direct project-tree entries.*reports completeness.*immediate SQLite writer fence.*portable case-folded reachability.*current catalog.*both sides.*pending recovery journal.*quarantining canonical unreachable regular immutable files.*unlinking only those files or collector-owned quarantine files.*yields between bounded batches.*crash-left quarantine.*symlinked project root.*corrupt metadata.*stage.*malformed.*foreign.*managed-media.*untouched/iu,
	);
	assert.match(
		rule.currentBehavior,
		/renderer repository.*repeats.*maintained-persistence-domain exact-V9 validation.*defense in depth.*before local mutation.*product-local shadow.*shared latest document.*authoritative.*fails closed.*incomplete desktop bridge/iu,
	);
	assert.match(
		rule.currentBehavior,
		/composed source-free editor fixture.*creates and autosaves in Soundscaper.*same identity and revision.*fresh Framescaper-local store.*next revision in Framescaper.*media catalog remains empty/iu,
	);
	assert.match(
		rule.currentBehavior,
		/activation-specific feature-capability evaluation.*rendered-fallback byte verification.*editor-owned.*managed-media publication.*cross-product source-byte availability.*guaranteed continuation.*incomplete 100,000-entry inventory.*abandoned stage-file cleanup.*packaged preload\/IPC\/executable handoff.*per-platform parent- and database-path identity or power-loss durability.*outside.*migration from pre-shared, product-private Soundscaper libraries.*not a current priority.*deferred and unsupported.*Audacity.*separate boundary/iu,
	);

	const documentation = await readFile(documentationUrl, 'utf8');
	assert.match(documentation, /Shared desktop current-schema persistence/u);
	assert.match(
		documentation,
		/metadata schema 2.*separate opaque library entry\s+ID.*exact schema 9.*project revision.*byte length.*SHA-256.*immutable revision-and-digest path/isu,
	);
	assert.match(
		documentation,
		/main process.*bounded tagged-binary Scape codec.*256 MiB.*low-level store.*root schema, identity,\s+title, and revision.*main-owned identity service.*strict\s+exact-V9 maintained-persistence-domain validator.*before\s+permitting host staging.*catalog publication.*renderer commit.*validates the loaded commit result.*stored project again.*before\s+returning.*canonical document.*strictly checks core project,\s+document, media, and graph structures.*all audio effects.*cloneable.*generic effect identity, enabled, and parameter structure.*type-specific semantic checks.*missing-effect compatibility\s+metadata.*parametric EQ.*other first- and third-party effect payload semantics.*not gated.*writes and syncs.*stage file.*atomic\s+rename.*verifies.*exact \+1\s+catalog revision.*fenced\s+journal/isu,
	);
	assert.match(
		documentation,
		/after journal recovery.*before the host is exposed.*100,000 direct project-tree entries.*bounded pass was complete/isu,
	);
	assert.match(
		documentation,
		/immediate SQLite writer transaction.*exact live lease.*portable case-folded reachability.*current\s+catalog.*previous and next snapshots.*pending prepared or\s+committed journal/isu,
	);
	assert.match(
		documentation,
		/canonical unreachable regular immutable project files.*random noncatalogable.*quarantine.*higher fencing\s+token.*yields between batches/isu,
	);
	assert.match(
		documentation,
		/static\s+symlinked project root.*corrupt catalog or\s+journal metadata.*stage files.*malformed or foreign names.*managed media\s+remain untouched.*host\s+snapshot.*tested\s+reclamation failure during startup.*releases its still-owned\s+lease.*cleanup failure.*reported/isu,
	);
	assert.match(
		documentation,
		/identity service.*owner-scoped IPC.*bounded project\s+summaries.*canonical documents.*renderer loss.*fence new work.*drain operations/isu,
	);
	assert.match(
		documentation,
		/renderer repository.*repeats.*maintained-persistence-domain exact-V9\s+validation.*defense in depth.*before\s+local mutation.*shared catalog is authoritative.*product-local IndexedDB.*remote commit failure.*retryable local shadow.*incomplete shared-project bridge.*fails closed/isu,
	);
	assert.match(
		documentation,
		/composed source-free editor fixture.*creates and autosaves in Soundscaper.*same identity and\s+revision.*fresh Framescaper-local store.*next revision in\s+Framescaper.*empty shared media catalog.*not one\s+packaged preload\/IPC\/multi-process/isu,
	);
	assert.match(
		documentation,
		/activation-specific feature-capability evaluation.*rendered-fallback byte verification.*editor-owned.*managed-media\s+publication.*cross-product\s+source-byte availability.*guaranteed continuation.*incomplete\s+100,000-entry inventory.*abandoned stage-file cleanup.*packaged cross-product\s+lifecycle.*per-platform parent- and database-path identity and power-loss\s+durability.*outside.*migration from pre-shared, product-private Soundscaper libraries.*not a current priority.*deferred and unsupported.*Audacity.*separate boundary/isu,
	);
});
