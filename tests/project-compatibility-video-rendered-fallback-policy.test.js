/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

test('compatibility policy qualifies only maintained first-party video-effects fallback playback, delivery, and handoff', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-first-party-video-rendered-fallback-playback');
	assert.ok(rule);
	assert.equal(rule.status, 'implemented');
	assert.match(
		rule.requiredOutcome,
		/exact-current-schema.*registered first-party videoEffects.*rendered fallback.*editor playback.*maintained video export.*selector-bound operation-time admission.*export signal.*exact canonical native Blob.*size-checks and hashes.*direct immutable-byte reuse.*canonical.*read-only.*unmodified/iu,
	);
	assert.match(
		rule.requiredOutcome,
		/explicit managed desktop handoff.*Framescaper.*fresh Soundscaper.*manifest-only fallback.*editable original.*exact canonical shadow.*controller.*digest.*before activation/iu,
	);
	assert.match(
		rule.currentBehavior,
		/authoritative.*exact schema 9.*exactly one registered videoEffects.*unavailable.*declared and effective rendered-fallback.*video descriptor.*canonical manifest.*source ID.*SHA-256/iu,
	);
	assert.match(
		rule.currentBehavior,
		/project-fallback-integrity.*separately verifies.*local body.*before activation side effects.*video export.*exact selector.*requirement ID.*feature ID.*video kind.*source ID.*SHA-256.*operation-time.*export task signal/iu,
	);
	assert.match(
		rule.currentBehavior,
		/selector-mode verification.*only.*active video body.*not.*unrelated inactive audio.*nonselected fallback body.*size-checks and hashes.*canonical native Blob.*retains.*exact immutable Blob.*before.*plan.*storage preflight.*audio.*FFmpeg.*output/iu,
	);
	assert.match(
		rule.currentBehavior,
		/exact video kind.*project sample rate.*positive.*frame count.*width.*height.*frame rate.*reserved synthetic track.*clip.*collision/iu,
	);
	assert.match(
		rule.currentBehavior,
		/transient projection.*replaces.*timeline video clips and tracks.*one neutral.*full source.*frame zero.*preserv(?:es|ing).*audio.*label.*Project Bin.*sources.*canonical project.*history/iu,
	);
	assert.match(
		rule.currentBehavior,
		/manifest-only.*required video source.*activated before.*engine.*preview.*transient preview project.*source-level.*exact visual/iu,
	);
	assert.match(
		rule.currentBehavior,
		/deeply frozen.*per-tab.*document-snapshot metadata.*localized.*active during editor playback.*source ID or digest/iu,
	);
	assert.match(
		rule.currentBehavior,
		/video delivery.*only.*video rendered fallback.*does not compose.*audio rendered fallback.*bypass.*simultaneous rendered fallback.*reject/iu,
	);
	assert.match(
		rule.currentBehavior,
		/exact admitted Blob.*only video input.*canonical.*audio.*separate.*staged.*mix.*embedded.*fallback.*audio.*neither.*extract.*nor.*map/iu,
	);
	assert.match(
		rule.currentBehavior,
		/canonical project.*history.*persistence.*save.*read-only.*unmodified.*project.*currentness.*before.*verification.*after.*verification.*exact selector.*after FFmpeg.*owned signal.*publication.*rechecks.*cleanup/iu,
	);
	assert.match(
		rule.currentBehavior,
		/composed headless Framescaper-to-fresh-Soundscaper.*exact schema 9.*explicit managed whole-Blob.*editable retained original.*manifest-only.*video-effects fallback.*feature requirement.*two exact whole-Blob video bodies.*exact canonical shadow.*intrinsically read-only.*controller separately verifies.*manifest fallback digest.*after shadow publication.*before transient activation/iu,
	);
	assert.match(
		rule.currentBehavior,
		/corrupt.*after activation.*operation-time.*reject.*before.*FFmpeg.*output.*restor.*exact body.*directly reuses.*verified Blob.*only video input.*canonical.*unchanged/iu,
	);
	assert.match(
		rule.currentBehavior,
		/not generic.*unknown.*third-party.*authors no freeze.*unfreeze.*proxy relationship.*future schemas.*linked-only.*unmanaged.*simultaneous.*embedded.*audio.*range.*reference-scale.*codec.*browser.*packaged.*durable storage-record or byte lease.*cross-process replacement.*nonselected fallback-body.*broad.*parity/iu,
	);

	for (const reference of rule.evidence) {
		await assert.doesNotReject(access(new URL(`../${reference}`, import.meta.url)), reference);
	}
	for (const reference of [
		'src/common/editor/project-feature-video-rendered-fallback.ts',
		'src/common/editor/project-fallback-integrity.ts',
		'src/common/editor/project-fallback-integrity-video.ts',
		'src/common/editor/controller/playback-project-service.ts',
		'src/common/editor/controller/video-rendered-fallback-export.ts',
		'src/common/editor/controller/export-service.ts',
		'src/common/editor/controller/source-lifecycle-service.ts',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/controller/document-snapshot.ts',
		'src/common/editor/ui/workspace/video-preview-visual.ts',
		'src/common/editor/ui/workspace/VideoPreviewPanel.jsx',
		'src/common/editor/ui/workspace/ProjectFeatureCompatibilityNotice.tsx',
		'tests/audio-editor-project-feature-video-rendered-fallback.test.ts',
		'tests/audio-editor-playback-project-service.test.ts',
		'tests/audio-editor-project-fallback-integrity-selection.test.ts',
		'tests/audio-editor-video-rendered-fallback-delivery-projection.test.ts',
		'tests/audio-editor-video-rendered-fallback-export.test.ts',
		'tests/audio-editor-project-switch-source-preparation.test.ts',
		'tests/audio-editor-project-switch-fallback-integrity.test.ts',
		'tests/audio-editor-video-preview-visual.test.ts',
		'tests/audio-editor-project-feature-compatibility-notice.test.ts',
		'tests/desktop-project-library-video-rendered-fallback-handoff.test.ts',
	]) assert.ok(rule.evidence.includes(reference), reference);

	const documentation = await readFile(documentationUrl, 'utf8');
	assert.match(
		documentation,
		/exact schema 9 first-party video-effects rendered fallback.*exactly one.*registered `videoEffects`.*unavailable.*declared and effective.*canonical manifest.*video kind.*source ID.*SHA-256/isu,
	);
	assert.match(
		documentation,
		/separate controller\s+fallback-integrity\s+admission.*verifies.*actual local body.*before activation\s+side effects.*video delivery.*selector.*requirement ID.*feature ID.*video kind.*source ID.*SHA-256.*operation-time.*selected local body.*export-task signal/isu,
	);
	assert.match(
		documentation,
		/size-checks and hashes.*canonical native `Blob`.*retains.*exact\s+immutable `Blob`.*does not read or admit nonselected fallback\s+bodies.*before.*video plan.*storage preflight.*audio.*FFmpeg.*output/isu,
	);
	assert.match(
		documentation,
		/exact video kind.*project sample\s+rate.*positive safe.*frame count.*width.*height.*positive finite.*frame rate.*reserved\s+synthetic.*track and clip.*collision/isu,
	);
	assert.match(
		documentation,
		/transient projection.*replaces.*timeline video clips\s+and tracks.*one neutral.*full source.*frame zero.*audio and label.*Project Bin.*sources.*canonical project.*history.*unmodified/isu,
	);
	assert.match(
		documentation,
		/manifest-only.*required video source.*activated\s+before.*engine.*preview.*transient project.*source-level.*exact visual/isu,
	);
	assert.match(
		documentation,
		/deeply frozen.*per-tab.*document-snapshot\s+metadata.*localized.*active-during-editor-playback.*source ID or digest/isu,
	);
	assert.match(
		documentation,
		/video-delivery projection.*only.*video rendered.*fallback.*does not compose.*audio rendered.*fallback.*bypass.*simultaneous rendered fallback.*reject/isu,
	);
	assert.match(
		documentation,
		/exact size- and digest-verified native `Blob`.*only video input.*no second fallback storage read.*canonical.*audio.*separate.*staged.*mix.*embedded.*fallback.*audio.*not extracted or mapped/isu,
	);
	assert.match(
		documentation,
		/canonical project.*history.*persistence.*save.*read-only.*unmodified.*project.*currentness.*before.*verification.*after.*verification.*after.*FFmpeg.*owned signal.*publication.*rechecks.*cleanup/isu,
	);
	assert.match(
		documentation,
		/composed headless Framescaper-to-fresh-Soundscaper.*exact schema 9.*editable retained original.*manifest-only\s+first-party video-effects fallback.*feature requirement.*explicit managed whole-`Blob` transfer.*two exact video bodies.*exact canonical shadow.*intrinsically read-only.*separately verifies.*manifest fallback digest.*after shadow publication.*before transient activation/isu,
	);
	assert.match(
		documentation,
		/corrupt.*after activation.*operation-time.*reject.*before.*FFmpeg.*output.*restor.*exact body.*exact immutable `Blob`.*reuses directly.*only video input.*storage lookup.*canonical.*unchanged/isu,
	);
	assert.match(
		documentation,
		/not.*generic.*unknown.*third-party.*freeze.*unfreeze.*proxy.*future-schema.*linked-only.*unmanaged.*simultaneous.*embedded.*audio.*range.*reference-scale.*codec.*browser.*packaged.*durable.*lease.*broad.*parity/isu,
	);
	assert.match(documentation, /no durable storage-record lease.*cross-process replacement.*nonselected fallback-body guarantee/isu);
});
