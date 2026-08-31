/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import { CANONICAL_VIDEO_EXPORT_PLAN_VERSION } from '../src/common/editor/video-export-plan-version.ts';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const budgetsUrl = new URL('../config/quality-budgets.json', import.meta.url);

const FORMAT_CONTRACTS = Object.freeze([
	{
		id: 'mp4', extension: '.mp4', mimeType: 'video/mp4', purpose: 'video',
		videoEncoder: 'libx264', audioEncoder: 'aac', pixelFormat: 'yuv420p', faststart: true,
	},
	{
		id: 'webm', extension: '.webm', mimeType: 'video/webm', purpose: 'video',
		videoEncoder: 'libvpx-vp9', audioEncoder: 'libopus', pixelFormat: 'yuv420p', faststart: false,
	},
]);

const PUBLICATION_EVIDENCE = Object.freeze([
	'src/common/editor/video-delivery-encoder-tier.ts',
	'src/common/editor/video-keyframe-video-encoder.ts',
	'src/common/editor/video-keyframe-mediabunny-execution.ts',
	'src/common/editor/video-mediabunny-muxer.ts',
	'src/common/editor/video-keyframe-video-output.ts',
	'src/common/editor/controller/direct-video-export.ts',
	'src/common/editor/controller/video-export-service.ts',
	'src/common/editor/desktop-video-codec-runtime.ts',
	'desktop/external-ffmpeg-video-operation-service.ts',
	'desktop/external-ffmpeg-video-qualification.ts',
	'desktop/external-ffmpeg-video-canary-inspection.ts',
	'tests/audio-editor-video-delivery-encoder-tier.test.ts',
	'tests/audio-editor-video-keyframe-mediabunny-execution.test.ts',
	'tests/audio-editor-video-mediabunny-muxer.test.ts',
	'tests/audio-editor-export-direct-video.test.ts',
	'tests/external-ffmpeg-video-operation-service.test.ts',
	'tests/external-ffmpeg-video-qualification.test.ts',
	'tests/external-ffmpeg-video-canary-inspection.test.ts',
]);

const ROLLBACK_EVIDENCE = Object.freeze([
	'src/common/editor/video-delivery-encoder-tier.ts',
	'src/common/editor/video-keyframe-video-encoder.ts',
	'src/common/editor/video-keyframe-mediabunny-execution.ts',
	'src/common/editor/video-mediabunny-muxer.ts',
	'src/common/editor/controller/direct-video-export.ts',
	'src/common/editor/controller/video-export-service.ts',
	'src/common/editor/desktop-video-codec-runtime.ts',
	'desktop/external-ffmpeg-video-session-cleanup.ts',
	'tests/audio-editor-video-keyframe-native-video-encoder.test.ts',
	'tests/audio-editor-video-keyframe-mediabunny-execution.test.ts',
	'tests/audio-editor-video-mediabunny-muxer.test.ts',
	'tests/audio-editor-export-direct-video.test.ts',
	'tests/external-ffmpeg-video-session-cleanup.test.ts',
]);

const KEYED_PROJECT_EVIDENCE = Object.freeze([
	'src/common/editor/project-schema-identity.ts',
	'src/framescaper/editor-project-identity.ts',
	'src/framescaper/editor-project.ts',
	'tests/audio-editor-project-schema-identity.test.ts',
	'tests/audio-editor-framescaper-baseline.test.ts',
]);

const KEYED_EXPORT_AUTHORITY_EVIDENCE = Object.freeze([
	'src/framescaper/editor-project-unified-render-authority.ts',
	'src/framescaper/editor-project.ts',
	'src/framescaper/video-export-dispatch-retime.ts',
	'tests/audio-editor-framescaper-baseline.test.ts',
]);

const KEYED_ENCODER_EVIDENCE = Object.freeze([
	'src/common/editor/video-keyframe-encoder-admission.ts',
	'src/common/editor/video-keyframe-audio-input.ts',
	'src/common/editor/video-webcodecs-producer.ts',
	'src/common/editor/video-keyframe-video-encoder.ts',
	'src/common/editor/video-keyframe-mediabunny-execution.ts',
	'src/common/editor/video-mediabunny-muxer.ts',
	'src/common/editor/desktop-video-codec-runtime.ts',
	'desktop/external-ffmpeg-video-operation-service.ts',
	'desktop/external-ffmpeg-video-session-cleanup.ts',
	'tests/audio-editor-video-webcodecs-producer.test.ts',
	'tests/audio-editor-video-keyframe-native-video-encoder.test.ts',
	'tests/audio-editor-video-keyframe-mediabunny-execution.test.ts',
	'tests/audio-editor-video-mediabunny-muxer.test.ts',
	'tests/audio-editor-desktop-video-codec-runtime.test.ts',
	'tests/external-ffmpeg-video-session-cleanup.test.ts',
]);

test('exact direct MP4 and WebM publication separates browser-native and desktop providers', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const publication = findControl(
		matrix,
		'desktop-write-path-capabilities',
		'exact-direct-mp4-webm-video-save',
	);
	const rollback = findControl(
		matrix,
		'long-job-cancellation',
		'direct-mp4-webm-video-save-rollback',
	);
	const fallback = findControl(
		matrix,
		'external-project-document-validation',
		'video-rendered-fallback-export',
	);

	for (const path of PUBLICATION_EVIDENCE) {
		assert.ok(publication.evidence.some((item) => item.path === path), path);
		await access(new URL(`../${path}`, import.meta.url));
	}
	for (const path of ROLLBACK_EVIDENCE) {
		assert.ok(rollback.evidence.some((item) => item.path === path), path);
	}
	assert.equal(publication.evidence.some(({ path }) => path === 'src/common/editor/ffmpeg.js'), false);
	assert.equal(
		publication.evidence.some(({ path }) => path === 'patches/npm/@ffmpeg+ffmpeg+0.12.15.patch'),
		false,
	);

	assert.match(
		publication.summary,
		/exact MP4 route.*`mp4`.*`\.mp4`.*`video\/mp4`.*WebM.*`webm`.*`\.webm`.*`video\/webm`/isu,
	);
	assert.match(
		publication.summary,
		/production browser.*exact keyed-frame path.*WebCodecs.*H\.264.*VP9.*Mediabunny.*AAC.*Opus.*complete container/isu,
	);
	assert.match(
		publication.summary,
		/ineligible composed-graph.*missing WebCodecs.*unsupported tuple.*refuses.*no browser FFmpeg fallback/isu,
	);
	assert.match(
		publication.summary,
		/512 MiB.*at-most-1-MiB.*no production browser imports, fetches, caches, or executes FFmpeg WebAssembly/isu,
	);
	assert.match(
		publication.summary,
		/Desktop Soundscaper family v1.*external ffmpeg\/ffprobe.*`libx264`.*`aac`.*`libvpx-vp9`.*`libopus`.*two-stream probe/isu,
	);
	assert.match(
		publication.summary,
		/pathless.*main-private pipes.*main-private scratch.*bundled video.*operating-system video.*AV1 remain disabled/isu,
	);
	assert.match(
		rollback.summary,
		/production browser.*exact keyed WebCodecs.*cancels Mediabunny.*disposes the producer.*aborts.*exactly once/isu,
	);
	assert.match(
		rollback.summary,
		/unsupported or composed-graph.*never falls back to FFmpeg WebAssembly.*per-block and whole-file digest.*precede one commit/isu,
	);
	assert.match(
		rollback.summary,
		/Desktop cleanup remains unchanged.*external process tree.*owner session.*main-private scratch/isu,
	);
	assert.match(
		fallback.summary,
		/only an exact keyed-frame delivery.*WebCodecs.*Mediabunny.*composed-graph.*typed unavailability.*never falls back to FFmpeg WebAssembly.*Desktop delivery/isu,
	);
});

test('Framescaper family-v1 admission and encoding reuse the existing video publication authority', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const project = findControl(
		matrix,
		'external-project-document-validation',
		'framescaper-v1-keyed-project-admission',
	);
	const authority = findControl(
		matrix,
		'external-project-document-validation',
		'framescaper-v1-keyed-export-authority',
	);
	const encoder = findControl(
		matrix,
		'long-job-cancellation',
		'bounded-keyed-rgba-av-encoding',
	);
	const publication = findControl(
		matrix,
		'desktop-write-path-capabilities',
		'exact-direct-mp4-webm-video-save',
	);
	const rollback = findControl(
		matrix,
		'long-job-cancellation',
		'direct-mp4-webm-video-save-rollback',
	);

	for (const [control, paths] of [
		[project, KEYED_PROJECT_EVIDENCE],
		[authority, KEYED_EXPORT_AUTHORITY_EVIDENCE],
		[encoder, KEYED_ENCODER_EVIDENCE],
	]) {
		for (const path of paths) {
			assert.ok(control.evidence.some((item) => item.path === path), path);
			await access(new URL(`../${path}`, import.meta.url));
		}
	}
	for (const path of [
		'src/common/editor/video-keyframe-video-encoder.ts',
		'src/common/editor/video-keyframe-mediabunny-execution.ts',
		'src/common/editor/video-mediabunny-muxer.ts',
		'tests/audio-editor-video-keyframe-mediabunny-execution.test.ts',
		'tests/audio-editor-video-mediabunny-muxer.test.ts',
	]) {
		assert.ok(publication.evidence.some((item) => item.path === path), path);
		assert.ok(rollback.evidence.some((item) => item.path === path), path);
	}

	assert.match(
		project.summary,
		/Framescaper family-v1 commands, history, repositories, render plans, and native requests.*project family.*project ID.*explicit capabilities/isu,
	);
	assert.match(
		project.summary,
		/never inferred from a bare schema number.*foreign family or future version.*opaque and read-only.*pre-release.*reject/isu,
	);
	assert.match(
		authority.summary,
		/Framescaper family-v1 export.*identity tuple.*document digest.*explicit project capabilities.*render-plan fingerprint/isu,
	);
	assert.match(
		authority.summary,
		/direct unversioned render domain.*browser and native behavior.*pre-release product generations.*no export authority/isu,
	);
	assert.match(
		encoder.summary,
		/1,280.*720.*1 through 30.*2,000,000.*1 TiB/isu,
	);
	assert.match(
		encoder.summary,
		/WebCodecs.*H\.264.*VP9.*dynamically loads Mediabunny.*AAC.*Opus.*complete container/isu,
	);
	assert.match(
		encoder.summary,
		/Missing WebCodecs.*non-keyed route.*refuses without browser FFmpeg.*512 MiB/isu,
	);
	assert.match(
		encoder.summary,
		/AbortSignal.*currentness.*audio reads.*frame production.*mux writes.*finalization.*publication/isu,
	);
	assert.match(
		encoder.summary,
		/cancels the muxer.*disposes the producer.*clears temporary output bytes/isu,
	);
	assert.match(
		encoder.summary,
		/Desktop Soundscaper family-v1 plans.*pathless.*external-FFmpeg pipes.*main-private scratch.*process-tree cancellation/isu,
	);
	assert.match(encoder.summary, /complete-container.*heap.*RSS.*GC.*CPU.*conformance.*scale.*unqualified/isu);
	assert.match(publication.summary, /publication boundaries.*production browser.*exact keyed-frame path/isu);
	assert.match(rollback.summary, /exact keyed WebCodecs.*exactly once.*whole-file digest/isu);

	assert.deepEqual(
		matrix.publicationRouteQualification.routes
			.filter(({ id }) => id.startsWith('video-'))
			.map(({ id, controlId }) => [id, controlId]),
		[
			['video-browser-blob', 'bounded-browser-export-blob-publication'],
			['video-direct-mp4', 'exact-direct-mp4-webm-video-save'],
			['video-direct-webm', 'exact-direct-mp4-webm-video-save'],
		],
		'keyed V7 is a strategy within the three existing video publication routes',
	);
});

test('the direct video fixture records exact MP4 and WebM transport without codec, memory, or scale claims', async () => {
	const budgets = JSON.parse(await readFile(budgetsUrl, 'utf8'));
	const fixture = budgets.fixtures.find(({ id }) => id === 'm2-direct-mp4-webm-video-output-v1');
	assert.ok(fixture);
	assert.equal(fixture.kind, 'deterministic-direct-mp4-webm-node-transport-witness');
	assert.equal(fixture.specification.generatorRevision, 1);
	assert.equal(fixture.specification.admittedMode, 'canonical-mp4-webm-final-video');
	assert.equal(fixture.specification.planVersion, CANONICAL_VIDEO_EXPORT_PLAN_VERSION);
	assert.deepEqual(fixture.specification.admittedFormatContracts, FORMAT_CONTRACTS);
	assert.equal(fixture.specification.preparedDestinationMode, 'exact-size-stream');
	assert.equal(fixture.specification.sourceVideoInputMode, 'WORKERFS-mounted-video-Blobs');
	assert.equal(fixture.specification.optionalAudioInputMode, 'WORKERFS-mounted-staged-WAV-Blob');
	assert.equal(fixture.specification.codecOutputMode, 'worker-MEMFS');
	assert.equal(fixture.specification.maximumOutputRangeBytes, 1_048_576);
	assert.equal(fixture.specification.transportBodyByteLength, 2_097_169);
	assert.equal(fixture.specification.transportChunkCount, 3);
	assert.deepEqual(fixture.specification.transportChunkByteLengths, [1_048_576, 1_048_576, 17]);
	assert.equal(fixture.specification.ffmpegStatCalls, 1);
	assert.equal(fixture.specification.wholeOutputReadFileCalls, 0);
	assert.equal(fixture.specification.maximumConcurrentRangeReads, 1);
	assert.equal(fixture.specification.maximumConcurrentSinkWrites, 1);
	assert.equal(fixture.specification.renderedFallbackVerificationBeforePlanAndSelection, true);
	assert.equal(fixture.specification.browserTargetPreparedBeforePreflightAndInputs, true);
	assert.equal(fixture.specification.writerOpenedAfterFfmpegStat, true);
	assert.equal(fixture.specification.desktopTargetPreparedInsideSinkOpen, true);
	assert.equal(fixture.specification.desktopSaveTargetTtlMilliseconds, 900_000);
	assert.equal(fixture.specification.closeBeforeCommitVerified, true);
	assert.equal(fixture.specification.preparedBlobFallbackRetained, true);
	assert.equal(fixture.specification.directFinalBlobCreated, false);
	assert.equal(fixture.specification.directObjectUrlCalls, 0);
	assert.equal(fixture.specification.directDownloadCalls, 0);
	assert.equal(fixture.specification.retainedFinalOutputBytes, 0);
	assert.equal(fixture.specification.partialPublishedOutputs, 0);
	for (const field of [
		'workerMemfsQualified',
		'sourceVideoBlobResidencyQualified',
		'stagedAudioBlobResidencyQualified',
		'actualFfmpegCodecExecutionQualified',
		'codecConformanceQualified',
		'nativeWasmCodecMemoryQualified',
		'rendererHeapQualified',
		'garbageCollectionQualified',
		'processRssQualified',
		'cpuQualified',
		'elapsedTimeQualified',
		'browserQualified',
		'operatingSystemQualified',
		'nativePickerQualified',
		'packagedElectronQualified',
		'referenceScaleQualified',
		'quotaQualified',
		'filesystemDurabilityQualified',
		'crashPowerLossQualified',
	]) assert.equal(Object.hasOwn(fixture.specification, field), false, field);
	assert.match(
		fixture.limitation,
		/small Node.*mock FFmpeg.*2,097,169-byte.*transport.*three.*not.*actual codecs.*conformance.*reference-scale/isu,
	);
	assert.match(
		fixture.limitation,
		/complete.*worker MEMFS.*does not bound.*source-video.*audio.*Blob residency.*codec memory.*heap.*RSS.*CPU.*elapsed time/isu,
	);
	const workload = budgets.workloads.find(({ id }) => id === 'm2-direct-mp4-webm-video-output-v1');
	assert.deepEqual(workload.fixtureIds, ['m2-direct-mp4-webm-video-output-v1']);
	assert.equal(workload.behavior, 'blocking');
	assert.equal(budgets.workloads.some(({ id }) => id === 'm2-streaming-bounded-memory'), false);
});

test('the threat and quality documents limit direct video claims to the proved transport slice', async () => {
	const [threatModel, qualityBudgets] = await Promise.all([
		readFile(new URL('../docs/production-threat-model.md', import.meta.url), 'utf8'),
		readFile(new URL('../docs/quality-budgets.md', import.meta.url), 'utf8'),
	]);
	const threatStart = threatModel.indexOf('The exact MP4 route');
	const threatEnd = threatModel.indexOf('\n### Electron renderer', threatStart);
	assert.ok(threatStart >= 0 && threatEnd > threatStart);
	const threatDocumentation = threatModel.slice(threatStart, threatEnd).replace(/\s+/gu, ' ');
	const qualityStart = qualityBudgets.indexOf('### Direct video transport diagnostic');
	const qualityEnd = qualityBudgets.indexOf('\nThe [legacy-schema refusal witness]', qualityStart);
	assert.ok(qualityStart >= 0 && qualityEnd > qualityStart);
	const qualityDocumentation = qualityBudgets.slice(qualityStart, qualityEnd).replace(/\s+/gu, ' ');

	assert.match(
		threatDocumentation,
		/exact MP4.*WebM.*production browser.*keyed-frame.*WebCodecs.*H\.264.*VP9.*Mediabunny.*AAC.*Opus.*no browser FFmpeg fallback.*Desktop Soundscaper family v1.*external ffmpeg\/ffprobe.*main-private pipes.*main-private scratch/isu,
	);
	assert.match(
		threatDocumentation,
		/bundled video.*operating-system video.*AV1 remain disabled.*external WebM is VP9.*codec conformance.*packaged UI.*scale.*memory.*RSS.*CPU.*durability.*crash.*power loss.*unqualified/isu,
	);
	assert.match(
		qualityDocumentation,
		/direct MP4 and WebM.*2,097,169-byte.*three.*1,048,576.*1,048,576.*17.*one stat.*zero.*`readFile`.*transport slice.*not codec conformance.*packaged UI.*reference-scale memory.*crash recovery.*filesystem durability/isu,
	);
});

function findControl(matrix, riskId, controlId) {
	const risk = matrix.risks.find(({ id }) => id === riskId);
	assert.ok(risk, riskId);
	const control = risk.currentControls.find(({ id }) => id === controlId);
	assert.ok(control, controlId);
	return control;
}
