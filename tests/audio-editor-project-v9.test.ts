/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	cloneAudioEditorProjectV17,
	createAudioEditorProjectV17,
	validateAudioEditorProjectV17,
} from '../src/common/editor/project-v17.ts';

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

test('the current project normalizes and owns its feature-requirements manifest', () => {
	const input = featureRequirements();
	const project = createAudioEditorProjectV17({
		id: 'feature-project',
		title: 'Native feature project',
		now: NOW,
		featureRequirements: input,
	});

	assert.equal(project.schemaVersion, 17);
	assert.deepEqual(project.featureRequirements, { ...input, schemaVersion: 2 });
	assert.notStrictEqual(project.featureRequirements, input);
	assert.equal(Object.isFrozen(project.featureRequirements), true);
	assert.equal(Object.isFrozen(project.featureRequirements.requirements), true);
	assert.equal(validateAudioEditorProjectV17(project), true);

	input.requirements[0]!.displayName = 'Changed input';
	assert.equal(project.featureRequirements.requirements[0]?.displayName, 'Spectral repair');

	const cloned = cloneAudioEditorProjectV17(project);
	assert.deepEqual(cloned, project);
	assert.notStrictEqual(cloned.featureRequirements, project.featureRequirements);

	const withoutManifest = structuredClone(project) as unknown as Record<string, unknown>;
	delete withoutManifest.featureRequirements;
	assert.throws(() => validateAudioEditorProjectV17(withoutManifest), /feature.*requirements/iu);
	const malformed = structuredClone(project) as unknown as Record<string, unknown>;
	(malformed.featureRequirements as { requirements: Record<string, unknown>[] }).requirements.push({
		...(malformed.featureRequirements as { requirements: Record<string, unknown>[] }).requirements[0],
	});
	assert.throws(() => validateAudioEditorProjectV17(malformed), /duplicate.*requirement.*id/iu);
});

test('current commands retain normalized requirement state without aliases', () => {
	const project = createAudioEditorProjectV17({
		now: NOW,
		featureRequirements: featureRequirements(),
	});
	const updated = applyEditorCommand(project, {
		type: 'metadata/update',
		changes: { artist: 'Soundscaper' },
	}, { now: NOW });

	assert.equal(updated.schemaVersion, 17);
	assert.equal(updated.metadata.artist, 'Soundscaper');
	assert.deepEqual(updated.featureRequirements, project.featureRequirements);
	assert.notStrictEqual(updated.featureRequirements, project.featureRequirements);
	assert.equal(Object.isFrozen(updated.featureRequirements), true);
	assert.equal(Object.isFrozen(updated.featureRequirements.requirements), true);
	assert.equal(Object.isFrozen(updated.featureRequirements.requirements[0]), true);
	assert.equal(validateAudioEditorProjectV17(updated), true);
});
