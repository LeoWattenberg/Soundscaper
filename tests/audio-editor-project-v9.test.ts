/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { migrateAudioEditorProject } from '../src/common/editor/migration.js';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	cloneAudioEditorProjectV9,
	createAudioEditorProjectV9,
	loadAudioEditorProjectV9,
	validateAudioEditorProjectV9,
} from '../src/common/editor/project-v9.ts';
import { validateAudioEditorProjectV9 as validateAudioEditorProjectV9Direct } from '../src/common/editor/project-v9-validation.ts';

const NOW = '2026-07-29T12:00:00.000Z';

function featureRequirements() {
	return {
		schemaVersion: 1,
		requirements: [{
			id: 'native-restoration',
			featureId: 'org.soundscaper.native.spectral-repair',
			displayName: 'Spectral repair',
			disposition: 'bypass',
			fallback: null,
		}],
	};
}

test('V9 projects require a normalized feature-requirements manifest', () => {
	const input = featureRequirements();
	const project = createAudioEditorProjectV9({
		id: 'feature-project',
		title: 'Native feature project',
		now: NOW,
		featureRequirements: input,
	});

	assert.equal(AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION, 10);
	assert.strictEqual(validateAudioEditorProjectV9, validateAudioEditorProjectV9Direct);
	assert.equal(project.schemaVersion, 9);
	assert.deepEqual(project.featureRequirements, { ...input, schemaVersion: 2 });
	assert.notStrictEqual(project.featureRequirements, input);
	assert.equal(validateAudioEditorProjectV9(project), true);

	input.requirements[0]!.displayName = 'Changed input';
	assert.equal(project.featureRequirements.requirements[0]?.displayName, 'Spectral repair');

	const withoutManifest = structuredClone(project) as unknown as Record<string, unknown>;
	delete withoutManifest.featureRequirements;
	assert.throws(() => validateAudioEditorProjectV9(withoutManifest), /feature.*requirements/iu);
	const malformed = structuredClone(project) as unknown as Record<string, unknown>;
	(malformed.featureRequirements as { requirements: Record<string, unknown>[] }).requirements.push({
		...(malformed.featureRequirements as { requirements: Record<string, unknown>[] }).requirements[0],
	});
	assert.throws(() => validateAudioEditorProjectV9(malformed), /duplicate.*requirement.*id/iu);
});

test('V9 direct loads clone canonical manifests while the current router requires re-import', () => {
	const project = createAudioEditorProjectV9({ now: NOW, featureRequirements: featureRequirements() });
	const loaded = loadAudioEditorProjectV9(project);

	assert.deepEqual(loaded, { project, readOnly: false, reason: null });
	assert.notStrictEqual(loaded.project, project);
	assert.notStrictEqual(
		(loaded.project as typeof project).featureRequirements,
		project.featureRequirements,
	);
	const cloned = cloneAudioEditorProjectV9(project);
	assert.deepEqual(cloned, project);
	assert.notStrictEqual(cloned.featureRequirements, project.featureRequirements);
	assert.equal(Object.isFrozen(cloned.featureRequirements), true);

	assert.throws(
		() => migrateAudioEditorProject(project),
		(error: unknown) => error instanceof RangeError
			&& (error as Readonly<{ code?: string }>).code === 'REIMPORT_REQUIRED',
	);
});

test('V9 projects remain editable while commands retain requirement state', () => {
	const project = createAudioEditorProjectV9({ now: NOW, featureRequirements: featureRequirements() });
	const updated = applyEditorCommand(project, {
		type: 'metadata/update',
		changes: { artist: 'Soundscaper' },
	}, { now: NOW });

	assert.equal(updated.schemaVersion, 9);
	assert.equal((updated.metadata as { artist: string }).artist, 'Soundscaper');
	assert.deepEqual(updated.featureRequirements, project.featureRequirements);
	assert.notStrictEqual(updated.featureRequirements, project.featureRequirements);
	assert.equal(Object.isFrozen(updated.featureRequirements), true);
	assert.equal(Object.isFrozen(updated.featureRequirements.requirements), true);
	assert.equal(Object.isFrozen(updated.featureRequirements.requirements[0]), true);
	assert.equal(validateAudioEditorProjectV9(updated), true);
});

test('V9 loading and the migration boundary preserve future projects opaquely read-only', () => {
	const current = createAudioEditorProjectV9({ now: NOW });
	const future = {
		...current,
		schemaVersion: 11,
		featureRequirements: {
			schemaVersion: 99,
			unknownFutureManifestState: { retained: true },
		},
		futureData: { nested: { retained: true } },
	};

	const loaded = loadAudioEditorProjectV9(future);
	assert.deepEqual(loaded, { project: future, readOnly: true, reason: 'newer-schema' });
	assert.notStrictEqual(loaded.project, future);
	assert.notStrictEqual(
		(loaded.project as { futureData: object }).futureData,
		future.futureData,
	);

	const routed = migrateAudioEditorProject(future);
	assert.equal(routed.migrated, false);
	assert.equal(routed.fromVersion, 11);
	assert.equal(routed.readOnly, true);
	assert.equal(routed.reason, 'newer-schema');
	assert.deepEqual(routed.project, future);
	assert.notStrictEqual(routed.project, future);
});
