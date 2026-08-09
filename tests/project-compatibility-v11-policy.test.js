/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);

test('the compatibility register binds exact V11 editing to current implementation evidence', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rules = new Map(policy.rules.map((rule) => [rule.id, rule]));
	const legacySchema = rules.get('legacy-schema-migration');
	const currentSchema = rules.get('current-schema-editing');
	const timelineAnnotations = rules.get('current-timeline-annotation-capability');

	assert.equal(AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION, 11);
	assert.deepEqual(policy.projectSchema, {
		currentVersion: 11,
		minimumReadableVersion: 11,
		retainedMigrationSources: [],
	});
	assert.equal(policy.schemaRetirement.currentMinimumVersion, 11);
	assert.match(legacySchema.currentBehavior, /Schema 11.*Schemas 1 through 10.*REIMPORT_REQUIRED.*AUP4.*schema 11/iu);
	assert.ok(legacySchema.evidence.includes('tests/audio-editor-project-schema-policy.test.ts'));
	assert.match(currentSchema.currentBehavior, /Schema 11.*maintained writable raw-project schema.*cloned/iu);
	assert.deepEqual(currentSchema.evidence, [
		'src/common/editor/project-current.ts',
		'src/common/editor/project-v11.ts',
		'src/common/editor/project-v11-validation.ts',
		'src/common/editor/timeline-annotation.ts',
		'tests/audio-editor-project-v11.test.ts',
		'tests/audio-editor-scape-project.test.js',
	]);
	assert.match(
		timelineAnnotations.currentBehavior,
		/non-empty schema 11 timelineAnnotations.*reserved soundscaper\.timeline-annotations.*org\.soundscaper\.capability\.timeline-annotations.*bypass.*no fallback.*Soundscaper and Framescaper.*known but unavailable.*unavailable\/bypassed.*excluded from both audio and video rendered-fallback.*V11.*`?\.scape`? semantic.*desktop library handoff.*preserve canonical timeline annotation state.*no annotation editing UI.*playback.*export rendering/iu,
	);
	assert.deepEqual(timelineAnnotations.evidence, [
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-owned-feature-requirements.ts',
		'src/common/editor/timeline-annotation.ts',
		'src/common/products.js',
		'tests/audio-editor-timeline-annotation-feature-registration.test.ts',
		'tests/audio-editor-project-v11.test.ts',
		'tests/audio-editor-scape-project.test.js',
		'tests/desktop-project-library-handoff.test.ts',
	]);
});
