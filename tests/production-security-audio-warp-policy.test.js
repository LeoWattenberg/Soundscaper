/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('audio-warp project admission refuses semantic substitution and rendered fallback', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'external-project-document-validation');
	const control = risk?.currentControls.find(
		({ id }) => id === 'audio-warp-native-and-cross-product-admission',
	);
	assert.ok(control);
	assert.match(
		control.summary,
		/exact schema 17.*timeline and Project Bin.*2 through 4,096.*strictly increasing.*canonical reduced rational.*outer endpoints.*anchor extent.*source endpoints.*source extent.*forward mode only.*reversed clips.*reject/iu,
	);
	assert.match(
		control.summary,
		/`soundscaper\.audio-warp`.*`org\.soundscaper\.capability\.audio-warp`.*`bypass`.*no fallback.*refuses publisher substitution.*excluded from audio and video rendered-fallback/iu,
	);
	assert.match(
		control.summary,
		/Soundscaper.*true.*available\/native.*writable.*Framescaper.*false but known.*unavailable\/bypassed.*intrinsically read-only.*no audio-warp menu/iu,
	);
	assert.match(
		control.summary,
		/exact map evaluator.*playback.*waveform projection.*trim.*split.*export.*no scalar output-length substitution.*realtime scheduler.*exact offline path.*source-position endpoints.*piecewise linear projection/iu,
	);
	assert.match(
		control.summary,
		/nonidentity production playback fixture.*actual output across all frames.*0\.000001 PCM signal-error budget.*Chromium and Firefox/iu,
	);
	assertEvidence(control, [
		'src/common/editor/audio-warp-domain.ts',
		'src/common/editor/audio-warp-clip-authority.ts',
		'src/common/editor/audio-warp-runtime.ts',
		'src/common/editor/audio-warp-render-parity.ts',
		'src/common/editor/project-v17-validation.ts',
		'src/common/editor/runtime-clip-projection.ts',
		'src/common/editor/project-owned-feature-requirements.ts',
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/engine/audio-warp-fallback.ts',
		'src/soundscaper/product.js',
		'src/framescaper/product.js',
		'tests/audio-editor-foundation-feature-registration.test.ts',
		'tests/audio-editor-project-v17.test.ts',
		'tests/audio-editor-project-bin-service.test.ts',
		'tests/audio-editor-project-owned-feature-requirements.test.ts',
		'tests/audio-editor-project-feature-audio-rendered-fallback.test.ts',
		'tests/audio-editor-audio-warp-runtime.test.ts',
		'tests/audio-editor-audio-warp-pcm-parity.test.ts',
		'tests/audio-editor-scape-audio-warp-roundtrip.test.ts',
		'tests/desktop-project-library-audio-warp-handoff.test.ts',
		'tests/audio-editor-audio-warp-export-service.test.ts',
		'tests/browser/audio-editor-audio-warp.spec.js',
	]);
});

test('transient analysis has pre-allocation, authority, cancellation, and cache-integrity controls', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'long-job-cancellation');
	const control = risk?.currentControls.find(
		({ id }) => id === 'bounded-audio-warp-transient-analysis',
	);
	assert.ok(control);
	assert.match(
		control.summary,
		/one non-raiseable 256 MiB useful-numeric-payload admission model.*aggregate phased residency/iu,
	);
	assert.match(
		control.summary,
		/before exact range allocation.*planar range PCM.*larger of one decoded source chunk.*three window-count Float64 arrays.*two useful-numeric generations.*candidate\/result/iu,
	);
	assert.match(
		control.summary,
		/rechecks actual worker input before worker creation.*1 through 32 channels.*1,000,000 windows.*lower-only/iu,
	);
	assert.match(
		control.summary,
		/exact-span.*unique ArrayBuffer ownership.*transfers.*dedicated worker.*no controller-to-worker PCM copy.*borrowed direct-helper path.*two PCM copies/iu,
	);
	assert.match(
		control.summary,
		/codec internals.*structured-clone.*message objects.*JavaScript object overhead.*garbage-collection headroom.*process RSS.*excluded.*neither a browser-heap nor product-wide reservation/iu,
	);
	assert.match(
		control.summary,
		/full canonical PCM source.*storage-generation checks.*source digest.*source range.*channel policy.*parameters.*algorithm revision.*random-access.*exact-generation chunks.*AbortSignal cancellation terminates.*worker/iu,
	);
	assert.match(
		control.summary,
		/disposable derived analysis cache.*never project JSON.*useful payload byte length.*payload SHA-256.*bounded transient array.*stale or corrupt.*deleted.*aggregate 512 MiB useful-payload, 4,095-entry, and 30-day age limits.*access LRU.*cache serialization and storage clones.*not included.*256 MiB detector admission/iu,
	);
	assert.match(
		control.summary,
		/no authoritative digest-to-source index.*source deletion and retention pruning.*purge the whole transient.*namespaces.*cache state never roots source pruning.*unrelated analysis is preserved.*cache-cleanup fault.*cannot roll back or reject.*source deletion/iu,
	);
	assertEvidence(control, [
		'src/common/editor/transient-analysis.ts',
		'src/common/editor/transient-analysis-worker-client.ts',
		'src/common/editor/storage/transient-analysis-cache.ts',
		'src/common/editor/storage/transient-analysis-cache-repository.ts',
		'src/common/editor/storage/derivative-cache-policy.ts',
		'src/common/editor/storage/source-repository.ts',
		'src/common/editor/storage/retention-repository.ts',
		'src/common/editor/controller/transient-analysis-service.ts',
		'src/common/editor/controller/transient-analysis-pcm-access.ts',
		'tests/audio-editor-transient-analysis.test.ts',
		'tests/audio-editor-transient-analysis-worker.test.ts',
		'tests/audio-editor-transient-analysis-service.test.ts',
		'tests/audio-editor-transient-analysis-pcm-access.test.ts',
		'tests/audio-editor-transient-analysis-cache-lifecycle.test.ts',
	]);
});

test('exact audio-warp fallback owns bounded playback and sequential export windows', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'long-job-cancellation');
	const control = risk?.currentControls.find(
		({ id }) => id === 'bounded-audio-warp-exact-window-rendering',
	);
	assert.ok(control);
	assert.match(
		control.summary,
		/32 MiB useful-planar-PCM ceiling.*five-second duration ceiling.*1 through 32 channels.*graph latency.*pre-roll.*final tail.*OfflineAudioContext output.*crop.*playback AudioBuffer copy.*sink-packet copy.*before OfflineAudioContext work.*project\/map authority fingerprint/iu,
	);
	assert.match(
		control.summary,
		/sequential export.*project sample rate.*one bounded window at a time.*128 through 16,384-frame packets.*awaits every sink packet.*zero pre-roll.*scalar output-length substitution rejects/iu,
	);
	assert.match(
		control.summary,
		/stateless dry, gain, pan, mute.*envelope.*clip-fade path.*enabled non-bypassed processor.*track, group, send, or master rack.*opaque processor.*rejects before render.*state reset.*exact parity/iu,
	);
	assert.match(
		control.summary,
		/next window.*requested audio-clock boundary.*missed deadline.*stops playback.*never shifts.*gapless playback is not guaranteed/iu,
	);
	assert.match(
		control.summary,
		/exactly the current and one prefetched window.*64 MiB aggregate.*cleanup.*before the window after next.*future AudioBufferSource windows are not retained/iu,
	);
	assert.match(
		control.summary,
		/central 256 MiB offline-output admission.*exact OfflineAudioContext geometry.*AbortSignal.*project\/map fingerprint.*reject.*software or injected renderer.*outside/iu,
	);
	assertEvidence(control, [
		'src/common/editor/engine/audio-warp-fallback.ts',
		'src/common/editor/engine/audio-warp-playback-scheduler.ts',
		'src/common/editor/engine/offline-render-admission.ts',
		'src/common/editor/engine/rendering.ts',
		'src/common/editor/engine/transport-control.ts',
		'src/common/editor/engine/transport-scheduler.ts',
		'src/common/editor/pcm-sink-admission.ts',
		'tests/audio-editor-audio-warp-engine-status.test.ts',
		'tests/audio-editor-offline-render-admission.test.ts',
	]);

	const threatModel = (await readFile(threatModelUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.match(threatModel, /policy-narrative:audio-warp-native-and-cross-product-admission/iu);
	assert.match(threatModel, /policy-narrative:bounded-audio-warp-transient-analysis/iu);
	assert.match(threatModel, /policy-narrative:bounded-audio-warp-exact-window-rendering/iu);
	assert.match(threatModel, /not browser heap.*process RSS.*GC headroom.*product-wide reservation/iu);
});

function assertEvidence(control, paths) {
	const evidence = new Set(control.evidence.map(({ path }) => path));
	for (const path of paths) assert.equal(evidence.has(path), true, path);
}
