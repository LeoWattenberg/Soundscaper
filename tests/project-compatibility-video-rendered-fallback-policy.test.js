/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

test('compatibility policy qualifies only maintained first-party video-effects fallback playback and handoff', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-first-party-video-rendered-fallback-playback');
	assert.ok(rule);
	assert.equal(rule.status, 'implemented');
	assert.match(
		rule.requiredOutcome,
		/exact-current-schema.*registered first-party videoEffects.*rendered fallback.*editor playback.*canonical.*read-only.*unmodified/iu,
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
		/project-fallback-integrity.*separately verifies.*local body.*before activation side effects/iu,
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
		/not generic.*unknown.*third-party.*authors no freeze.*unfreeze.*proxy relationship.*future schemas.*browser codec.*packaged.*whole-video fallback audio.*export.*offline render/iu,
	);
	assert.match(
		rule.currentBehavior,
		/composed headless Framescaper-to-fresh-Soundscaper.*exact schema 9.*explicit managed whole-Blob.*editable retained original.*manifest-only.*video-effects fallback.*feature requirement.*two exact whole-Blob video bodies.*exact canonical shadow.*intrinsically read-only.*controller separately verifies.*manifest fallback digest.*after shadow publication.*before transient activation/iu,
	);
	assert.match(
		rule.currentBehavior,
		/headless and whole-Blob only.*does not qualify.*packaged.*browser codec.*embedded fallback audio.*range.*reference-scale.*export.*offline render.*fallback authoring.*generic.*third-party.*durable lease.*whole-handoff atomicity/iu,
	);

	for (const reference of rule.evidence) {
		await assert.doesNotReject(access(new URL(`../${reference}`, import.meta.url)), reference);
	}
	for (const reference of [
		'src/common/editor/project-feature-video-rendered-fallback.ts',
		'src/common/editor/project-fallback-integrity.ts',
		'src/common/editor/controller/playback-project-service.ts',
		'src/common/editor/controller/source-lifecycle-service.ts',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/controller/document-snapshot.ts',
		'src/common/editor/ui/workspace/video-preview-visual.ts',
		'src/common/editor/ui/workspace/VideoPreviewPanel.jsx',
		'src/common/editor/ui/workspace/ProjectFeatureCompatibilityNotice.tsx',
		'tests/audio-editor-project-feature-video-rendered-fallback.test.ts',
		'tests/audio-editor-playback-project-service.test.ts',
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
		/separate controller fallback-integrity\s+admission.*verifies.*actual local body.*before activation\s+side effects/isu,
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
		/not.*generic.*unknown.*third-party.*authors no freeze.*unfreeze.*proxy relationship.*future-schema.*browser-codec.*packaged.*whole-video fallback audio.*export.*offline-render/isu,
	);
	assert.match(
		documentation,
		/composed headless Framescaper-to-fresh-Soundscaper.*exact schema 9.*editable retained original.*manifest-only\s+first-party video-effects fallback.*feature requirement.*explicit managed whole-`Blob` transfer.*two exact video bodies.*exact canonical shadow.*intrinsically read-only.*separately verifies.*manifest fallback digest.*after shadow publication.*before transient activation/isu,
	);
	assert.match(
		documentation,
		/headless, whole-`Blob` evidence.*does not qualify packaged or browser-codec\s+behavior.*embedded fallback audio.*range.*reference-scale.*export.*offline render.*fallback authoring.*generic or third-party fallbacks.*durable\s+byte lease.*whole-handoff atomicity/isu,
	);
});
