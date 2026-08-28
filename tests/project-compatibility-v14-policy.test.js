/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('the compatibility register binds the family-v1 baseline to current implementation evidence', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const threatModel = await readFile(threatModelUrl, 'utf8');
	const rules = new Map(policy.rules.map((rule) => [rule.id, rule]));
	const legacySchema = rules.get('pre-release-reimport-required');
	const currentSchema = rules.get('current-schema-editing');
	const trackLocking = rules.get('current-track-locking');
	const timelineAnnotations = rules.get('current-timeline-annotation-capability');
	const trackFolders = rules.get('current-track-folder-capability');
	const sourceCharacteristics = rules.get('current-source-characteristics-capability');

	assert.deepEqual(
		policy.projectSchema.baselines.map(({ schemaFamily, currentVersion, retainedMigrationSources }) => ({
			schemaFamily, currentVersion, retainedMigrationSources,
		})),
		[
			{ schemaFamily: 'soundscaper', currentVersion: 1, retainedMigrationSources: [] },
			{ schemaFamily: 'framescaper', currentVersion: 1, retainedMigrationSources: [] },
		],
	);
	assert.deepEqual(policy.schemaRetirement.currentMinimumVersions, {
		soundscaper: 1, framescaper: 1,
	});
	assert.match(legacySchema.currentBehavior, /1\.0 baseline.*own enumerable data-property identities.*does not migrate, normalize, enumerate, copy forward, mutate, or delete.*pre-release Soundscaper or Framescaper.*future supported family schema.*v1 baseline/iu);
	assert.ok(legacySchema.evidence.includes('tests/audio-editor-project-schema-identity.test.ts'));
	assert.match(currentSchema.currentBehavior, /Soundscaper.*soundscaper.*schemaVersion:1.*writable.*Framescaper.*framescaper.*schemaVersion:1.*writable.*other known family.*later version.*opaque read-only.*without domain traversal.*Unknown families.*accessor-backed.*reject before project traversal/iu);
	assert.deepEqual(currentSchema.evidence, [
		'src/common/editor/project-schema-identity.ts',
		'src/soundscaper/editor-project.ts',
		'src/framescaper/editor-project.ts',
		'src/common/editor/scape-project.js',
		'tests/audio-editor-project-schema-identity.test.ts',
		'tests/audio-editor-scape-v1-baseline.test.ts',
	]);
	assert.equal(trackLocking.status, 'implemented');
	assert.match(
		trackLocking.requiredOutcome,
		/exact-current audio, video, and label track.*required persisted editorial-lock fact.*both products preserve.*enforce at the shared command boundary.*toggle through the track control panel overflow menu.*without a capability or fallback/iu,
	);
	assert.match(
		trackLocking.currentBehavior,
		/family v1.*own boolean locked field.*audio, video, and label track.*Soundscaper and Framescaper.*default it false.*clone.*history.*browser and desktop persistence.*track control panel overflow Lock track and Unlock track.*shared low-level command boundary.*transaction-start lock authority.*arbitrary nested batches.*direct and indirect changes.*content.*timing.*media.*grouping.*lane and folder identity.*reconciled result.*before publication.*Selection.*header, mixer, view, and track-rack controls.*remain available.*does not hide, mute, bypass, or make a project read-only.*no capability ID.*owned requirement.*rendered fallback.*optional older-schema extension.*default-visible control/iu,
	);
	assert.deepEqual(trackLocking.evidence, [
		'src/common/editor/project-structure-factory.ts',
		'src/common/editor/project-track-lock-validation.ts',
		'src/common/editor/commands/track-lock-admission.ts',
		'src/common/editor/commands.js',
		'src/common/editor/ui/timeline/timeline-menu-model.js',
		'tests/audio-editor-soundscaper-baseline.test.ts',
		'tests/audio-editor-track-lock-admission.test.ts',
		'tests/audio-editor-track-lock-batch.test.ts',
		'tests/audio-editor-track-lock-overflow-menu.test.tsx',
		'tests/audio-editor-scape-project.test.js',
		'tests/desktop-soundscaper-project-library-baseline.test.ts',
		'tests/browser/audio-editor-track-lock.spec.js',
	]);
	assert.match(
		threatModel.replace(/\s+/gu, ' '),
		/family v1.*own enumerable boolean `locked` field.*audio, video, and label track.*shared command boundary.*transaction-start authority.*nested batches.*direct and indirect changes.*editorial content.*structure.*source bindings.*resolved timing.*reconciled result before publication.*locked later in the same transaction.*authority monotonically.*Selection.*header, mixer, view, and track-rack controls remain usable.*both products.*Lock track and Unlock track.*Tracks menu.*no capability, fallback, read-only compatibility state, or default-visible control.*does not imply mute, hidden, bypass, or whole-project read-only state/iu,
	);
	assert.match(
		trackFolders.currentBehavior,
		/family v1.*trackFolders.*trackNodes.*trackIds.*exact hierarchy preorder.*soundscaper\.track-folders.*org\.soundscaper\.capability\.track-folders.*Nested track folders.*bypass.*no fallback.*Soundscaper registers the capability available.*available\/native.*Framescaper registers the capability known but unavailable.*unavailable\/bypassed.*excluded from both rendered-fallback.*audio or video fallback.*rejects.*mandatory root trackNodes.*add, remove, and within-sequence reorder.*nonempty hierarchy.*delegate to the folder-aware path.*adopts the parent folder.*lane partner.*whole structural blocks.*cross-sequence reorder.*reject.*before playback, audio render, video preview, or video export.*transient projection.*inherited folder mute, solo, and hidden.*leaf track flags.*before rendered-fallback.*private trust.*forged projection marker.*before hierarchy traversal.*canonical folder state.*leaf-local state.*routing.*history.*persistence unchanged.*collapsed and height.*UI-only.*clone.*undo\/redo.*local storage.*\.scape.*family-v1 desktop-library.*track-folder\/add.*track-folder\/update.*track-folder\/remove.*promote or delete-contents.*track-node\/move.*execute natively in Soundscaper.*reject in Framescaper.*hierarchy preorder.*folder bus ownership.*mirrored bus identity.*one undoable command.*direct mixer edits.*reject.*ADM authored programme refuses.*change bus ownership.*at the command.*clipboard wire format is unchanged.*paste-created tracks join the folder of the paste anchor.*lane pair lands in one folder.*native tree UI ships in Soundscaper.*pointer, keyboard, and context-menu parity.*no audio or video fallback/iu,
	);
	assert.equal(sourceCharacteristics.status, 'implemented');
	assert.match(
		sourceCharacteristics.currentBehavior,
		/family v1 video source carries a characteristics record.*reporting backend.*coded frame size.*rotation.*pixel aspect ratio.*field order.*alpha.*video codec.*colour primaries.*audio stream inventory.*source start timecode.*explicit null rather than a plausible default.*unknown rotation is not zero.*unreported audio inventory is not an empty one.*canonical normalized form.*reject rather than repair.*framescaper\.source-characteristics.*org\.soundscaper\.capability\.source-characteristics.*Probed source characteristics.*bypass.*no fallback.*both products.*register the capability available.*available\/native.*excluded from both rendered-fallback eligibility.*rejects at manifest admission.*disclosure and interchange, not conversion.*no deinterlacer.*no colour management.*no multi-stream audio import.*byte-exactly.*no re-import upgrade/iu,
	);
	assert.deepEqual(sourceCharacteristics.evidence, [
		'src/common/editor/video-source-characteristics.ts',
		'src/common/editor/source-characteristics-v14.ts',
		'src/common/editor/project-structure-factory.ts',
		'src/soundscaper/editor-project-validation.ts',
		'src/common/editor/project-owned-feature-requirements.ts',
		'tests/audio-editor-video-source-characteristics.test.ts',
		'tests/audio-editor-source-characteristics-v14.test.ts',
	]);
	assert.deepEqual(trackFolders.evidence, [
		'src/common/editor/project-structure-factory.ts',
		'src/common/editor/project-hierarchy-document-validation.ts',
		'src/common/editor/track-folder-v12.ts',
		'src/common/editor/track-hierarchy-v12.ts',
		'src/common/editor/track-folder-state-projection.ts',
		'src/common/editor/track-folder-media-runtime.ts',
		'src/common/editor/project-command-projection.ts',
		'src/common/editor/project-hierarchy-reconcile.ts',
		'src/common/editor/track-hierarchy-mutation-v12.ts',
		'src/common/editor/folder-bus-v13.ts',
		'src/common/editor/commands/track-folder-runtime.ts',
		'src/common/editor/commands/track-structure-folder-adapter.ts',
		'src/common/editor/controller/clipboard-edit-service.ts',
		'src/common/editor/controller/track-folder-service.ts',
		'src/common/editor/controller/document-track-folder-snapshot.ts',
		'src/common/editor/controller/command-capability-policy.ts',
		'src/common/editor/controller/playback-project-service.ts',
		'src/common/editor/controller/video-export-service.ts',
		'src/common/editor/controller/video-export-timing.ts',
		'src/common/editor/video-export.js',
		'src/common/editor/video-timeline.js',
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-owned-feature-requirements.ts',
		'src/soundscaper/product.js',
		'src/framescaper/product.js',
		'tests/audio-editor-soundscaper-baseline.test.ts',
		'tests/audio-editor-track-hierarchy-mutation-v12.test.ts',
		'tests/audio-editor-folder-bus-v13.test.ts',
		'tests/audio-editor-track-folder-commands.test.ts',
		'tests/audio-editor-track-folder-legacy-commands.test.ts',
		'tests/audio-editor-clipboard-edit-service.test.ts',
		'tests/audio-editor-track-folder-roundtrip.test.ts',
		'tests/audio-editor-track-folder-adm.test.ts',
		'tests/audio-editor-track-folder-service.test.ts',
		'tests/audio-editor-track-folder-state-projection.test.ts',
		'tests/audio-editor-track-folder-media-runtime.test.ts',
		'tests/desktop-soundscaper-project-library-baseline.test.ts',
	]);
	assert.match(
		timelineAnnotations.currentBehavior,
		/non-empty family v1 timelineAnnotations.*reserved soundscaper\.timeline-annotations.*org\.soundscaper\.capability\.timeline-annotations.*bypass.*no fallback.*Soundscaper.*Framescaper family v1.*available\/native.*command.*controller.*pointer and keyboard UI.*ripple-edit.*clipboard.*AUP\/AUP4.*RIFF.*reviewed shot acceptance.*source and selection authority.*owned in-selection markers.*Pre-release Framescaper profiles.*provenance only.*no family-v1 capability authority.*excluded from both audio and video rendered-fallback.*exact owning-family v1.*runtime projection.*atomic command reconciliation.*`?\.scape`? persistence.*desktop handoff.*authoritative annotation coordinates.*stable IDs.*batch identity.*opaque extensions.*Audacity export reports losses.*RIFF export.*stable-ID.*no annotation contribution to playback rendering.*audio or video fallback.*manual qualification.*does not disable/iu,
	);
	for (const path of [
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
		'tests/audio-editor-local-assistance-shot-acceptance.test.ts',
		'tests/audio-editor-timeline-annotation-ripple.test.ts',
		'tests/audio-editor-timeline-annotation-clipboard.test.ts',
		'tests/audio-editor-timeline-annotation-service.test.ts',
		'tests/audio-editor-timeline-annotation-components.test.tsx',
		'tests/audio-editor-audacity-annotation-interchange.test.ts',
		'tests/audio-editor-timeline-annotation-riff-interchange.test.ts',
		'tests/audio-editor-scape-project.test.js',
		'tests/audio-editor-soundscaper-baseline.test.ts',
		'tests/browser/audio-editor-timeline-annotations.spec.js',
	]) assert.ok(timelineAnnotations.evidence.includes(path), path);
});
