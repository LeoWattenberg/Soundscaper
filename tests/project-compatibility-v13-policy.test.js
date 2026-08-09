/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);

test('the compatibility register binds exact V13 editing to current implementation evidence', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rules = new Map(policy.rules.map((rule) => [rule.id, rule]));
	const legacySchema = rules.get('legacy-schema-migration');
	const currentSchema = rules.get('current-schema-editing');
	const timelineAnnotations = rules.get('current-timeline-annotation-capability');
	const trackFolders = rules.get('current-track-folder-capability');

	assert.equal(AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION, 13);
	assert.deepEqual(policy.projectSchema, {
		currentVersion: 13,
		minimumReadableVersion: 13,
		retainedMigrationSources: [],
	});
	assert.equal(policy.schemaRetirement.currentMinimumVersion, 13);
	assert.match(legacySchema.currentBehavior, /Schema 13.*Schemas 1 through 12.*REIMPORT_REQUIRED.*AUP4.*schema 13/iu);
	assert.ok(legacySchema.evidence.includes('tests/audio-editor-project-schema-policy.test.ts'));
	assert.match(currentSchema.currentBehavior, /Schema 13.*maintained writable raw-project schema.*cloned/iu);
	assert.deepEqual(currentSchema.evidence, [
		'src/common/editor/project-current.ts',
		'src/common/editor/project-v12.ts',
		'src/common/editor/project-v12-validation.ts',
		'src/common/editor/timeline-annotation.ts',
		'tests/audio-editor-project-v13.test.ts',
		'tests/audio-editor-scape-project.test.js',
	]);
	assert.match(
		trackFolders.currentBehavior,
		/schema 13.*trackFolders.*trackNodes.*trackIds.*exact hierarchy preorder.*soundscaper\.track-folders.*org\.soundscaper\.capability\.track-folders.*Nested track folders.*bypass.*no fallback.*Soundscaper and Framescaper.*known but unavailable.*unavailable\/bypassed.*excluded from both rendered-fallback.*audio or video fallback.*rejects.*mandatory root trackNodes.*add, remove, and within-sequence reorder.*cross-sequence reorder.*nonempty hierarchy.*reject.*before playback, audio render, video preview, or video export.*transient projection.*inherited folder mute, solo, and hidden.*leaf track flags.*before rendered-fallback.*private trust.*forged projection marker.*before hierarchy traversal.*canonical folder state.*leaf-local state.*routing.*history.*persistence unchanged.*collapsed and height.*UI-only.*clone.*undo\/redo.*local storage.*\.scape.*desktop-library V4.*no folder-aware editing command.*clipboard.*native UI/iu,
	);
	assert.deepEqual(trackFolders.evidence, [
		'src/common/editor/project-v12.ts',
		'src/common/editor/project-v12-validation.ts',
		'src/common/editor/track-folder-v12.ts',
		'src/common/editor/track-hierarchy-v12.ts',
		'src/common/editor/track-folder-state-projection.ts',
		'src/common/editor/track-folder-media-runtime.ts',
		'src/common/editor/project-v10-command-projection.ts',
		'src/common/editor/controller/playback-project-service.ts',
		'src/common/editor/controller/video-export-service.ts',
		'src/common/editor/controller/video-export-timing.ts',
		'src/common/editor/video-export.js',
		'src/common/editor/video-timeline.js',
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-owned-feature-requirements.ts',
		'src/soundscaper/product.js',
		'src/framescaper/product.js',
		'tests/audio-editor-project-v13.test.ts',
		'tests/audio-editor-track-folder-state-projection.test.ts',
		'tests/audio-editor-track-folder-media-runtime.test.ts',
		'tests/desktop-project-library-v12-folder-roundtrip.test.ts',
	]);
	assert.match(
		timelineAnnotations.currentBehavior,
		/non-empty schema 13 timelineAnnotations.*reserved soundscaper\.timeline-annotations.*org\.soundscaper\.capability\.timeline-annotations.*bypass.*no fallback.*Soundscaper.*available\/native.*command.*controller.*pointer and keyboard UI.*ripple-edit.*clipboard.*AUP\/AUP4.*RIFF.*Framescaper.*known but unavailable.*unavailable\/bypassed.*read-only preservation.*excluded from both audio and video rendered-fallback.*exact-V13.*runtime projection.*atomic command reconciliation.*`?\.scape`? persistence.*desktop handoff.*authoritative annotation coordinates.*stable IDs.*batch identity.*opaque extensions.*Audacity export reports losses.*RIFF export.*stable-ID.*no Framescaper-native annotation editing.*playback rendering.*audio or video fallback/iu,
	);
	assert.deepEqual(timelineAnnotations.evidence, [
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-owned-feature-requirements.ts',
		'src/common/editor/timeline-annotation.ts',
		'src/common/editor/commands/protocol.ts',
		'src/common/editor/commands/timeline-annotation-runtime.ts',
		'src/common/editor/commands/timeline-annotation-ripple.ts',
		'src/common/editor/commands/timeline-annotation-clipboard.ts',
		'src/common/editor/runtime-timeline-annotation-projection.ts',
		'src/common/editor/controller/command-capability-policy.ts',
		'src/common/editor/controller/timeline-annotation-service.ts',
		'src/common/editor/ui/timeline/TimelineAnnotationLayer.jsx',
		'src/common/editor/ui/timeline/TimelineAnnotationPanel.jsx',
		'src/common/editor/audacity-annotation-interchange.ts',
		'src/common/editor/aup4-annotation-interchange.ts',
		'src/common/editor/timeline-annotation-riff-interchange.ts',
		'src/soundscaper/product.js',
		'src/framescaper/product.js',
		'tests/audio-editor-timeline-annotation-command-integration.test.ts',
		'tests/audio-editor-timeline-annotation-feature-registration.test.ts',
		'tests/audio-editor-timeline-annotation-ripple.test.ts',
		'tests/audio-editor-timeline-annotation-clipboard.test.ts',
		'tests/audio-editor-timeline-annotation-service.test.ts',
		'tests/audio-editor-timeline-annotation-components.test.tsx',
		'tests/audio-editor-audacity-annotation-interchange.test.ts',
		'tests/audio-editor-timeline-annotation-riff-interchange.test.ts',
		'tests/audio-editor-scape-project.test.js',
		'tests/desktop-project-library-handoff.test.ts',
		'tests/browser/audio-editor-timeline-annotations.spec.js',
	]);
});
