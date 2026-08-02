/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const budgetsUrl = new URL('../config/quality-budgets.json', import.meta.url);

const FORMAT_CONTRACTS = Object.freeze([
	{ id: 'mp3', extension: '.mp3', mimeType: 'audio/mpeg', pickerMimeType: 'audio/mpeg' },
	{ id: 'flac', extension: '.flac', mimeType: 'audio/flac', pickerMimeType: 'audio/flac' },
	{ id: 'ogg-vorbis', extension: '.ogg', mimeType: 'audio/ogg; codecs=vorbis', pickerMimeType: 'audio/ogg' },
	{ id: 'opus', extension: '.opus', mimeType: 'audio/ogg; codecs=opus', pickerMimeType: 'audio/ogg' },
	{ id: 'wavpack', extension: '.wv', mimeType: 'audio/x-wavpack', pickerMimeType: 'audio/x-wavpack' },
	{ id: 'mp2', extension: '.mp2', mimeType: 'audio/mpeg', pickerMimeType: 'audio/mpeg' },
	{ id: 'aac-m4a', extension: '.m4a', mimeType: 'audio/mp4', pickerMimeType: 'audio/mp4' },
]);
const FORMAT_IDS = Object.freeze(FORMAT_CONTRACTS.map(({ id }) => id));

test('exact direct compressed publication has narrow capability and rollback controls', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const publication = findControl(
		matrix,
		'desktop-write-path-capabilities',
		'exact-direct-compressed-mix-save',
	);
	const rollback = findControl(
		matrix,
		'long-job-cancellation',
		'direct-compressed-mix-save-rollback',
	);
	assert.equal(findOptionalControl(matrix, 'exact-direct-realtime-compressed-mix-save'), null);
	assert.equal(findOptionalControl(matrix, 'direct-realtime-compressed-mix-save-rollback'), null);
	assert.equal(findOptionalControl(matrix, 'exact-direct-realtime-mp3-mix-save'), null);
	assert.equal(findOptionalControl(matrix, 'direct-realtime-mp3-mix-save-rollback'), null);

	for (const path of [
		'patches/npm/@ffmpeg+ffmpeg+0.12.15.patch',
		'src/common/editor/media-export.js',
		'src/common/editor/export.js',
		'src/common/editor/ffmpeg-output-stream.ts',
		'src/common/editor/ffmpeg.js',
		'src/common/editor/controller/direct-audio-render-plan.ts',
		'src/common/editor/controller/direct-compressed-plan.ts',
		'src/common/editor/controller/direct-compressed-export.ts',
		'src/common/editor/controller/direct-offline-compressed-export.ts',
		'src/common/editor/controller/rendered-audio-encoding.ts',
		'src/common/editor/controller/audio-export-render-orchestration.ts',
		'src/common/editor/controller/export-service.ts',
		'src/common/editor/file-save-stream.ts',
		'tests/audio-editor-media-export.test.js',
		'tests/audio-editor-ffmpeg-output-range-patch.test.js',
		'tests/audio-editor-ffmpeg-output-stream.test.ts',
		'tests/audio-editor-ffmpeg-idle.test.js',
		'tests/audio-editor-direct-audio-render-plan.test.ts',
		'tests/audio-editor-direct-offline-compressed-export.test.ts',
		'tests/audio-editor-export-direct-compressed-matrix.test.ts',
		'tests/audio-editor-export-direct-compressed-service.test.ts',
		'tests/audio-editor-rendered-direct-offline-compressed.test.ts',
		'tests/audio-editor-export-direct-offline-compressed-service.test.ts',
		'tests/audio-editor-export-direct-offline-compressed-fallback.test.ts',
		'tests/audio-editor-export-direct-mp3.test.ts',
	]) {
		assert.ok(publication.evidence.some((item) => item.path === path), path);
		await access(new URL(`../${path}`, import.meta.url));
	}
	for (const path of [
		'src/common/editor/ffmpeg-output-stream.ts',
		'src/common/editor/ffmpeg.js',
		'src/common/editor/controller/direct-audio-render-plan.ts',
		'src/common/editor/controller/direct-compressed-plan.ts',
		'src/common/editor/controller/direct-compressed-export.ts',
		'src/common/editor/controller/direct-offline-compressed-export.ts',
		'src/common/editor/controller/rendered-audio-encoding.ts',
		'src/common/editor/controller/audio-export-render-orchestration.ts',
		'src/common/editor/controller/export-service.ts',
		'tests/audio-editor-ffmpeg-output-stream.test.ts',
		'tests/audio-editor-ffmpeg-idle.test.js',
		'tests/audio-editor-direct-audio-render-plan.test.ts',
		'tests/audio-editor-direct-offline-compressed-export.test.ts',
		'tests/audio-editor-export-direct-compressed-matrix.test.ts',
		'tests/audio-editor-export-direct-compressed-service.test.ts',
		'tests/audio-editor-rendered-direct-offline-compressed.test.ts',
		'tests/audio-editor-export-direct-offline-compressed-service.test.ts',
		'tests/audio-editor-export-direct-offline-compressed-fallback.test.ts',
		'tests/audio-editor-export-direct-mp3.test.ts',
	]) assert.ok(rollback.evidence.some((item) => item.path === path), path);

	assert.match(
		publication.summary,
		/direct compressed.*one mix.*`mp3`.*`flac`.*`ogg-vorbis`.*`opus`.*`wavpack`.*`mp2`.*`aac-m4a`.*FFmpeg/isu,
	);
	assert.match(
		publication.summary,
		/codec-qualified.*Ogg.*picker.*base `audio\/ogg`.*MP3 and MP2.*`audio\/mpeg`.*format.*extension/isu,
	);
	assert.match(
		publication.summary,
		/realtime-stream.*map.*before.*staging.*FFmpeg.*preserve.*offline.*unmapped.*input-width.*FFmpeg.*mapping.*exactly once/isu,
	);
	assert.match(
		publication.summary,
		/centrally admitted offline.*256 MiB.*context.*crop.*not.*end-to-end/isu,
	);
	assert.match(
		publication.summary,
		/FLAC.*integer WAV.*staging encoder.*dither.*non-FLAC.*Float32 WAV.*FFmpeg dither.*sample format.*not `float32`.*dither.*not `none`/isu,
	);
	assert.match(
		publication.summary,
		/offline.*preflight.*maximum.*required temporary.*raw staging PCM payload.*input channel.*excludes.*WAV framing.*padding/isu,
	);
	assert.match(
		publication.summary,
		/selects.*target before render.*after FFmpeg.*stat.*open.*exact-size writer.*ordinary offline renderer failure.*same unopened target.*Prepared Blob mode.*legacy.*final-Blob.*download/isu,
	);
	assert.match(
		publication.summary,
		/WORKERFS.*worker MEMFS.*at most one MiB.*one read and one.*write.*backpressure.*never.*whole-file `readFile`.*stat.*emitted.*destination-written.*committed-result/isu,
	);
	assert.match(
		publication.summary,
		/269,484,049-byte.*258.*transport arithmetic and backpressure only.*not.*codec execution.*reference-scale/isu,
	);
	assert.match(
		publication.summary,
		/custom FFmpeg.*stems.*video.*browser.*operating-system.*native picker.*packaged.*worker MEMFS.*native or WASM.*heap.*RSS.*unqualified/isu,
	);
	assert.match(
		rollback.summary,
		/synchronous WAV construction.*cannot be interrupted.*checks.*before and after.*ordinary offline renderer failure.*reuse.*unopened.*post-render.*never retry/isu,
	);
	assert.match(
		rollback.summary,
		/cancellation during FFmpeg execution.*terminates.*runtime.*before commit aborts.*unpublished destination.*exactly once.*abort fails synchronously.*AggregateError/isu,
	);
	assert.match(
		rollback.summary,
		/MEMFS output delete.*WORKERFS unmount.*mount-directory delete.*cleanup failure.*terminates.*runtime.*observable/isu,
	);
	assert.match(
		rollback.summary,
		/non-cancellable commit.*ownership.*committed result.*without stale success UI.*committed-result size.*post-publication integrity failure.*not rollback/isu,
	);
});

test('the direct compressed fixture records both render strategies without memory or scale claims', async () => {
	const budgets = JSON.parse(await readFile(budgetsUrl, 'utf8'));
	const fixture = budgets.fixtures.find(({ id }) => id === 'm2-direct-compressed-output-v2');
	assert.ok(fixture);
	assert.equal(budgets.fixtures.some(({ id }) => id === 'm2-direct-realtime-compressed-output-v1'), false);
	assert.equal(budgets.fixtures.some(({ id }) => id === 'm2-direct-realtime-mp3-output-v1'), false);
	assert.equal(fixture.status, 'provisional');
	assert.equal(fixture.kind, 'deterministic-direct-compressed-node-transport-witness');
	assert.deepEqual(fixture.milestones, ['2']);
	assert.equal(fixture.specification.generatorRevision, 3);
	assert.deepEqual(fixture.specification.admittedModes, [
		'realtime-single-mix-canonical-compressed-audio',
		'centrally-admitted-offline-single-mix-canonical-compressed-audio',
	]);
	assert.deepEqual(fixture.specification.admittedRenderStrategies, ['realtime-stream', 'offline']);
	assert.deepEqual(fixture.specification.admittedFormats, FORMAT_IDS);
	assert.deepEqual(fixture.specification.admittedFormatContracts, FORMAT_CONTRACTS);
	assert.deepEqual(fixture.specification.serviceDirectFormats, FORMAT_IDS);
	assert.equal(fixture.specification.allFormatsRealtimeServiceDirectRouteVerified, true);
	assert.equal(fixture.specification.allFormatsOfflineServiceDirectRouteVerified, true);
	assert.equal(fixture.specification.centralOfflineAdmissionRecomputed, true);
	assert.equal(fixture.specification.offlineCentralUsefulBinaryAdmissionCeilingBytes, 256 * 1024 ** 2);
	assert.equal(fixture.specification.offlineInputWidthStagingVerified, true);
	assert.equal(fixture.specification.offlineResampleBeforeStagingVerified, true);
	assert.equal(fixture.specification.realtimeChannelMappingOwner, 'pre-staging-pcm-transform');
	assert.equal(fixture.specification.offlineChannelMappingOwner, 'ffmpeg');
	assert.equal(fixture.specification.channelMappingApplicationsPerRoute, 1);
	assert.equal(fixture.specification.ordinaryOfflineRendererFailureReusesUnopenedDestination, true);
	assert.equal(fixture.specification.directOfflinePostRenderRealtimeRetry, false);
	assert.equal(fixture.specification.privateRenderedFallbackDirectOfflineVerified, true);
	assert.equal(fixture.specification.flacIntegerStagingDitherOwnershipVerified, true);
	assert.equal(fixture.specification.wavpackIntegerAndFloatDitherOwnershipVerified, true);
	assert.equal(fixture.specification.otherCompressedFloatStagingVerified, true);
	assert.equal(fixture.specification.preparedDestinationMode, 'exact-size-stream');
	assert.equal(fixture.specification.stagingInputMode, 'WORKERFS-mounted-WAV-Blob');
	assert.equal(fixture.specification.codecOutputMode, 'worker-MEMFS');
	assert.equal(fixture.specification.maximumOutputRangeBytes, 1_048_576);
	assert.equal(fixture.specification.virtualTransportByteLength, 269_484_049);
	assert.equal(fixture.specification.virtualTransportChunkCount, 258);
	assert.equal(fixture.specification.maximumConcurrentRangeReads, 1);
	assert.equal(fixture.specification.maximumConcurrentSinkWrites, 1);
	assert.equal(fixture.specification.wholeOutputReadFileCalls, 0);
	assert.equal(fixture.specification.representativeMp3PlannerAdmissionFrames, 33_685_504);
	assert.equal(fixture.specification.representativeMp3PlannerAdmissionStagingBytes, 269_484_032);
	assert.equal(fixture.specification.representativeMp3PlannerAdmissionReason, 'offline-render-output-memory');
	assert.equal(fixture.specification.realtimeServiceStagingPreflightBytes, 8);
	assert.equal(fixture.specification.offlineServiceStagingPreflightBytes, 32);
	assert.equal(fixture.specification.offlineStagingPayloadIncludesWavFraming, false);
	assert.equal(fixture.specification.realtimeServiceEncodedOutputBytes, 5);
	assert.equal(fixture.specification.realtimeServiceEncodedOutputChunks, 2);
	assert.equal(fixture.specification.offlineServiceEncodedOutputBytes, 5);
	assert.equal(fixture.specification.offlineServiceEncodedOutputChunks, 1);
	assert.equal(fixture.specification.destinationSelectedBeforeRender, true);
	assert.equal(fixture.specification.destinationOpenedAfterFfmpegStat, true);
	assert.equal(fixture.specification.preparedBlobFallbackRetained, true);
	assert.equal(fixture.specification.directRouteDownloadCalls, 0);
	for (const field of [
		'actualFfmpegCodecExecutionQualified',
		'codecConformanceQualified',
		'workerMemfsQualified',
		'nativeWasmCodecMemoryQualified',
		'stagedInputResidencyQualified',
		'rendererHeapQualified',
		'garbageCollectionQualified',
		'processRssQualified',
		'cpuQualified',
		'elapsedTimeQualified',
		'browserQualified',
		'operatingSystemQualified',
		'nativePickerQualified',
		'referenceScaleQualified',
		'quotaQualified',
		'filesystemDurabilityQualified',
		'crashPowerLossQualified',
		'packagedElectronQualified',
	]) assert.equal(fixture.specification[field], false, field);
	assert.match(
		fixture.limitation,
		/small Node correctness fixture.*mock FFmpeg.*both render strategies.*all seven.*virtual.*transport arithmetic and backpressure.*not.*actual FFmpeg codec.*reference-scale/isu,
	);
	assert.match(
		fixture.limitation,
		/256 MiB.*context and crop.*not.*end-to-end.*raw PCM payload.*excludes WAV framing.*complete staged WAV.*complete encoded output remains.*worker MEMFS.*does not bound.*staged-input residency.*native or WASM codec memory.*heap.*RSS.*CPU.*elapsed time/isu,
	);
	assert.match(
		fixture.limitation,
		/900,000-millisecond.*prepared-target TTL.*long offline desktop.*elapsed-time.*unqualified/isu,
	);
	assert.deepEqual(
		budgets.workloads.find(({ id }) => id === 'm2-streaming-bounded-memory')?.fixtureIds,
		['m2-streaming-project-8gib-v1', 'm2-direct-wav-385mib-v1'],
	);
	for (const path of fixture.evidence) {
		await access(new URL(`../${path.split('#')[0]}`, import.meta.url));
	}
});

test('the threat and quality documents limit direct compressed claims to the proved transport slice', async () => {
	const [threatModel, qualityBudgets] = await Promise.all([
		readFile(new URL('../docs/production-threat-model.md', import.meta.url), 'utf8'),
		readFile(new URL('../docs/quality-budgets.md', import.meta.url), 'utf8'),
	]);

	assert.match(
		threatModel,
		/direct compressed.*seven.*realtime-stream.*centrally admitted offline.*target before render.*exact writer.*after.*stat.*WORKERFS.*worker MEMFS.*one[- ]MiB.*backpressure.*no whole-output.*renderer.*close.*commit.*no final\s+renderer.*`Blob`/isu,
	);
	assert.match(
		threatModel,
		/worker MEMFS.*native or WASM codec memory.*reference-scale.*browser.*operating-system.*packaged.*crash.*power-loss.*unqualified/isu,
	);
	assert.match(
		qualityBudgets,
		/direct compressed.*both.*all seven.*269,484,049-byte.*258.*transport arithmetic and backpressure only.*outside.*bounded-memory\s+workload.*stays planned/isu,
	);
});

function findControl(matrix, riskId, controlId) {
	const risk = matrix.risks.find(({ id }) => id === riskId);
	assert.ok(risk, riskId);
	const control = risk.currentControls.find(({ id }) => id === controlId);
	assert.ok(control, controlId);
	return control;
}

function findOptionalControl(matrix, controlId) {
	for (const risk of matrix.risks) {
		const control = risk.currentControls.find(({ id }) => id === controlId);
		if (control) return control;
	}
	return null;
}
