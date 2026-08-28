/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

test('compatibility policy qualifies a generic whole-project video role and first-party clip role', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-video-rendered-fallback-playback');
	assert.ok(rule);
	assert.equal(rule.status, 'implemented');
	assert.match(
		rule.requiredOutcome,
		/exact owning-family v1.*project-video-render-v1.*unavailable or unknown.*canonical namespaced feature (?:ID|identity).*full-source render.*unavailable-only video-clip-render-v1.*exact videoEffects.*one exact target clip.*complete admitted render/iu,
	);
	assert.match(
		rule.requiredOutcome,
		/maintained video export.*role- and target-bound operation-time admission.*export signal.*exact canonical native Blob.*size-checks and hashes.*direct immutable-byte reuse.*canonical project.*intrinsically read-only.*unmodified/iu,
	);
	assert.match(
		rule.requiredOutcome,
		/final-video delivery.*one.*audio whole-mix fallback.*one.*video fallback.*joint.*operation-time admission.*private chunk provider.*exact.*Blob/iu,
	);
	assert.match(
		rule.requiredOutcome,
		/portable \.scape.*explicit managed desktop handoff.*fresh recipient.*preserve the clip relationship.*manifest-only fallback body.*controller.*manifest fallback digest.*before activation.*again for later delivery/iu,
	);
	assert.match(
		rule.currentBehavior,
		/authoritative actual project history.*exact owning-family v1.*exactly one qualifying item.*project-video-render-v1.*canonical namespaced feature ID.*unavailable or unknown.*video-clip-render-v1.*exact videoEffects.*unavailable.*declared and effective rendered-fallback.*canonical manifest requirement.*requirement ID.*feature ID.*disposition.*role.*optional target clip ID.*video kind.*source ID.*SHA-256/iu,
	);
	assert.match(
		rule.currentBehavior,
		/project-fallback-integrity.*local body.*before activation side effects.*final-video delivery.*exact video selector.*requirement ID.*feature ID.*role.*target clip ID.*video kind.*source ID.*SHA-256.*export task signal.*joint selector-mode verification/iu,
	);
	assert.match(
		rule.currentBehavior,
		/joint selector-mode verification.*audio.*video selectors.*cumulative.*64 GiB.*before.*body reads.*full canonical audio.*chunk scan.*private chunk provider.*canonical native Blob.*exact immutable Blob.*before video planning.*storage preflight.*render.*selected encoding.*output publication/iu,
	);

	assert.match(
		rule.currentBehavior,
		/project-video-render-v1.*exact video kind.*project sample rate.*positive safe-integer frame count.*width.*height.*positive finite frame rate.*reserved synthetic track or clip ID collisions/iu,
	);
	assert.match(
		rule.currentBehavior,
		/project-video-render-v1.*transient projection.*replaces all timeline video clips and tracks.*one neutral clip and track.*full source.*frame zero.*preserving audio and label.*Project Bin.*sources.*every other canonical field/iu,
	);
	assert.match(
		rule.currentBehavior,
		/video-clip-render-v1.*restricted to videoEffects.*one exact target clip ID.*enabled maintained video effect.*fallback source.*different from the canonical source.*hasAudio false.*frame count equal to the target duration.*match.*sample rate.*width.*height.*frame rate/iu,
	);
	assert.match(
		rule.currentBehavior,
		/video-clip-render-v1.*replaces only the target timeline clip.*source.*frame zero.*trims.*zero.*speed.*one.*video effects.*empty.*track membership.*timeline placement.*duration.*group.*A\/V link.*layer.*transition context.*unaffected clip and source.*canonical project and history.*unchanged/iu,
	);
	assert.match(
		rule.currentBehavior,
		/ordinary video composition and export.*projected target.*normally loaded unaffected video.*manifest-only fallback.*required video source.*activated before.*engine or preview.*WebGL preview.*exact projected source identity/iu,
	);
	assert.match(
		rule.currentBehavior,
		/video delivery projection.*audio rendered-fallback projection of either closed audio role.*then.*video rendered fallback.*at most one.*audio.*one.*video.*reapplies exactly the audio and video effect bypasses playback applied.*unrepresented.*duplicate same-kind.*reject.*full-project plan.*only video input.*clip-local plan.*selected target input.*unaffected clip-local video inputs.*ordinary loading/iu,
	);
	assert.match(
		rule.currentBehavior,
		/active audio whole-mix.*empty private.*buffer map.*sole.*chunk.*source.*otherwise.*canonical audio.*separate staged audio mix.*embedded fallback-video audio.*neither extracted nor mapped.*canonical project.*history.*persistence.*save state.*read-only and unmodified/iu,
	);
	assert.match(
		rule.currentBehavior,
		/export asserts project, task, and generation currentness.*before verification.*after verification.*exact selector.*after selected encoding.*owned signal.*output publication.*rechecks currentness.*cleanup.*refusal or cancellation.*no plan.*storage preflight.*audio render.*selected encoding.*output publication/iu,
	);

	assert.match(
		rule.currentBehavior,
		/Framescaper family-v1 same-family unknown-feature fixture.*managed whole-Blob handoff.*editable retained original.*manifest-only whole-project fallback/iu,
	);
	assert.match(
		rule.currentBehavior,
		/separate video-clip-render-v1 managed handoff fixture.*canonical target.*unaffected video.*manifest-only fallback.*fresh recipient.*exact target clip ID.*fallback body digest.*canonical shadow.*reopens.*relationship-bound integrity admission.*playback.*managed transfer.*descriptor and body digest.*not the manifest declaration/iu,
	);
	assert.match(
		rule.currentBehavior,
		/portable \.scape.*round-trips the relationship.*copy collision.*remaps the fallback source ID.*preserving the target clip ID.*corrupting.*after activation.*operation-time verification.*rejects delivery before selected encoding and output.*restoring.*reuses.*verified Blob.*canonical document.*unchanged/iu,
	);
	assert.match(
		rule.currentBehavior,
		/exact one-audio.one-video final-video composition.*qualified.*more than one qualifying video fallback.*multiple clip fallbacks.*other mixed fallback relationships.*unqualified.*noncanonical feature IDs.*unknown canonical feature identities qualify only for project-video-render-v1.*third-party feature-code activation.*future schemas.*earlier Soundscaper schemas.*linked-only or unmanaged delivery.*standalone audio.*simultaneous.*reject.*generic fallback authoring.*freeze.*unfreeze.*proxy.*relink.*embedded fallback-video audio.*nonselected fallback-body claim.*offline-render parity.*source\/component UI binding.*qualified at source level.*packaged runtime or UI activation, transport playback, and final-delivery workflows.*unqualified.*browser.*codec.*range transport.*reference-scale.*no durable storage-record or byte lease.*cross-process replacement.*whole-handoff atomicity/iu,
	);

	for (const reference of rule.evidence) {
		await assert.doesNotReject(access(new URL(`../${reference}`, import.meta.url)), reference);
	}
	for (const reference of [
		'src/common/editor/project-feature-video-rendered-fallback.ts',
		'src/common/editor/project-feature-video-clip-render-v1.ts',
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-fallback-integrity.ts',
		'src/common/editor/project-fallback-integrity-audio.ts',
		'src/common/editor/project-fallback-integrity-video.ts',
		'src/common/editor/controller/playback-project-service.ts',
		'src/common/editor/controller/audio-rendered-fallback-export.ts',
		'src/common/editor/controller/video-rendered-fallback-export.ts',
		'src/common/editor/controller/video-export-service.ts',
		'src/common/editor/controller/export-service.ts',
		'src/common/editor/controller/source-lifecycle-service.ts',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/controller/project-visual-service.ts',
		'src/common/editor/controller/document-snapshot.ts',
		'src/common/editor/ui/workspace/video-preview-visual.ts',
		'src/common/editor/ui/workspace/VideoPreviewPanel.jsx',
		'src/common/editor/ui/workspace/ProjectFeatureCompatibilityNotice.tsx',
		'tests/audio-editor-project-feature-video-rendered-fallback.test.ts',
		'tests/audio-editor-project-feature-video-clip-render-v1.test.ts',
		'tests/audio-editor-playback-project-service.test.ts',
		'tests/audio-editor-project-fallback-integrity-selection.test.ts',
		'tests/audio-editor-project-fallback-integrity-mixed-selection.test.ts',
		'tests/audio-editor-video-rendered-fallback-delivery-projection.test.ts',
		'tests/audio-editor-video-rendered-fallback-export.test.ts',
		'tests/audio-editor-mixed-rendered-fallback-video-export.test.ts',
		'tests/audio-editor-project-visual-service.test.ts',
		'tests/audio-editor-video-clip-fallback-export-regression.test.ts',
		'tests/audio-editor-project-switch-source-preparation.test.ts',
		'tests/audio-editor-project-switch-fallback-integrity.test.ts',
		'tests/audio-editor-video-preview-visual.test.ts',
		'tests/audio-editor-project-feature-compatibility-notice.test.ts',
		'tests/audio-editor-framescaper-baseline.test.ts',
		'tests/audio-editor-scape-video-clip-fallback-roundtrip.test.ts',
	]) assert.ok(rule.evidence.includes(reference), reference);

	const documentation = await readFile(documentationUrl, 'utf8');
	const normalizedDocumentation = documentation.replace(/\s+/gu, ' ');
	assert.match(
		normalizedDocumentation,
		/1\.0 family baselines.*schemaFamily: 'soundscaper'.*schemaVersion: 1.*schemaFamily: 'framescaper'.*schemaVersion: 1/isu,
	);
	assert.match(
		normalizedDocumentation,
		/project-video-render-v1.*video-clip-render-v1.*closed rendered-fallback roles/isu,
	);
	assert.match(
		normalizedDocumentation,
		/Version-bearing S21–S30, F18–F32.*implementation provenance.*old project, store, migration, and package identities are not supported/isu,
	);
});
