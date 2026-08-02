/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const budgetsUrl = new URL('../config/quality-budgets.json', import.meta.url);
const offlineStagingFormula = 'max(outputFrames × inputChannels × offlineBytesPerSample, outputBytesPerRender)';

test('direct ZIP32 stem publication has narrow capability and rollback controls', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const publication = findControl(
		matrix,
		'desktop-write-path-capabilities',
		'direct-zip32-stem-save',
	);
	const rollback = findControl(
		matrix,
		'long-job-cancellation',
		'direct-zip32-stem-save-rollback',
	);
	for (const oldId of [
		'exact-direct-native-pcm-zip32-stem-save',
		'direct-native-pcm-zip32-stem-save-rollback',
	]) {
		assert.equal(matrix.risks.some(({ currentControls }) => (
			currentControls.some(({ id }) => id === oldId)
		)), false, oldId);
	}

	for (const path of [
		'src/common/editor/controller/audio-export-render-orchestration.ts',
		'src/common/editor/controller/direct-audio-render-plan.ts',
		'src/common/editor/controller/direct-compressed-plan.ts',
		'src/common/editor/controller/direct-compressed-stem-archive-plan.ts',
		'src/common/editor/controller/direct-stem-archive-export.ts',
		'src/common/editor/controller/export-service.ts',
		'src/common/editor/controller/rendered-audio-encoding.ts',
		'src/common/editor/controller/sequential-zip32-stream.ts',
		'src/common/editor/controller/zip32.ts',
		'tests/audio-editor-direct-audio-render-plan.test.ts',
		'tests/audio-editor-export-direct-compressed-stem-archive.test.ts',
		'tests/audio-editor-export-direct-compressed-stem-stream.test.ts',
		'tests/audio-editor-export-direct-compressed-stem-service.test.ts',
		'tests/audio-editor-offline-compressed-stem-encoding.test.ts',
		'tests/audio-editor-export-direct-stem-archive.test.ts',
		'tests/audio-editor-export-direct-stem-stream.test.ts',
		'tests/audio-editor-sequential-zip32-stream.test.ts',
	]) {
		assert.ok(publication.evidence.some((item) => item.path === path), path);
		await access(new URL(`../${path}`, import.meta.url));
	}
	for (const path of [
		'src/common/editor/controller/audio-export-render-orchestration.ts',
		'src/common/editor/controller/direct-audio-render-plan.ts',
		'src/common/editor/controller/direct-compressed-plan.ts',
		'src/common/editor/controller/direct-compressed-stem-archive-plan.ts',
		'src/common/editor/controller/direct-stem-archive-export.ts',
		'src/common/editor/controller/export-service.ts',
		'src/common/editor/controller/rendered-audio-encoding.ts',
		'src/common/editor/controller/sequential-zip32-stream.ts',
		'tests/audio-editor-direct-audio-render-plan.test.ts',
		'tests/audio-editor-export-direct-compressed-stem-archive.test.ts',
		'tests/audio-editor-export-direct-compressed-stem-stream.test.ts',
		'tests/audio-editor-export-direct-compressed-stem-service.test.ts',
		'tests/audio-editor-offline-compressed-stem-encoding.test.ts',
		'tests/audio-editor-export-direct-stem-stream.test.ts',
		'tests/audio-editor-sequential-zip32-stream.test.ts',
	]) assert.ok(rollback.evidence.some((item) => item.path === path), path);

	assert.match(
		publication.summary,
		/native-PCM.*exact ZIP32.*WAV, AIFF, or BWF stems.*entry.*same order.*exact entry names and sizes.*recomputed.*archive byte length/isu,
	);
	assert.match(
		publication.summary,
		/seven canonical.*MP3.*FLAC.*Ogg Vorbis.*Opus.*WavPack.*MP2.*AAC\/M4A.*canonical `realtime-stream`.*centrally admitted `offline`.*owned snapshot.*fingerprint/isu,
	);
	assert.ok(publication.summary.includes(offlineStagingFormula));
	assert.match(
		publication.summary,
		/offlineBytesPerSample.*requested FLAC integer bytes per sample.*four bytes.*other six formats.*second term.*realtime-retry output-width.*outputFrames.*outputChannels.*Float32\(4\).*including for FLAC/isu,
	);
	assert.match(
		publication.summary,
		/per-entry maximum.*max.*strategy-aware staging bound.*1 MiB.*synthetic maximum ZIP32.*before target selection.*refusal boundary.*not.*codec expansion.*conformance.*scale/isu,
	);
	assert.match(
		publication.summary,
		/native.*prepared exact-size.*compressed.*prepared maximum-size.*selects and opens.*before.*render/isu,
	);
	assert.match(
		publication.summary,
		/native.*temporary-storage preflight charges the largest sequential intermediate.*compressed.*strategy-aware staging bound.*realtime.*outputBytesPerRender.*offline.*exact two-term maximum.*excludes.*WAV framing.*codec output.*aggregate legacy staging claim/isu,
	);
	assert.match(
		publication.summary,
		/source slices to 64 KiB.*awaits.*sink backpressure.*emitted bytes.*ZIP32 layout.*closes the destination.*after close.*planned or actual, emitted, destination-written, and committed-result byte counts/isu,
	);
	assert.match(
		publication.summary,
		/compressed.*staged WAV `Blob`.*worker MEMFS.*one complete encoded result.*actual entry sizes.*order.*byte counts.*no final ZIP `Blob`.*no download publisher/isu,
	);
	assert.match(
		publication.summary,
		/Prepared Blob mode declines the direct route.*browser Blob\/download path proceeds unchanged/isu,
	);
	assert.match(
		publication.summary,
		/custom FFmpeg stems.*BW64 stems.*video.*7z.*final-Blob direct publication.*remain excluded/isu,
	);
	assert.match(
		publication.summary,
		/does not qualify.*actual FFmpeg codec execution.*codec conformance.*codec expansion.*heap.*RSS.*MEMFS.*garbage collection.*CPU.*elapsed time.*browser or operating-system behavior.*reference scale/isu,
	);
	assert.match(
		publication.summary,
		/WAV and BWF.*`audio\/wav`.*`\.wav`.*AIFF.*`audio\/aiff`.*`\.aiff`/isu,
	);
	assert.match(
		publication.summary,
		/preflights exactly four bytes.*two ordered four-byte WAV-plan marker outputs.*exact 268-byte ZIP32 archive.*constructs no `Blob`.*neither the legacy archive nor download publisher.*not native WAV conformance/isu,
	);
	assert.match(
		publication.summary,
		/Prepared Blob mode.*272-byte legacy temporary-storage preflight.*ordered archive additions.*download publication/isu,
	);
	assert.match(
		publication.summary,
		/`01-Voice\.mp3`.*`02-Music\.mp3`.*eight-byte raw preflight.*16-byte aggregate legacy.*1,048,576-byte per-entry maximum.*2,097,406-byte maximum ZIP32.*three- and five-byte.*262-byte actual ZIP32/isu,
	);
	assert.match(
		rollback.summary,
		/plan or fingerprint drift.*empty encoded result.*per-entry maximum.*reported and actual.*actual ZIP32 layout.*failure.*cancellation.*cleans.*aborts the unpublished destination exactly once.*no commit.*final ZIP `Blob`.*download publication/isu,
	);
	assert.match(
		rollback.summary,
		/centrally admitted offline.*ordinary offline renderer or encoder failure.*current stem.*realtime retry.*before.*ZIP entry.*currentness.*cancellation.*integrity.*do not retry.*plan or fingerprint drift.*refus.*before.*ZIP entry.*no retry.*after.*entry/isu,
	);
	assert.match(
		rollback.summary,
		/Destination close.*precede.*non-cancellable commit.*ownership.*committed result.*committed-result size drift.*post-publication integrity failure, not rollback/isu,
	);
	assert.match(
		rollback.summary,
		/Nested archive and service cleanup.*underlying prepared abort exactly once.*zero commit.*zero download publication/isu,
	);
	assert.doesNotMatch(publication.summary, /offline compressed stems.*remain excluded/iu);
	assert.doesNotMatch(rollback.summary, /offline compressed stems.*qualif(?:y|ied).*excluded/iu);
});

test('the direct ZIP32 fixture records native and both compressed strategies without scale claims', async () => {
	const budgets = JSON.parse(await readFile(budgetsUrl, 'utf8'));
	const fixture = budgets.fixtures.find(({ id }) => id === 'm2-direct-zip32-stems-v2');
	assert.ok(fixture);
	assert.equal(budgets.fixtures.some(({ id }) => id === 'm2-direct-native-pcm-zip32-stems-v1'), false);
	assert.equal(fixture.status, 'provisional');
	assert.equal(fixture.kind, 'deterministic-direct-zip32-stem-node-witness');
	assert.deepEqual(fixture.milestones, ['2']);
	assert.equal(fixture.specification.generatorRevision, 3);
	assert.deepEqual(fixture.specification.admittedStemFormats, ['wav', 'aiff', 'bwf']);
	assert.deepEqual(fixture.specification.admittedCompressedStemFormats, [
		'mp3', 'flac', 'ogg-vorbis', 'opus', 'wavpack', 'mp2', 'aac-m4a',
	]);
	assert.equal(fixture.specification.admittedRealtimeCompressedStemFormats, undefined);
	assert.deepEqual(fixture.specification.admittedCompressedRenderStrategies, [
		'realtime-stream', 'offline',
	]);
	assert.equal(fixture.specification.archiveFormat, 'zip32');
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
	assert.equal(fixture.specification.compressedCodecExpansionBoundQualified, false);
	assert.equal(fixture.specification.compressedRawPerRenderPreflightVerified, undefined);
	assert.equal(fixture.specification.compressedStrategyBoundPreflightVerified, true);
	assert.equal(fixture.specification.compressedActualZip32LayoutRecomputed, true);
	assert.equal(fixture.specification.compressedActualByteCountsAgree, true);
	assert.equal(fixture.specification.compressedMaximumOwnedEncodedStems, 1);
	assert.equal(fixture.specification.compressedCompleteStagedWavRetained, true);
	assert.equal(fixture.specification.compressedCompleteWorkerMemfsOutputRetained, true);
	assert.equal(fixture.specification.compressedWholeEncodedStemResultRetained, true);
	assert.equal(fixture.specification.directRouteFinalZipBlobConstructions, 0);
	assert.equal(fixture.specification.offlineCompressedStemDirectRouteVerified, true);
	assert.equal(fixture.specification.offlineCompressedCentralAdmissionVerified, true);
	assert.equal(fixture.specification.offlineCompressedInputWidthStagingVerified, true);
	assert.equal(fixture.specification.offlineCompressedRealtimeRetryWidthBoundVerified, true);
	assert.equal(fixture.specification.offlineCompressedCurrentStemRealtimeRetryVerified, true);
	assert.equal(fixture.specification.offlineCompressedRetryCurrentnessRefusalVerified, true);
	assert.equal(fixture.specification.offlineCompressedFfmpegMappingOwnershipVerified, true);
	assert.equal(fixture.specification.customFfmpegStemDirectRouteVerified, false);
	assert.equal(fixture.specification.sevenZDirectRouteVerified, false);
	assert.equal(fixture.specification.actualFfmpegCodecExecutionQualified, false);
	assert.equal(fixture.specification.codecConformanceQualified, false);
	assert.deepEqual(fixture.specification.compressedFixtureEntryNames, [
		'01-Voice.mp3', '02-Music.mp3',
	]);
	assert.equal(fixture.specification.compressedFixtureRawPreflightBytes, 8);
	assert.equal(fixture.specification.compressedFixtureAggregateLegacyClaimBytes, 16);
	assert.equal(fixture.specification.compressedFixtureEntryMaximumBytes, 1_048_576);
	assert.equal(fixture.specification.compressedFixtureMaximumZip32Bytes, 2_097_406);
	assert.deepEqual(fixture.specification.compressedFixtureActualEntryBytes, [3, 5]);
	assert.equal(fixture.specification.compressedFixtureActualZip32Bytes, 262);
	assert.equal(fixture.specification.rendererHeapQualified, false);
	assert.equal(fixture.specification.processRssQualified, false);
	assert.equal(fixture.specification.browserQualified, false);
	assert.equal(fixture.specification.operatingSystemQualified, false);
	assert.equal(fixture.specification.referenceScaleQualified, false);
	assert.match(
		fixture.limitation,
		/Node.*provider-injected.*prepared streaming destination.*not.*File System Access.*Electron filesystem.*native picker/isu,
	);
	assert.match(
		fixture.limitation,
		/small Node correctness fixture.*actual FFmpeg codec execution.*codec conformance.*codec expansion.*MEMFS.*garbage collection.*CPU.*elapsed time.*not reference-scale.*renderer-heap.*process-RSS.*filesystem-durability/isu,
	);
	assert.deepEqual(
		budgets.workloads.find(({ id }) => id === 'm2-streaming-bounded-memory')?.fixtureIds,
		[
			'm2-streaming-project-8gib-v1',
			'm2-direct-wav-385mib-v1',
		],
	);
	assert.equal(
		budgets.workloads.find(({ id }) => id === 'm2-streaming-bounded-memory')?.status,
		'planned',
	);

	for (const path of [
		'src/common/editor/controller/audio-export-render-orchestration.ts',
		'src/common/editor/controller/direct-audio-render-plan.ts',
		'src/common/editor/controller/rendered-audio-encoding.ts',
		'tests/audio-editor-direct-audio-render-plan.test.ts',
		'tests/audio-editor-offline-compressed-stem-encoding.test.ts',
	]) assert.ok(fixture.evidence.includes(path), path);
	for (const path of fixture.evidence) await access(new URL(`../${path.split('#')[0]}`, import.meta.url));
});

test('the threat and quality documents state the exact slice and its exclusions', async () => {
	const [threatModel, qualityBudgets] = await Promise.all([
		readFile(new URL('../docs/production-threat-model.md', import.meta.url), 'utf8'),
		readFile(new URL('../docs/quality-budgets.md', import.meta.url), 'utf8'),
	]);
	const normalizedThreatModel = threatModel.replace(/\s+/gu, ' ');
	const normalizedQualityBudgets = qualityBudgets.replace(/\s+/gu, ' ');

	assert.match(
		threatModel,
		/direct ZIP32 stem.*native-PCM.*WAV, AIFF, and BWF.*seven canonical.*MP3.*AAC\/M4A.*realtime-stream.*centrally admitted.*offline.*owned.*snapshot.*fingerprint.*per-entry maximum/isu,
	);
	assert.ok(normalizedThreatModel.includes(offlineStagingFormula));
	assert.match(
		threatModel,
		/offlineBytesPerSample.*requested FLAC integer bytes per sample.*four bytes.*other six formats.*outputFrames.*outputChannels.*Float32\(4\).*including for FLAC.*synthetic maximum ZIP32.*before\s+target selection.*compressed prepared maximum-size.*before render/isu,
	);
	assert.match(
		threatModel,
		/compressed preflight.*strategy-aware staging bound.*realtime.*outputBytesPerRender.*offline.*exact two-term maximum.*excludes WAV\s+framing.*codec\s+output.*aggregate legacy staging claim/isu,
	);
	assert.match(
		threatModel,
		/staged WAV\s+`Blob`.*worker\s+MEMFS.*one complete encoded result.*actual\s+ZIP32.*no\s+final ZIP `Blob`.*ordinary offline.*current stem.*realtime.*currentness.*custom\s+FFmpeg.*7z.*BW64.*reference scale/isu,
	);
	assert.match(
		qualityBudgets,
		/direct ZIP32 stem.*native-PCM.*canonical realtime and centrally\s+admitted offline compressed.*small focused Node correctness/isu,
	);
	assert.ok(normalizedQualityBudgets.includes(offlineStagingFormula));
	assert.match(
		qualityBudgets,
		/requested FLAC integer bytes per\s+sample.*other six formats.*outputFrames.*outputChannels.*Float32\(4\).*including for\s+FLAC.*maximum\s+ZIP32 destination.*actual ZIP32 archive/isu,
	);
	assert.match(
		qualityBudgets,
		/retain.*complete staged WAV `Blob`.*worker\s+MEMFS output.*complete encoded result/isu,
	);
	assert.match(
		qualityBudgets,
		/reference scale remains excluded.*bounded-memory workload, which stays planned/isu,
	);
});

function findControl(matrix, riskId, controlId) {
	const risk = matrix.risks.find(({ id }) => id === riskId);
	assert.ok(risk, riskId);
	const control = risk.currentControls.find(({ id }) => id === controlId);
	assert.ok(control, controlId);
	return control;
}
