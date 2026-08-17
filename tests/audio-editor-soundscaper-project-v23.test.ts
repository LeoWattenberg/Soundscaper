/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import {
	SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION,
	isSoundscaperProductionProjectSchema,
} from '../src/common/editor/project-schema-version.ts';
import { createSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts';
import {
	SoundscaperProjectV23ReimportRequiredError,
	cloneSoundscaperProjectV23,
	createSoundscaperProjectV23,
	loadSoundscaperProjectV23,
	validateSoundscaperProjectV23,
} from '../src/soundscaper/editor-project-v23.ts';

const NOW = '2026-08-17T00:00:00.000Z';

function project(masteringSequences: readonly unknown[] = []) {
	return createSoundscaperProjectV23({
		id: 'v23', title: 'Mastering', now: NOW, revision: 0,
		tracks: [{ type: 'audio', id: 'a1', name: 'A1' }],
		masteringSequences,
	} as never);
}

const sequence = (overrides: Record<string, unknown> = {}) => ({
	id: 'album', sequenceId: 'main', name: 'Album order',
	entries: [{ id: 'e1', annotationId: 'region-a' }],
	...overrides,
});

function withPrimarySequenceId(value: readonly unknown[]) {
	// The document's own timeline sequence id, so a mastering sequence can name it.
	const base = project();
	return { base, primarySequenceId: base.primarySequenceId, sequences: base.sequences, value };
}

test('V23 is the next free revision, and 22 stays reserved', () => {
	assert.equal(SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION, 23);
	assert.equal(SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION + 2, SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION);
});

test('a V23 document carries the production authority, as V21 does', () => {
	// The shared predicate is what every render path asks, so V23 answering it is
	// the difference between a revision that plays back and one that goes silent.
	assert.equal(isSoundscaperProductionProjectSchema(SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION), true);
	assert.equal(project().schemaVersion, 23);
});

test('an empty V23 document is exactly a V21 document plus the new field', () => {
	const v23 = project();
	const v21 = createSoundscaperProjectV21({
		id: 'v23', title: 'Mastering', now: NOW, revision: 0,
		tracks: [{ type: 'audio', id: 'a1', name: 'A1' }],
	} as never);
	assert.deepEqual(v23.masteringSequences, []);
	const { masteringSequences, ...rest } = v23 as Record<string, unknown>;
	assert.deepEqual(
		JSON.parse(JSON.stringify({ ...rest, schemaVersion: 21 })),
		JSON.parse(JSON.stringify(v21)),
		'the revision adds one field and changes nothing else',
	);
});

test('exact-current validation accepts V23 and refuses every other revision', () => {
	assert.equal(validateSoundscaperProjectV23(project()), true);
	for (const schemaVersion of [17, 19, 21, 22, 24]) {
		assert.throws(
			() => validateSoundscaperProjectV23({ ...project(), schemaVersion }),
			/schemaVersion|schema version|V23/iu,
			`schema ${schemaVersion} is not V23`,
		);
	}
});

test('an older schema is a typed reimport refusal, not a migration', () => {
	const older = { ...createSoundscaperProjectV21({ id: 'p', title: 'P', now: NOW } as never) };
	assert.throws(() => loadSoundscaperProjectV23(older), (error: unknown) => {
		assert.ok(error instanceof SoundscaperProjectV23ReimportRequiredError);
		assert.equal(error.sourceSchemaVersion, 21);
		assert.equal(error.currentSchemaVersion, 23);
		return true;
	});
});

test('a future schema opens read-only and keeps its unknown data intact', () => {
	const future = { ...project(), schemaVersion: 24, somethingNewer: { kept: [1, 2, 3] } };
	const loaded = loadSoundscaperProjectV23(future);
	assert.equal(loaded.readOnly, true);
	assert.equal(loaded.intrinsicReadOnly, true);
	assert.equal(loaded.reason, 'newer-schema');
	assert.deepEqual(
		(loaded.project as Record<string, unknown>).somethingNewer,
		{ kept: [1, 2, 3] },
		'a newer revision\'s data is retained opaquely rather than dropped',
	);
});

test('load and clone round-trip a document byte-identically', () => {
	const original = project();
	const loaded = loadSoundscaperProjectV23(JSON.parse(JSON.stringify(original)));
	assert.equal(loaded.readOnly, false);
	assert.equal(JSON.stringify(loaded.project), JSON.stringify(original));
	assert.equal(JSON.stringify(cloneSoundscaperProjectV23(original)), JSON.stringify(original));
	// Idempotent: cloning a clone changes nothing further.
	assert.equal(
		JSON.stringify(cloneSoundscaperProjectV23(cloneSoundscaperProjectV23(original))),
		JSON.stringify(original),
	);
});

test('a clone is a copy, not a shared reference', () => {
	const original = project();
	const copy = cloneSoundscaperProjectV23(original);
	assert.notEqual(copy, original);
	assert.notEqual(copy.tracks, original.tracks);
});

test('a mastering sequence survives creation, clone and reload', () => {
	const { base } = withPrimarySequenceId([]);
	const held = createSoundscaperProjectV23({
		id: 'v23', title: 'Mastering', now: NOW, revision: 0,
		tracks: [{ type: 'audio', id: 'a1', name: 'A1' }],
		masteringSequences: [sequence({ sequenceId: base.primarySequenceId })],
	} as never);
	assert.equal(held.masteringSequences.length, 1);
	assert.equal(held.masteringSequences[0].entries[0].annotationId, 'region-a');

	const reloaded = loadSoundscaperProjectV23(JSON.parse(JSON.stringify(held)));
	assert.deepEqual(
		(reloaded.project as typeof held).masteringSequences,
		held.masteringSequences,
		'semantics survive a full save and load',
	);
	assert.equal(JSON.stringify(cloneSoundscaperProjectV23(held)), JSON.stringify(held));
});

test('holding a mastering sequence demands the capability', () => {
	// The state-to-manifest completeness rule: a project cannot hold the state
	// and stay silent about needing the feature, or opening it where the
	// capability is unavailable would drop the sequence without saying so.
	const { base } = withPrimarySequenceId([]);
	const held = createSoundscaperProjectV23({
		id: 'v23', title: 'Mastering', now: NOW, revision: 0,
		tracks: [{ type: 'audio', id: 'a1', name: 'A1' }],
		masteringSequences: [sequence({ sequenceId: base.primarySequenceId })],
	} as never);
	const ids = held.featureRequirements.requirements.map((entry) => entry.featureId);
	assert.ok(
		ids.includes(PROJECT_FEATURE_CAPABILITY_IDS.masteringSequences),
		'a project holding a sequence must demand the capability',
	);
	assert.equal(
		project().featureRequirements.requirements
			.some((entry) => entry.featureId === PROJECT_FEATURE_CAPABILITY_IDS.masteringSequences),
		false,
		'and a project holding none must not',
	);
});

test('a sequence naming a timeline sequence the project lacks is refused', () => {
	assert.throws(
		() => createSoundscaperProjectV23({
			id: 'v23', title: 'Mastering', now: NOW, revision: 0,
			tracks: [{ type: 'audio', id: 'a1', name: 'A1' }],
			masteringSequences: [sequence({ sequenceId: 'no-such-sequence' })],
		} as never),
		/missing timeline sequence/u,
	);
});

test('the closed field domain rejects both unknown fields and a missing one', () => {
	assert.throws(
		() => validateSoundscaperProjectV23({ ...project(), notAField: 1 }),
		/unsupported|notAField/iu,
	);
	const missing = { ...project() } as Record<string, unknown>;
	delete missing.masteringSequences;
	assert.throws(() => validateSoundscaperProjectV23(missing), /masteringSequences|missing|required/iu);
});

test('duplicate sequence identities are refused rather than deduplicated', () => {
	const { base } = withPrimarySequenceId([]);
	assert.throws(
		() => createSoundscaperProjectV23({
			id: 'v23', title: 'Mastering', now: NOW, revision: 0,
			tracks: [{ type: 'audio', id: 'a1', name: 'A1' }],
			masteringSequences: [
				sequence({ sequenceId: base.primarySequenceId }),
				sequence({ sequenceId: base.primarySequenceId, name: 'Other' }),
			],
		} as never),
		/listed more than once/u,
	);
});
