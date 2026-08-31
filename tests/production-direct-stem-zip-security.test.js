/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const budgetsUrl = new URL('../config/quality-budgets.json', import.meta.url);
const offlineStagingFormula = 'max(outputFrames × inputChannels × offlineBytesPerSample, outputBytesPerRender)';

test('direct stem archives use browser-native complete-file codecs and exact rollback', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const publication = findControl(
		matrix,
		'desktop-write-path-capabilities',
		'direct-stem-archive-save',
	);
	const rollback = findControl(
		matrix,
		'long-job-cancellation',
		'direct-stem-archive-save-rollback',
	);

	for (const path of [
		'src/common/editor/browser-audio-codec-runtime.ts',
		'src/common/editor/browser-dedicated-audio-codec.ts',
		'src/common/editor/browser-webcodecs-aac.ts',
		'src/common/editor/controller/direct-stem-archive-export.ts',
		'src/common/editor/controller/sequential-seven-zip-copy.ts',
		'src/common/editor/controller/sequential-zip32-stream.ts',
		'tests/audio-editor-browser-dedicated-codec.test.ts',
		'tests/audio-editor-browser-webcodecs-aac.test.ts',
		'tests/audio-editor-export-direct-compressed-stem-service.test.ts',
		'tests/audio-editor-sequential-seven-zip-copy.test.ts',
		'tests/audio-editor-sequential-zip32-stream.test.ts',
	]) {
		assert.ok(publication.evidence.some((item) => item.path === path), path);
		await access(new URL(`../${path}`, import.meta.url));
	}
	for (const path of [
		'src/common/editor/browser-dedicated-audio-worker-client.ts',
		'src/common/editor/controller/direct-stem-archive-export.ts',
		'tests/audio-editor-browser-dedicated-codec.test.ts',
		'tests/audio-editor-export-direct-compressed-stem-service.test.ts',
	]) assert.ok(rollback.evidence.some((item) => item.path === path), path);

	assert.match(
		publication.summary,
		/exact ZIP32 and 7z Copy.*WAV, AIFF, or BWF.*exact names.*sizes.*order.*recomputed layouts.*fixed 32-byte/isu,
	);
	assert.match(
		publication.summary,
		/Compressed stems remain ZIP32-only.*seven canonical.*realtime.*offline.*per-entry refusal/isu,
	);
	assert.match(
		publication.summary,
		/WebAssembly providers.*complete FLAC.*MP3.*Ogg Vorbis.*Opus.*WavPack.*MP2.*WebCodecs.*Mediabunny.*AAC\/M4A/isu,
	);
	assert.match(
		publication.summary,
		/Unsupported profiles.*custom FFmpeg.*fail closed.*without a browser FFmpeg fallback/isu,
	);
	assert.match(
		publication.summary,
		/sequential.*current complete result.*at-most-64-KiB.*backpressure.*recomputes actual.*closes before commit.*byte-count agreement/isu,
	);
	assert.match(
		publication.summary,
		/no final archive Blob.*retains complete PCM and encoded-file bytes.*Prepared Blob mode.*separately bounded/isu,
	);
	assert.match(
		rollback.summary,
		/retry only the current stem.*before entry bytes.*cancellation.*never retries/isu,
	);
	assert.match(
		rollback.summary,
		/aborting a dedicated codec terminates its worker.*unavailable AAC.*fails closed without FFmpeg/isu,
	);
	assert.match(
		rollback.summary,
		/abort the unpublished destination exactly once.*no commit.*final archive Blob.*download/isu,
	);
	assert.equal(publication.evidence.some(({ path }) => path === 'src/common/editor/ffmpeg.js'), false);
});

test('the direct stem-archive fixture records native ZIP32/7z and compressed ZIP32 without scale claims', async () => {
	const budgets = JSON.parse(await readFile(budgetsUrl, 'utf8'));
	const fixture = budgets.fixtures.find(({ id }) => id === 'm2-direct-stem-archives-v3');
	assert.ok(fixture);
	for (const oldId of ['m2-direct-native-pcm-zip32-stems-v1', 'm2-direct-zip32-stems-v2']) {
		assert.equal(budgets.fixtures.some(({ id }) => id === oldId), false, oldId);
	}
	assert.equal(fixture.kind, 'deterministic-direct-stem-archive-node-witness');
	assert.equal(fixture.specification.generatorRevision, 4);
	assert.deepEqual(fixture.specification.admittedStemFormats, ['wav', 'aiff', 'bwf']);
	assert.deepEqual(fixture.specification.admittedCompressedStemFormats, [
		'mp3', 'flac', 'ogg-vorbis', 'opus', 'wavpack', 'mp2', 'aac-m4a',
	]);
	assert.equal(fixture.specification.admittedRealtimeCompressedStemFormats, undefined);
	assert.deepEqual(fixture.specification.admittedCompressedRenderStrategies, [
		'realtime-stream', 'offline',
	]);
	assert.deepEqual(fixture.specification.admittedNativeArchiveFormats, ['zip32', '7z-copy']);
	assert.equal(fixture.specification.compressedArchiveFormat, 'zip32');
	assert.equal(fixture.specification.archiveFormat, undefined);
	assert.equal(fixture.specification.nativePreparedDestinationMode, 'exact-size-stream');
	assert.equal(fixture.specification.preparedDestinationMode, undefined);
	assert.deepEqual(fixture.specification.directFixtureEntryNames, [
		'01-dialogue.wav', '02-music.wav',
	]);
	assert.deepEqual(fixture.specification.directFixtureEntryBytes, [4, 4]);
	assert.equal(fixture.specification.directFixtureArchiveBytes, 268);
	assert.equal(
		fixture.specification.directFixturePayloadSemantics,
		'archive-protocol-markers-not-native-container-conformance',
	);
	assert.deepEqual(fixture.specification.admissionFixtureEntryBytes, [60, 60]);
	assert.equal(fixture.specification.admissionFixtureArchiveBytes, 380);
	assert.equal(fixture.specification.admissionFixtureLargestSequentialIntermediateBytes, 60);
	assert.equal(fixture.specification.serviceDirectPreflightBytes, 4);
	assert.equal(fixture.specification.serviceBlobFallbackPreflightBytes, 272);
	assert.equal(fixture.specification.nativeDirectRouteBlobConstructions, 0);
	assert.equal(fixture.specification.directRouteBlobConstructions, undefined);
	assert.equal(fixture.specification.directRouteLegacyArchiveCalls, 0);
	assert.equal(fixture.specification.directRouteDownloadCalls, 0);
	assert.deepEqual(fixture.specification.nativeSevenZipFixtureEntryNames, [
		'01-dialogue.wav', '02-music.wav',
	]);
	assert.deepEqual(fixture.specification.nativeSevenZipFixtureEntryBytes, [4, 4]);
	assert.equal(fixture.specification.nativeSevenZipFixtureArchiveBytes, 151);
	assert.equal(
		fixture.specification.nativeSevenZipFixtureSha256,
		'f04db3e27c345efed608652897a92fc009485db9c156167364bf9320253bffbc',
	);
	assert.equal(fixture.specification.nativeSevenZipInitialZeroPrefixBytes, 32);
	assert.equal(fixture.specification.nativeSevenZipMaximumOwnedStems, 1);
	assert.equal(fixture.specification.nativeSevenZipSealBeforeFinalPrefixPatchVerified, true);
	assert.equal(fixture.specification.nativeSevenZipMaximumFinalPrefixPatchAttempts, 1);
	assert.equal(fixture.specification.nativeSevenZipFinalPrefixPatchPreservesByteLength, true);
	assert.equal(fixture.specification.nativeSevenZipPatchBeforeCommitVerified, true);
	assert.equal(fixture.specification.nestedFailurePreparedAbortCount, 1);
	assert.deepEqual(fixture.specification.sequentialEntryBytes, [3, 1, 2, 2]);
	assert.equal(fixture.specification.sequentialArchiveBytes, 468);
	assert.equal(fixture.specification.sourceSliceFixtureBytes, 262_144);
	assert.equal(fixture.specification.inputSliceBytes, 65_536);
	assert.equal(fixture.specification.destinationSelectedBeforeRender, true);
	assert.equal(fixture.specification.serialSinkBackpressureVerified, true);
	assert.equal(fixture.specification.closeBeforeCommitVerified, true);
	assert.equal(fixture.specification.failureAndCancellationUnpublished, true);
	assert.equal(fixture.specification.positiveFormatAdmissionVerified, true);
	assert.equal(fixture.specification.browserBlobFallbackRetained, true);
	assert.equal(fixture.specification.compressedRenderStrategy, undefined);
	assert.equal(fixture.specification.compressedPreparedDestinationMode, 'maximum-size-stream');
	assert.equal(fixture.specification.compressedMinimumEntryMaximumBytes, 1_048_576);
	assert.equal(fixture.specification.maximumOwnedCompressedStemBytes, 256 * 1024 ** 2);
	assert.equal(
		fixture.specification.compressedStagingBoundFormula,
		`realtime outputBytesPerRender; offline ${offlineStagingFormula}`,
	);
	assert.equal(
		fixture.specification.compressedOfflineBytesPerSampleFormula,
		'requested FLAC integer bytes per sample; 4 for the other six formats',
	);
	assert.equal(
		fixture.specification.compressedRealtimeRetryOutputFormula,
		'outputBytesPerRender = outputFrames × outputChannels × Float32(4)',
	);
	assert.equal(
		fixture.specification.compressedEntryMaximumFormula,
		'max(strategy-aware staging bound, 1 MiB)',
	);
	assert.equal(fixture.specification.compressedEntryMaximumIsRefusalBoundary, true);
	assert.equal(Object.hasOwn(fixture.specification, 'compressedCodecExpansionBoundQualified'), false);
	assert.equal(fixture.specification.compressedRawPerRenderPreflightVerified, undefined);
	assert.equal(fixture.specification.compressedStrategyBoundPreflightVerified, true);
	assert.equal(fixture.specification.compressedActualZip32LayoutRecomputed, true);
	assert.equal(fixture.specification.compressedActualByteCountsAgree, true);
	assert.equal(fixture.specification.compressedMaximumOwnedEncodedStems, 1);
	assert.equal(fixture.specification.compressedCompleteStagedWavRetained, true);
	assert.equal(fixture.specification.compressedCompleteWorkerMemfsOutputRetained, true);
	assert.equal(fixture.specification.compressedWholeEncodedStemResultRetained, true);
	assert.equal(fixture.specification.directRouteFinalZipBlobConstructions, 0);
	assert.equal(fixture.specification.partialPublishedOutputs, 0);
	assert.equal(fixture.specification.offlineCompressedStemDirectRouteVerified, true);
	assert.equal(fixture.specification.offlineCompressedCentralAdmissionVerified, true);
	assert.equal(fixture.specification.offlineCompressedInputWidthStagingVerified, true);
	assert.equal(fixture.specification.offlineCompressedRealtimeRetryWidthBoundVerified, true);
	assert.equal(fixture.specification.offlineCompressedCurrentStemRealtimeRetryVerified, true);
	assert.equal(fixture.specification.offlineCompressedRetryCurrentnessRefusalVerified, true);
	assert.equal(fixture.specification.offlineCompressedFfmpegMappingOwnershipVerified, true);
	assert.equal(fixture.specification.customFfmpegStemDirectRouteVerified, false);
	assert.equal(fixture.specification.nativeSevenZDirectRouteVerified, true);
	assert.equal(fixture.specification.compressedSevenZDirectRouteVerified, false);
	assert.equal(fixture.specification.sevenZDirectRouteVerified, undefined);
	assert.equal(Object.hasOwn(fixture.specification, 'actualFfmpegCodecExecutionQualified'), false);
	assert.equal(Object.hasOwn(fixture.specification, 'codecConformanceQualified'), false);
	assert.deepEqual(fixture.specification.compressedFixtureEntryNames, [
		'01-Voice.mp3', '02-Music.mp3',
	]);
	assert.equal(fixture.specification.compressedFixtureRawPreflightBytes, 8);
	assert.equal(fixture.specification.compressedFixtureAggregateLegacyClaimBytes, 16);
	assert.equal(fixture.specification.compressedFixtureEntryMaximumBytes, 1_048_576);
	assert.equal(fixture.specification.compressedFixtureMaximumZip32Bytes, 2_097_406);
	assert.deepEqual(fixture.specification.compressedFixtureActualEntryBytes, [3, 5]);
	assert.equal(fixture.specification.compressedFixtureActualZip32Bytes, 262);
	assert.doesNotMatch(JSON.stringify(fixture.specification), /qualified/iu);
	assert.match(
		fixture.limitation,
		/Node.*provider-injected.*prepared streaming destination.*not.*File System Access.*Electron filesystem.*native picker/isu,
	);
	assert.match(
		fixture.limitation,
		/small Node correctness fixture.*151-byte 7z.*small injected golden correctness fixture.*not.*reference-scale.*actual FFmpeg codec execution.*codec conformance.*codec expansion.*MEMFS.*garbage collection.*CPU.*elapsed time.*not a reference-scale.*renderer-heap.*process-RSS.*filesystem-durability.*crash.*power-loss/isu,
	);
	const workload = budgets.workloads.find(({ id }) => id === 'm2-direct-stem-archives-v3');
	assert.deepEqual(workload.fixtureIds, ['m2-direct-stem-archives-v3']);
	assert.equal(workload.behavior, 'blocking');
	assert.equal(budgets.workloads.some(({ id }) => id === 'm2-streaming-bounded-memory'), false);

	for (const path of [
		'src/common/editor/controller/audio-export-render-orchestration.ts',
		'src/common/editor/controller/direct-audio-render-plan.ts',
		'src/common/editor/controller/direct-native-stem-archive-plan.ts',
		'src/common/editor/controller/rendered-audio-encoding.ts',
		'src/common/editor/controller/sequential-seven-zip-copy.ts',
		'src/common/editor/file-save-stream.ts',
		'tests/audio-editor-direct-audio-render-plan.test.ts',
		'tests/audio-editor-direct-native-stem-archive-plan.test.ts',
		'tests/audio-editor-export-direct-seven-zip-stem-stream.test.ts',
		'tests/audio-editor-final-prefix-save.test.ts',
		'tests/audio-editor-offline-compressed-stem-encoding.test.ts',
		'tests/audio-editor-sequential-seven-zip-copy.test.ts',
		'tests/fixtures/seven-zip-copy-golden.ts',
	]) await access(new URL(`../${path}`, import.meta.url));
});

test('the threat and quality documents separate current codecs from historical fixtures', async () => {
	const [threatModel, qualityBudgets] = await Promise.all([
		readFile(new URL('../docs/production-threat-model.md', import.meta.url), 'utf8'),
		readFile(new URL('../docs/quality-budgets.md', import.meta.url), 'utf8'),
	]);

	assert.match(
		threatModel,
		/direct stem-archive.*ZIP32.*7z Copy.*Compressed stems.*ZIP32-only.*complete FLAC.*MP3.*Vorbis.*Opus.*WavPack.*MP2.*WebCodecs.*Mediabunny.*AAC\/M4A/isu,
	);
	assert.match(
		threatModel,
		/unsupported profiles.*custom FFmpeg.*fail closed.*no browser FFmpeg fallback.*no final archive Blob/isu,
	);
	assert.match(
		threatModel,
		/at-most-64-KiB.*backpressure.*not.*end-to-end.*complete.*PCM.*encoded-file bytes/isu,
	);
	assert.match(
		qualityBudgets,
		/direct stem-archive publication.*small focused Node correctness/isu,
	);
	assert.match(
		qualityBudgets,
		/provider-injected FFmpeg\/MEMFS fixtures.*retained historical.*do not describe the production\s+browser codec runtime.*dedicated reviewed audio WASMs.*WebCodecs\/Mediabunny.*no FFmpeg fallback/isu,
	);
});

function findControl(matrix, riskId, controlId) {
	const risk = matrix.risks.find(({ id }) => id === riskId);
	assert.ok(risk, riskId);
	const control = risk.currentControls.find(({ id }) => id === controlId);
	assert.ok(control, controlId);
	return control;
}
