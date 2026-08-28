/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

test('audio-warp policy records native Soundscaper and read-only Framescaper truth', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-audio-warp-capability');
	assert.ok(rule);
	assert.equal(rule.status, 'implemented');
	assert.match(
		rule.requiredOutcome,
		/exact owning-family v1 audio warp state.*timeline and Project Bin audio clips.*closed, bounded, strictly increasing.*clip-authority-validated/iu,
	);
	assert.match(
		rule.requiredOutcome,
		/bypass-only no-fallback.*native and writable in Soundscaper.*known unavailable and read-only in Framescaper.*publisher substitution.*audio or video rendered fallback reject.*playback.*waveform projection.*trim.*split.*export.*same exact map semantics/iu,
	);
	assert.match(
		rule.currentBehavior,
		/2 through 4,096.*canonical reduced rational.*strictly increasing.*forward mode only/iu,
	);
	assert.match(
		rule.currentBehavior,
		/outer endpoints.*clip anchor extent.*source endpoints.*clip source extent/iu,
	);
	assert.match(
		rule.currentBehavior,
		/sample-anchored.*musical.*beat extent.*reversed.*reject/iu,
	);
	assert.match(
		rule.currentBehavior,
		/soundscaper\.audio-warp.*org\.soundscaper\.capability\.audio-warp.*Audio warp maps.*bypass.*fallback null.*empty state invents no requirement.*refuses publisher substitution/iu,
	);
	assert.match(
		rule.currentBehavior,
		/true in Soundscaper.*production capability register.*available\/native.*compatible.*false but registered in Framescaper.*unavailable\/bypassed.*incompatible.*intrinsically read-only/iu,
	);
	assert.match(
		rule.currentBehavior,
		/excluded from both audio and video rendered-fallback.*publisher-authored substitution or rendered fallback.*rejects/iu,
	);
	assert.match(
		rule.currentBehavior,
		/full-source PCM SHA-256 digest.*source range.*channel policy.*analysis parameters.*algorithm revision.*disposable derived analysis cache.*never project JSON.*payload SHA-256.*bounded transient array.*corrupt or stale.*discarded.*aggregate count, useful-byte, and age LRU retention.*not a bound on the project document.*no transient-analysis array/iu,
	);
	assert.match(
		rule.currentBehavior,
		/missing digest.*full canonical source.*storage-generation checks.*range reading.*bounded before allocation.*intersecting generation-bound chunks.*no authoritative digest-to-source index.*source deletion and retention pruning.*purge the whole transient.*namespaces.*cache state never roots pruning.*unrelated analysis survives.*cleanup fault cannot roll back or reject authoritative source deletion/iu,
	);
	assert.match(
		rule.currentBehavior,
		/exact map algebra and its evaluator drive playback.*waveform projection.*trim.*split.*exact offline fallback.*export.*never substitutes scalar output-length conversion.*source-position endpoints.*piecewise linear projection/iu,
	);
	assert.match(
		rule.currentBehavior,
		/nonidentity production-path browser fixture.*PCM parity.*0\.000001 signal-error budget.*Chromium and Firefox/iu,
	);
	assert.match(
		rule.currentBehavior,
		/bounded exact fallback.*effect-free stateless dry, gain, pan, mute, envelope, and fade path.*enabled processor.*track, bus, send, or master rack.*rejects before render.*current window and exactly one window ahead.*missed deadline stops playback.*never time-shifts.*gapless playback is not guaranteed/iu,
	);
	assert.match(
		rule.currentBehavior,
		/Soundscaper exposes.*only through the Effect.*Pitch and tempo menu.*selected unlocked audio clip.*analy[sz]e.*identity-map.*add.*move.*delete.*quantize.*groove.*clear.*keyboard.*screen-reader.*forced colors.*Framescaper exposes no audio-warp menu or surface/iu,
	);

	const evidence = new Set(rule.evidence);
	for (const path of [
		'src/common/editor/audio-warp-domain.ts',
		'src/common/editor/audio-warp-clip-authority.ts',
		'src/common/editor/audio-warp-runtime.ts',
		'src/common/editor/audio-warp-render-parity.ts',
		'src/soundscaper/editor-project-validation.ts',
		'src/common/editor/runtime-clip-projection.ts',
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-owned-feature-requirements.ts',
		'src/common/editor/transient-analysis.ts',
		'src/common/editor/storage/transient-analysis-cache.ts',
		'src/common/editor/controller/transient-analysis-service.ts',
		'src/common/editor/controller/transient-analysis-pcm-access.ts',
		'src/common/editor/controller/audio-warp-authoring-service.ts',
		'src/common/editor/controller/audio-warp-composition.ts',
		'src/common/editor/commands/project-source-bin-runtime.js',
		'src/common/editor/engine/audio-warp-fallback.ts',
		'src/common/editor/engine/audio-warp-playback-scheduler.ts',
		'src/common/editor/ui/audio-warp-application-menu.ts',
		'src/common/editor/ui/dialogs/AudioWarpDialog.tsx',
		'src/soundscaper/product.js',
		'src/framescaper/product.js',
		'config/production-capabilities.json',
		'tests/audio-editor-audio-warp-domain.test.ts',
		'tests/audio-editor-audio-warp-authoring.test.ts',
		'tests/audio-editor-audio-warp-runtime.test.ts',
		'tests/audio-editor-soundscaper-baseline.test.ts',
		'tests/audio-editor-project-bin-service.test.ts',
		'tests/audio-editor-audio-warp-pcm-parity.test.ts',
		'tests/audio-editor-audio-warp-engine-status.test.ts',
		'tests/audio-editor-project-owned-feature-requirements.test.ts',
		'tests/audio-editor-project-feature-audio-rendered-fallback.test.ts',
		'tests/audio-editor-transient-analysis.test.ts',
		'tests/audio-editor-transient-analysis-pcm-access.test.ts',
		'tests/audio-editor-audio-warp-controller-composition.test.ts',
		'tests/audio-editor-audio-warp-ui.test.tsx',
		'tests/audio-editor-scape-audio-warp-roundtrip.test.ts',
		'tests/audio-editor-soundscaper-baseline.test.ts',
		'tests/audio-editor-audio-warp-export-service.test.ts',
		'tests/browser/audio-editor-audio-warp.spec.js',
	]) assert.equal(evidence.has(path), true, path);

	const documentation = (await readFile(documentationUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.match(documentation, /policy-narrative:audio-warp-capability/iu);
	assert.match(documentation, /Soundscaper.*available\/native.*Framescaper.*unavailable\/bypassed.*intrinsically read-only/iu);
	assert.match(documentation, /excluded from both audio and video rendered-fallback.*publisher-authored substitution or rendered fallback.*rejects/iu);
});
