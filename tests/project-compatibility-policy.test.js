/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-v9.ts';
import { SCAPE_FORMAT_VERSION } from '../src/common/editor/scape-project.js';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

test('project compatibility policy matches the maintained schema and archive format', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));

	assert.equal(policy.schemaVersion, 1);
	assert.equal(policy.projectSchema.currentVersion, AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION);
	assert.equal(policy.projectSchema.minimumReadableVersion, 1);
	assert.deepEqual(
		policy.projectSchema.retainedMigrationSources,
		Array.from({ length: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION - 1 }, (_, index) => index + 1),
	);
	assert.equal(policy.portableArchive.currentFormatVersion, SCAPE_FORMAT_VERSION);
	assert.equal(policy.portableArchive.futureFormatBehavior, 'reject-before-persistence');
	assert.equal(
		policy.portableArchive.roundTripGuarantee,
		'current-schema-semantic-plus-bounded-tagged-binary-not-byte-identical',
	);
});

test('compatibility rules distinguish enforced guarantees from planned lossless fallbacks', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rules = new Map(policy.rules.map((rule) => [rule.id, rule]));
	assert.equal(rules.size, policy.rules.length);

	const expectedStatuses = {
		'legacy-schema-migration': 'implemented',
		'current-schema-editing': 'implemented',
		'project-feature-requirements-core': 'implemented',
		'current-scape-feature-requirements': 'implemented',
		'current-scape-rendered-fallback-integrity': 'implemented',
		'current-controller-feature-report': 'implemented',
		'current-controller-rendered-fallback-integrity': 'implemented',
		'current-scape-pre-open-feature-report': 'implemented',
		'current-scape-open-feature-decision': 'implemented',
		'future-core-read-only': 'implemented',
		'future-scape-round-trip': 'planned',
		'json-opaque-extensions': 'implemented',
		'binary-opaque-native-state': 'implemented',
		'unavailable-native-feature': 'planned',
		'video-proxy-fallback': 'planned',
		'audio-freeze-fallback': 'planned',
		'future-archive-format-rejection': 'implemented',
	};
	assert.deepEqual(
		Object.fromEntries([...rules].map(([id, rule]) => [id, rule.status])),
		expectedStatuses,
	);

	for (const rule of rules.values()) {
		assert.ok(rule.requiredOutcome.length > 0, rule.id);
		assert.ok(rule.currentBehavior.length > 0, rule.id);
		assert.ok(rule.evidence.length > 0, rule.id);
		if (rule.status !== 'implemented') assert.match(rule.milestone, /^(?:2|3|4)$/u, rule.id);
		for (const reference of rule.evidence) {
			const [repositoryPath] = reference.split('#');
			await assert.doesNotReject(
				access(new URL(`../${repositoryPath}`, import.meta.url)),
				`Missing compatibility evidence: ${reference}`,
			);
		}
	}

	const featureRequirements = rules.get('project-feature-requirements-core');
	for (const reference of [
		'src/common/editor/project-feature-requirements.ts',
		'src/common/editor/project-v9.ts',
		'src/common/editor/migration.js',
		'tests/audio-editor-project-feature-requirements.test.ts',
		'tests/audio-editor-project-v9.test.ts',
	]) assert.ok(featureRequirements.evidence.includes(reference), reference);
	assert.match(featureRequirements.currentBehavior, /bounded.*rendered-fallback.*digest syntax/iu);
	assert.match(featureRequirements.currentBehavior, /without mutating/iu);

	const currentScapeFeatureRequirements = rules.get('current-scape-feature-requirements');
	assert.deepEqual(currentScapeFeatureRequirements.evidence, [
		'src/common/editor/retention.js',
		'src/common/editor/project-feature-requirements.ts',
		'src/common/editor/scape-export-plan.ts',
		'src/common/editor/scape-project.js',
		'src/common/editor/scape-project-assets.ts',
		'tests/audio-editor-feature-requirement-retention.test.ts',
		'tests/audio-editor-scape-feature-requirements.test.ts',
	]);
	assert.match(
		currentScapeFeatureRequirements.currentBehavior,
		/rendered-fallback.*compaction.*every project source asset.*copy import.*collision map/iu,
	);
	assert.match(
		currentScapeFeatureRequirements.currentBehavior,
		/digest integrity.*route-specific.*arbitrary future schemas/iu,
	);

	const fallbackIntegrity = rules.get('current-scape-rendered-fallback-integrity');
	assert.deepEqual(fallbackIntegrity.evidence, [
		'src/common/editor/scape-project-assets.ts',
		'src/common/editor/scape-export-plan.ts',
		'src/common/editor/scape-archive-media.ts',
		'src/common/editor/scape-archive-video.ts',
		'src/common/editor/scape-project.js',
		'tests/audio-editor-scape-project-assets.test.ts',
		'tests/audio-editor-scape-feature-requirements.test.ts',
		'tests/audio-editor-scape-export-fallback-integrity.test.ts',
		'tests/audio-editor-scape-project.test.js',
		'tests/audio-editor-scape-streaming-video.test.ts',
	]);
	assert.match(
		fallbackIntegrity.requiredOutcome,
		/current-format.*exact-current-schema.*rendered fallback.*canonical archive asset.*before publication/iu,
	);
	assert.match(
		fallbackIntegrity.currentBehavior,
		/export.*snapshot.*admitted project.*source records.*same source snapshots.*normalized fallback manifest.*accessors.*toJSON hooks.*without invocation.*hash.*reject.*manifest.*commit.*import.*before.*collision.*storage.*body.*SHA-256.*publication/iu,
	);
	assert.match(
		fallbackIntegrity.currentBehavior,
		/inspection.*descriptor binding.*does not read or hash.*asset bodies.*future schemas.*not traversed/iu,
	);
	assert.match(
		fallbackIntegrity.currentBehavior,
		/copy.*source ID.*digest.*raw-project.*stored-project.*runtime fallback use.*outside/iu,
	);

	const currentControllerFeatureReport = rules.get('current-controller-feature-report');
	assert.deepEqual(currentControllerFeatureReport.evidence, [
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-feature-report-metadata.ts',
		'src/common/editor/session.js',
		'src/common/editor/controller/project-feature-compatibility-service.ts',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/controller/document-snapshot.ts',
		'tests/audio-editor-project-feature-capabilities.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/audio-editor-session.test.js',
		'tests/audio-editor-document-snapshot.test.ts',
	]);
	assert.match(
		currentControllerFeatureReport.currentBehavior,
		/stable broad.*map one-to-one.*strict true.*unavailable.*unregistered.*unknown/iu,
	);
	assert.match(
		currentControllerFeatureReport.currentBehavior,
		/exact schema 9.*actual project history.*before activation side effects.*unavailable or unknown.*intrinsically read-only.*deeply frozen.*session metadata clones.*document snapshot/iu,
	);
	assert.match(currentControllerFeatureReport.currentBehavior, /same-ID tab.*stored read-only declaration.*ignored incoming.*flags/iu);
	assert.match(
		currentControllerFeatureReport.currentBehavior,
		/future schemas.*no report.*featureRequirements is not traversed/iu,
	);

	const controllerFallbackIntegrity = rules.get('current-controller-rendered-fallback-integrity');
	assert.deepEqual(controllerFallbackIntegrity.evidence, [
		'src/common/editor/project-fallback-integrity.ts',
		'src/common/editor/scape-archive-media.ts',
		'src/common/editor/storage/media-content-digest.ts',
		'src/common/editor/storage.js',
		'src/common/editor/storage/source-read-repository.ts',
		'src/common/editor/storage/source-repository.ts',
		'src/common/editor/storage/media-asset-digest-backfill.ts',
		'src/common/editor/storage/media-repository.ts',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/session-activation.js',
		'src/common/editor/session.js',
		'src/common/editor/app.js',
		'tests/audio-editor-project-fallback-integrity.test.ts',
		'tests/audio-editor-source-read-cancellation.test.ts',
		'tests/audio-editor-media-asset-load.test.ts',
		'tests/audio-editor-project-switch-fallback-integrity.test.ts',
		'tests/audio-editor-session-project-activation.test.js',
	]);
	assert.match(
		controllerFallbackIntegrity.requiredOutcome,
		/exact-current-schema.*raw or stored project.*maintained controller.*canonical local stored bytes.*before activation side effects/iu,
	);
	assert.match(
		controllerFallbackIntegrity.currentBehavior,
		/authoritative exact-schema-9.*same-ID tab history.*session-owned history token.*exclusive session activation reservation.*before project-generation invalidation.*engine shutdown.*lock changes.*source loading.*persistence.*history replacement.*close.reopen.*competing active-project publication.*session publication.*released in finally/iu,
	);
	assert.match(
		controllerFallbackIntegrity.currentBehavior,
		/audio-f32le-chunks-v1.*65,536-chunk.*video.*immutable.*Blob.*4 MiB.*64 GiB.*before fallback body reads/iu,
	);
	assert.match(controllerFallbackIntegrity.currentBehavior, /disable.*PCM migration scheduling.*digest claim.backfill.*does not publish storage maintenance/iu);
	assert.match(controllerFallbackIntegrity.currentBehavior, /sequential.*cooperatively cancellable.*read-only video-metadata.*raced against cancellation.*signal-ignoring provider.*continue after admission rejects.*provider-stalled fallback body read.*delay cancellation settlement.*iterator cleanup/iu);
	assert.match(controllerFallbackIntegrity.currentBehavior, /deduplicates.*conflicting digests.*before storage reads/iu);
	assert.match(
		controllerFallbackIntegrity.currentBehavior,
		/empty manifests.*future schemas.*no asset reads.*not traversed.*admission-time.*direct store\.loadProject.*continuously bind.*publisher authenticity.*runtime.*third-party/iu,
	);

	const currentScapePreOpenFeatureReport = rules.get('current-scape-pre-open-feature-report');
	assert.deepEqual(currentScapePreOpenFeatureReport.evidence, [
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/controller/project-feature-compatibility-service.ts',
		'src/common/editor/controller/scape-inspection-service.ts',
		'src/common/editor/controller/scape-project-file-service.ts',
		'src/common/editor/scape-project.js',
		'src/common/editor/app.js',
		'tests/audio-editor-scape-feature-requirements.test.ts',
		'tests/audio-editor-scape-inspection-service.test.ts',
		'tests/audio-editor-scape-project-file-service.test.ts',
	]);
	assert.match(
		currentScapePreOpenFeatureReport.currentBehavior,
		/selected product.*provider-owned.*caller.*override.*archive.*source.*validation.*exact schema 9.*before.*collision lookup.*deeply frozen/iu,
	);
	assert.match(
		currentScapePreOpenFeatureReport.currentBehavior,
		/future project schemas.*null.*featureRequirements.*not traversed.*foundation.*open.*decision/iu,
	);

	const currentScapeOpenFeatureDecision = rules.get('current-scape-open-feature-decision');
	assert.equal(currentScapeOpenFeatureDecision.status, 'implemented');
	for (const reference of [
		'src/common/editor/controller/scape-open-request-service.ts',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/ui/workspace/scape-open-decision-continuation.ts',
		'src/common/editor/ui/workspace/ScapeOpenDecisionDialog.jsx',
		'tests/audio-editor-scape-open-request-service.test.ts',
		'tests/audio-editor-scape-open-decision-continuation.test.ts',
		'tests/audio-editor-scape-open-decision-dialog.test.ts',
		'tests/browser/audio-editor-scape-open-compatibility.spec.js',
	]) assert.ok(currentScapeOpenFeatureDecision.evidence.includes(reference), reference);
	assert.match(
		currentScapeOpenFeatureDecision.currentBehavior,
		/no-collision.*open-read-only.*cancel.*combined.*copy-read-only.*cancel.*one.*decision/iu,
	);
	assert.match(
		currentScapeOpenFeatureDecision.currentBehavior,
		/cancel.*before.*import.*persistence.*activation.*actual project history.*intrinsically read-only/iu,
	);
	assert.match(currentScapeOpenFeatureDecision.currentBehavior, /localized.*stable feature ID.*declared disposition.*default focus.*Cancel.*Escape/iu);

	const binaryOpaqueState = rules.get('binary-opaque-native-state');
	assert.deepEqual(binaryOpaqueState.evidence, [
		'src/common/editor/aup4-effects.js',
		'src/common/editor/scape-project-document.ts',
		'src/common/editor/scape-export-plan.ts',
		'src/common/editor/scape-project.js',
		'tests/aup4-effects.test.js',
		'tests/audio-editor-scape-project-document.test.ts',
		'tests/audio-editor-scape-project.test.js',
	]);
	assert.match(binaryOpaqueState.requiredOutcome, /Uint8Array.*ArrayBuffer.*exact-current-schema.*current-format.*tagged.*bounded.*byte-exactly.*without activation/iu);
	assert.match(
		binaryOpaqueState.currentBehavior,
		/schema 9.*Uint8Array.*offset-view.*ArrayBuffer.*reserved tagged descriptor.*256 payloads.*4 MiB.*8 MiB.*100,000.*depth 128.*other ArrayBuffer views reject/iu,
	);
	assert.match(
		binaryOpaqueState.currentBehavior,
		/import and inspection.*closed descriptor.*unique positive IDs.*canonical base64.*exact byte lengths.*before allocating.*declared binary type.*without interpreting.*reserved-tag collisions.*accessor.*toJSON.*other project schemas.*not traversed/iu,
	);

	const unavailable = rules.get('unavailable-native-feature');
	assert.equal(unavailable.status, 'planned');
	assert.match(
		unavailable.currentBehavior,
		/controller report.*\.scape.*inspection report.*actionable.*pre-open.*read-only.*intrinsically read-only.*archive.*fallback.*integrity.*controller activation.*local audio and video fallback bytes.*supported Uint8Array.*ArrayBuffer.*opaque native\/effect state.*byte-exactly.*without activation.*other buffer views.*unsupported.*visible placeholder.*runtime use.*future-schema archive preservation/iu,
	);
});

test('schema retirement and forward-read rules fail closed without claiming unsupported losslessness', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const retirement = policy.schemaRetirement;

	assert.equal(retirement.currentMinimumVersion, 1);
	assert.equal(retirement.automaticRemoval, false);
	assert.ok(retirement.requiredConditions.includes('offline-upgrader'));
	assert.ok(retirement.requiredConditions.includes('oldest-fixture-to-current-gate'));
	assert.ok(retirement.requiredConditions.includes('two-stable-release-deprecation-window'));
	assert.equal(policy.forwardReadOnly.allowMutation, false);
	assert.equal(policy.forwardReadOnly.allowOverwrite, false);
	assert.equal(policy.forwardReadOnly.opaqueClone, 'structured-clone');
	assert.equal(policy.forwardReadOnly.portableArchiveStatus, 'planned');

	const documentation = await readFile(documentationUrl, 'utf8');
	assert.match(documentation, /Core document versus `\.scape`/u);
	assert.match(documentation, /do not promise\s+byte-for-byte/u);
	assert.match(documentation, /exact schema 9.*JSON-semantic.*byte-exact preservation.*supported bounded tagged binary/isu);
	assert.match(documentation, /binary opaque/iu);
	assert.match(
		documentation,
		/exact schema 9.*format 1.*Uint8Array.*offset view.*ArrayBuffer.*\$soundscaperOpaqueBinary.*256 payloads.*4 MiB.*8 MiB.*100,000.*depth 128/isu,
	);
	assert.match(
		documentation,
		/validate every descriptor.*unique positive payload ID.*base64.*declared\s+length.*before allocating decoded bytes.*does not traverse or decode.*future-schema/isu,
	);
	assert.match(documentation, /Project feature requirements/u);
	assert.match(documentation, /does not hash or authenticate the referenced media bytes/iu);
	assert.match(documentation, /Current-schema and current-format `\.scape` preservation/iu);
	assert.match(documentation, /independent\s+retention root/iu);
	assert.match(
		documentation,
		/explicit stable broad capability IDs map one-to-one\s+to the maintained keys in each selected product profile/iu,
	);
	assert.match(documentation, /Only a strict `true` value makes a registered feature\s+available/iu);
	assert.match(documentation, /exact schema 9[\s\S]*before activation side effects/iu);
	assert.match(documentation, /actual project history[\s\S]*deeply frozen across session metadata[\s\S]*document snapshot/iu);
	assert.match(documentation, /same-ID tab[\s\S]*stored read-only declaration[\s\S]*ignored incoming[\s\S]*flags/iu);
	assert.match(documentation, /future schemas produce no\s+feature report, and\s+their `featureRequirements` value is not traversed/iu);
	assert.match(
		documentation,
		/programmatic current-format `\.scape`\s+inspection.*selected product.*caller.*override.*exact schema\s+9.*before.*collision lookup.*deeply\s+frozen.*import.*persistence.*activation/isu,
	);
	assert.match(documentation, /Future project\s+schemas.*`null`.*`featureRequirements`.*not traversed/isu);
	assert.match(documentation, /normal no-collision open.*Open read-only.*Cancel/isu);
	assert.match(documentation, /collision.*Open as read-only copy.*Cancel.*single decision/isu);
	assert.match(documentation, /Cancel.*before\s+import, persistence, or\s+activation/isu);
	assert.match(documentation, /controller.*actual project history.*intrinsically read-only/isu);
	assert.match(documentation, /does not establish arbitrary future-schema archive preservation/iu);
	assert.match(documentation, /export.*snapshots.*fallback claims.*before.*destination/isu);
	assert.match(documentation, /inspection.*descriptor binding.*does not read or\s+hash.*asset bodies/isu);
	assert.match(documentation, /import.*hashes.*asset body.*before.*source or project publication/isu);
	assert.match(documentation, /raw and stored-project.*controller activation.*verif(?:y|ies).*authoritative project.*fallback media at runtime.*complete\s+third-party activation gate/isu);
	assert.match(documentation, /Freeze and proxy fallback/u);
});
