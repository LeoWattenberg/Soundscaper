/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { editorProjectRuntimeProfileDefinition } from '../src/common/editor/project-runtime-profile.ts';
import { editorProjectRuntimeProfilePrerequisiteDefinition } from '../src/common/editor/project-runtime-profile-prerequisite.ts';
import { editorProjectFeatureCapabilityProfileDefinition } from '../src/common/editor/project-feature-capability-profile.ts';
import { SOUNDSCAPER_V21_PROJECT_STORAGE_PROFILE } from '../src/soundscaper/editor-project-storage-profile-v21.ts';
import { SOUNDSCAPER_V23_PROJECT_STORAGE_PROFILE } from '../src/soundscaper/editor-project-storage-profile-v23.ts';
import { SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE } from '../src/soundscaper/editor-project-runtime-profile-v23.ts';
import { SOUNDSCAPER_V23_PROJECT_FEATURE_CAPABILITY_PROFILE } from '../src/soundscaper/editor-project-feature-capability-profile-v23.ts';
import { createSoundscaperProjectFeatureCompatibilityServiceV23 } from '../src/soundscaper/editor-project-feature-compatibility-v23.ts';
import { createSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts';
import { createSoundscaperProjectV23 } from '../src/soundscaper/editor-project-v23.ts';

const NOW = '2026-08-17T00:00:00.000Z';

const project = () => createSoundscaperProjectV23({
	id: 'v23', title: 'Mastering', now: NOW, revision: 0,
	tracks: [{ type: 'audio', id: 'a1', name: 'A1' }],
} as never);

test('the V23 storage profile shares no namespace with V21', () => {
	// Isolation is the entire reason this profile exists per revision: reusing a
	// namespace would let a pre-release V23 write into live V21 user data.
	const v21 = JSON.parse(JSON.stringify(SOUNDSCAPER_V21_PROJECT_STORAGE_PROFILE)) as Record<string, string>;
	const v23 = JSON.parse(JSON.stringify(SOUNDSCAPER_V23_PROJECT_STORAGE_PROFILE)) as Record<string, string>;
	for (const key of Object.keys(v23)) {
		if (typeof v23[key] !== 'string') continue;
		assert.notEqual(v23[key], v21[key], `${key} must be distinct from V21's`);
	}
});

test('the runtime prerequisite pins renderer and desktop schema together at 23', () => {
	const profile = editorProjectRuntimeProfileDefinition(SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE);
	const prerequisite = editorProjectRuntimeProfilePrerequisiteDefinition(
		profile.prerequisite,
	) as unknown as Record<string, unknown>;
	assert.equal(prerequisite.projectSchemaVersion, 23);
	assert.equal(prerequisite.desktopProjectSchemaVersion, 23);
	assert.equal(prerequisite.owner, 'soundscaper');
	assert.equal(prerequisite.priorSchemaPolicy, 'reimport-required');
	assert.equal(prerequisite.futureSchemaPolicy, 'opaque-read-only');
});

test('the V23 capability profile registers mastering sequences as unavailable', () => {
	const registration = editorProjectFeatureCapabilityProfileDefinition(
		SOUNDSCAPER_V23_PROJECT_FEATURE_CAPABILITY_PROFILE,
	).registrations.find((entry) => entry.key === 'masteringSequences');
	assert.equal(registration?.available, false);
});

test('the compatibility service evaluates exact V23 and ignores every other revision', () => {
	const service = createSoundscaperProjectFeatureCompatibilityServiceV23();
	const report = service.evaluate(project());
	assert.ok(report, 'a V23 document gets a capability report');

	const v21 = createSoundscaperProjectV21({
		id: 'p', title: 'P', now: NOW, tracks: [{ type: 'audio', id: 'a1', name: 'A1' }],
	} as never);
	assert.equal(service.evaluate(v21), null, 'a V21 document is not this service\'s business');
	assert.equal(service.evaluate(null), null);
	assert.equal(service.evaluate({ schemaVersion: 24 }), null);
});

test('a project holding a sequence reports the capability as unavailable, not unknown', () => {
	// The whole point of registering it switched off: the report must name a
	// known-but-unavailable feature so the loss is legible.
	const base = project();
	const held = createSoundscaperProjectV23({
		id: 'v23', title: 'Mastering', now: NOW, revision: 0,
		tracks: [{ type: 'audio', id: 'a1', name: 'A1' }],
		masteringSequences: [{
			id: 'album', sequenceId: base.primarySequenceId, name: 'Album',
			entries: [{ id: 'e1', annotationId: 'a' }],
		}],
	} as never);
	const report = createSoundscaperProjectFeatureCompatibilityServiceV23().evaluate(held);
	assert.ok(report);
	const entries = JSON.stringify(report);
	assert.match(entries, /mastering-sequences/u, 'the requirement is named in the report');
	assert.equal(
		/unknown/u.test(entries) && !/unavailable/u.test(entries),
		false,
		'a registered capability must not be reported as unknown',
	);
});
