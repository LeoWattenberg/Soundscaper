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
	assert.equal(policy.portableArchive.roundTripGuarantee, 'json-semantic-not-byte-identical');
});

test('compatibility rules distinguish enforced guarantees from planned lossless fallbacks', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rules = new Map(policy.rules.map((rule) => [rule.id, rule]));
	assert.equal(rules.size, policy.rules.length);

	const expectedStatuses = {
		'legacy-schema-migration': 'implemented',
		'current-schema-editing': 'implemented',
		'project-feature-requirements-core': 'implemented',
		'future-core-read-only': 'implemented',
		'future-scape-round-trip': 'planned',
		'json-opaque-extensions': 'implemented',
		'binary-opaque-native-state': 'planned',
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

	const unavailable = rules.get('unavailable-native-feature');
	assert.equal(unavailable.status, 'planned');
	assert.match(
		unavailable.currentBehavior,
		/\.scape inspection\/open.*controller enforcement.*visible placeholder.*digest verification.*fallback use.*opaque native-state/iu,
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
	assert.match(documentation, /not\s+byte-for-byte/u);
	assert.match(documentation, /binary opaque/iu);
	assert.match(documentation, /Project feature requirements/u);
	assert.match(documentation, /does not hash or authenticate the referenced media bytes/iu);
	assert.match(documentation, /does not establish dedicated `\.scape` inspection\/open/iu);
	assert.match(documentation, /Freeze and proxy fallback/u);
});
