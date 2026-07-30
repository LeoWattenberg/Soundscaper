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
		'desktop/project-library-database.ts',
		'desktop/project-library-file-inventory.ts',
		'desktop/project-library.ts',
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
		'tests/desktop-project-library-file-inventory.test.ts',
		'tests/desktop-project-library-projects.test.ts',
		'tests/desktop-project-library-reclamation.test.ts',
		'tests/desktop-project-library-reclamation-progress.test.ts',
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
		/fresh filesystem library scope v2.*ignores rather than migrates.*prior shared v1 scope.*schema 1 database.*v2 path.*rejected instead of implicitly migrated.*metadata schema 2.*separate opaque library entry ID.*project identity.*exact schema 9.*project revision.*byte length.*SHA-256.*immutable revision-and-digest path/iu,
	);
	assert.match(
		rule.currentBehavior,
		/main-only.*canonicalizes.*bounded tagged-binary Scape codec.*non-raiseable 256 MiB.*root schema, identity, title, and revision.*reserves.*lease.*fencing-token.*authoritative project-file inventory.*before creating.*stage file.*writes and syncs.*atomically renames.*materialized.*verifies.*catalog descriptor.*every catalog reference.*exact \+1 catalog revision.*fenced metadata journal/iu,
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
		/after journal recovery.*before host exposure.*authoritative project-file inventory.*monotonic row IDs.*captur(?:es|ed).*high-water.*persist(?:s|ed).*cursor.*100,000 rows.*64-row batches.*immediate SQLite writer fence.*portable case-folded reachability.*current catalog.*both sides.*pending recovery journal.*deterministic.*quarantine.*unregistered.*stage.*canonical.*forged quarantine.*foreign.*do not consume.*budget.*untouched.*100,001-row.*successive bounded passes.*later inserts.*next high-water cycle.*crash-left quarantine.*symlinked project root.*corrupt metadata.*managed-media.*untouched/iu,
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
		/activation-specific feature-capability evaluation.*rendered-fallback byte verification.*editor-owned.*managed-media publication.*cross-product source-byte availability.*abandoned stage-file cleanup.*packaged preload\/IPC\/executable handoff.*per-platform parent- and database-path identity or power-loss durability.*outside.*migration from the prior shared v1 scope or product-private Soundscaper libraries.*not a current priority.*deferred and unsupported.*Audacity.*separate boundary/iu,
	);

	const documentation = await readFile(documentationUrl, 'utf8');
	assert.match(documentation, /Shared desktop current-schema persistence/u);
	assert.match(
		documentation,
		/fresh filesystem library scope `v2`/iu,
	);
	assert.match(
		documentation,
		/fresh filesystem library scope `v2`.*ignores rather than migrates.*prior\s+shared `v1` scope.*at the `v2` path.*SQLite database schema 2 rejects schema 1.*implicitly migrating/isu,
	);
	assert.match(
		documentation,
		/metadata\s+schema\s+2.*separate\s+opaque\s+library\s+entry\s+ID.*exact\s+schema\s+9.*project\s+revision.*byte\s+length.*SHA-256.*immutable\s+revision-and-digest\s+path/isu,
	);
	assert.match(
		documentation,
		/main process.*bounded tagged-binary Scape codec.*256 MiB.*low-level store.*root schema, identity,\s+title, and revision.*main-owned identity service.*strict\s+exact-V9 maintained-persistence-domain validator.*before\s+permitting host staging.*catalog publication.*renderer commit.*validates the loaded commit result.*stored project again.*before\s+returning.*canonical document.*strictly checks core project,\s+document, media, and graph structures.*all audio effects.*cloneable.*generic effect identity, enabled, and parameter structure.*type-specific semantic checks.*missing-effect compatibility\s+metadata.*parametric EQ.*other first- and third-party effect payload semantics.*not gated.*reserves.*authoritative project-file inventory.*before.*stage.*writes and syncs.*atomic\s+rename.*materialized.*every catalog reference.*exact \+1\s+catalog revision.*fenced\s+journal/isu,
	);
	assert.match(
		documentation,
		/after journal recovery.*before the host is exposed.*authoritative project-file inventory.*monotonic row\s+IDs.*captur(?:es|ed).*high-water.*persist(?:s|ed).*cursor.*100,000\s+rows.*complete/isu,
	);
	assert.match(
		documentation,
		/immediate SQLite writer transaction.*exact live lease.*portable case-folded reachability.*current\s+catalog.*previous and next snapshots.*pending prepared or\s+committed journal/isu,
	);
	assert.match(
		documentation,
		/deterministic noncatalogable quarantine.*unregistered.*canonical.*forged quarantine.*do not consume.*budget.*100,001-row.*successive bounded passes.*later inserts.*next high-water cycle.*higher fencing\s+token.*yields between batches/isu,
	);
	assert.match(
		documentation,
		/static\s+symlinked\s+project\s+root.*corrupt\s+catalog\s+or\s+journal\s+metadata.*stage\s+files.*malformed\s+names.*managed\s+media\s+remain\s+untouched.*host\s+snapshot.*tested\s+reclamation\s+failure\s+during\s+startup.*releases\s+its\s+still-owned\s+lease.*cleanup\s+failure.*reported/isu,
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
		/activation-specific feature-capability evaluation.*rendered-fallback byte verification.*editor-owned.*managed-media\s+publication.*cross-product\s+source-byte availability.*abandoned stage-file cleanup.*packaged cross-product\s+lifecycle.*per-platform parent- and database-path identity and power-loss\s+durability.*outside/isu,
	);
	assert.match(
		documentation,
		/migration from the prior shared\s+`?v1`?\s+scope or product-private Soundscaper\s+libraries.*not a current priority.*deferred and\s+unsupported.*Audacity.*separate boundary/isu,
	);
	assert.doesNotMatch(documentation, /guaranteed continuation after an incomplete|incomplete 100,000-entry inventory/iu);
});
