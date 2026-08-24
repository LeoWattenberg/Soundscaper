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
	'patches/npm/@ffmpeg+ffmpeg+0.12.15.patch',
	'src/common/editor/ffmpeg-output-stream.ts',
	'src/common/editor/ffmpeg-video-output.ts',
	'src/common/editor/ffmpeg.js',
	'src/common/editor/controller/direct-video-export.ts',
	'src/common/editor/controller/direct-video-plan-contract.ts',
	'src/common/editor/controller/video-export-service.ts',
	'src/common/editor/controller/video-rendered-fallback-export.ts',
	'src/common/editor/file-service.js',
	'src/common/editor/file-save-stream.ts',
	'src/common/editor/video-export.js',
	'src/common/editor/video-ffmpeg.js',
	'desktop/save-targets.js',
	'tests/audio-editor-ffmpeg-output-range-patch.test.js',
	'tests/audio-editor-ffmpeg-output-stream.test.ts',
	'tests/audio-editor-ffmpeg-video-output.test.ts',
	'tests/audio-editor-ffmpeg-idle.test.js',
	'tests/audio-editor-export-direct-video.test.ts',
	'tests/audio-editor-direct-video-keyframe-plan-v7.test.ts',
	'tests/audio-editor-video-ffmpeg.test.js',
	'tests/audio-editor-video-rendered-fallback-export.test.ts',
	'tests/audio-editor-file-service.test.js',
	'tests/desktop-save-capacity.test.js',
	'tests/desktop-save.test.js',
]);

const ROLLBACK_EVIDENCE = Object.freeze([
	'src/common/editor/ffmpeg-output-stream.ts',
	'src/common/editor/ffmpeg-video-output.ts',
	'src/common/editor/ffmpeg.js',
	'src/common/editor/controller/direct-video-export.ts',
	'src/common/editor/controller/direct-video-plan-contract.ts',
	'src/common/editor/controller/video-export-service.ts',
	'src/common/editor/file-save-stream.ts',
	'desktop/save-targets.js',
	'tests/audio-editor-ffmpeg-output-stream.test.ts',
	'tests/audio-editor-ffmpeg-video-output.test.ts',
	'tests/audio-editor-ffmpeg-idle.test.js',
	'tests/audio-editor-export-direct-video.test.ts',
	'tests/audio-editor-direct-video-keyframe-plan-v7.test.ts',
	'tests/desktop-save-capacity.test.js',
	'tests/desktop-save.test.js',
]);

const KEYED_PROJECT_EVIDENCE = Object.freeze([
	'src/framescaper/editor-project-v20-profile.ts',
	'src/framescaper/editor-project-v20-structural-admission.ts',
	'src/framescaper/editor-project-v20-validation.ts',
	'src/framescaper/editor-project-v20.ts',
	'src/framescaper/editor-project-feature-requirements-v20.ts',
	'tests/audio-editor-framescaper-project-v20-domain.test.ts',
	'tests/audio-editor-framescaper-project-v20-feature-requirements.test.ts',
	'tests/audio-editor-framescaper-project-v20-profile.test.ts',
]);

const KEYED_EXPORT_AUTHORITY_EVIDENCE = Object.freeze([
	'src/common/editor/controller/product-video-export-strategy.ts',
	'src/common/editor/controller/video-export-service.ts',
	'src/common/editor/controller/video-export-timing.ts',
	'src/common/editor/ui/video-keyframe-offline-video-export-sources.ts',
	'src/common/editor/video-keyframe-export-inventory.ts',
	'src/common/editor/video-keyframe-export-plan-v7.ts',
	'src/common/editor/video-keyframe-export-presentation-authority.ts',
	'src/framescaper/video-export-dispatch-v20.ts',
	'src/framescaper/video-export-plan-v20.ts',
	'src/framescaper/video-export-strategy-v20.ts',
	'tests/audio-editor-product-video-export-strategy.test.ts',
	'tests/audio-editor-video-export-timing-lifecycle.test.ts',
	'tests/audio-editor-video-keyframe-offline-video-export.test.ts',
	'tests/audio-editor-video-keyframe-export-plan-v7.test.ts',
	'tests/audio-editor-framescaper-video-export-strategy-v20.test.ts',
]);

const KEYED_ENCODER_EVIDENCE = Object.freeze([
	'patches/npm/@ffmpeg+ffmpeg+0.12.15.patch',
	'src/common/editor/video-keyframe-encoder-admission.ts',
	'src/common/editor/video-keyframe-encoder-stream.ts',
	'src/common/editor/video-keyframe-audio-input.ts',
	'src/common/editor/video-keyframe-video-container-stream.ts',
	'src/common/editor/video-keyframe-video-encoder.ts',
	'src/common/editor/video-keyframe-video-operation.ts',
	'src/common/editor/video-keyframe-video-output.ts',
	'src/common/editor/video-keyframe-video-sink.ts',
	'tests/audio-editor-video-keyframe-av-encoder.test.ts',
	'tests/audio-editor-video-keyframe-encoder-stream.test.ts',
	'tests/audio-editor-video-keyframe-video-sink-encoder.test.ts',
	'tests/browser/audio-editor-video-keyframe-video-encoder.spec.js',
]);

test('exact direct MP4 and WebM publication has narrow capability and rollback controls', async () => {
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
	for (const path of [
		'src/common/editor/controller/direct-video-export.ts',
		'src/common/editor/controller/video-export-service.ts',
		'tests/audio-editor-export-direct-video.test.ts',
	]) assert.ok(fallback.evidence.some((item) => item.path === path), path);

	assert.match(
		publication.summary,
		/exact direct.*MP4.*`mp4`.*`\.mp4`.*`video\/mp4`.*WebM.*`webm`.*`\.webm`.*`video\/webm`.*purpose `video`.*safe.*version-6.*descriptor.*fingerprint.*pre-commit admission/isu,
	);
	assert.match(
		publication.summary,
		/MP4.*`libx264`.*`aac`.*`yuv420p`.*`\+faststart`.*WebM.*`libvpx-vp9`.*`libopus`.*`yuv420p`.*command facts.*not.*codec conformance/isu,
	);
	assert.match(
		publication.summary,
		/rendered-fallback.*verification.*projection.*before.*plan.*target selection.*verified.*Blob.*separate.*control/isu,
	);
	assert.match(
		publication.summary,
		/browser.*prepare.*before.*preflight.*source.*audio.*FFmpeg.*writer.*after.*stat/isu,
	);
	assert.match(
		publication.summary,
		/desktop.*prepar.*inside.*sink.*open.*after.*stat.*900,000.*TTL.*design.*not.*platform qualification/isu,
	);
	assert.match(
		publication.summary,
		/source video `Blob`.*optional.*WAV `Blob`.*WORKERFS.*complete.*worker MEMFS.*one.*stat.*monotonic.*at most one MiB.*one.*awaited.*write/isu,
	);
	assert.match(
		publication.summary,
		/exact stat.*emitted.*destination-written.*committed-result.*sink close\/seal.*commit/isu,
	);
	assert.match(
		publication.summary,
		/no.*output `readFile`.*final.*`Blob`.*Object URL.*download.*direct.*Prepared Blob mode.*legacy/isu,
	);
	assert.match(
		publication.summary,
		/worker MEMFS.*source.*audio.*Blob residency.*codec execution.*conformance.*memory.*heap.*RSS.*CPU.*elapsed time.*browser.*operating-system.*picker.*packaged.*reference scale.*quota.*durability.*crash.*power loss.*unqualified/isu,
	);

	assert.match(
		rollback.summary,
		/currentness.*verification.*plan.*target.*preflight.*source.*audio.*FFmpeg.*stat.*range.*write.*close.*pre-commit/isu,
	);
	assert.match(
		rollback.summary,
		/cancellation during FFmpeg.*terminates.*runtime.*chooser cancellation.*silent.*before commit.*abort.*unpublished.*exactly once/isu,
	);
	assert.match(
		rollback.summary,
		/output delete.*WORKERFS unmount.*mount-directory delete.*cleanup.*AggregateError.*terminates.*runtime/isu,
	);
	assert.match(
		rollback.summary,
		/close.*exact.*counts.*non-cancellable commit.*late ownership.*committed result.*(?:no|without) stale success UI.*size drift.*post-publication.*not rollback/isu,
	);
	assert.match(
		fallback.summary,
		/exact schema 17.*relationship role.*target clip ID.*canonical native Blob.*sole video input.*project-video-render-v1.*selected target input.*video-clip-render-v1.*direct MP4\/WebM route.*legacy final-Blob route.*does not add codec qualification/isu,
	);
});

test('selected keyed V20 admission and encoding reuse the existing video publication authority', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const project = findControl(
		matrix,
		'external-project-document-validation',
		'framescaper-v20-keyed-project-admission',
	);
	const authority = findControl(
		matrix,
		'external-project-document-validation',
		'exact-v20-keyed-export-authority',
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
		'src/common/editor/video-keyframe-video-container-stream.ts',
		'src/common/editor/video-keyframe-video-output.ts',
		'src/framescaper/video-export-strategy-v20.ts',
		'tests/audio-editor-video-keyframe-video-sink-encoder.test.ts',
		'tests/audio-editor-framescaper-video-export-strategy-v20.test.ts',
	]) {
		assert.ok(publication.evidence.some((item) => item.path === path), path);
		assert.ok(rollback.evidence.some((item) => item.path === path), path);
	}

	assert.match(
		project.summary,
		/exact.*V27.*process-local.*authority.*before.*traversal.*whole-document.*structural budget.*V20 keyframe\/retime.*V22 transitions.*V24 visual.*motion analyses.*caption tracks.*automation lanes.*mixer graph/isu,
	);
	assert.match(
		project.summary,
		/V20, V22 and V24.*explicit reimport.*V25\/V26.*opaque read-only.*browser.*packaged desktop.*does not claim.*qualification/isu,
	);
	assert.match(
		authority.summary,
		/selected V27 export.*canonical V27.*unified exact render plan V13.*maintained.*V20 foundation.*rederives.*refuses stale authority/isu,
	);
	assert.match(
		authority.summary,
		/preview and export.*same clip and transition resolvers.*source-domain proxy selection.*managed color.*processor stack.*caption sidecar.*automation.*mixer/isu,
	);
	assert.match(
		authority.summary,
		/active original source.*SHA-256.*before decode.*timing leases.*through encode.*publication cleanup/isu,
	);
	assert.match(
		authority.summary,
		/generation.*currentness.*AbortSignal.*external operations.*original-authoritative.*refuses.*original.*unavailable.*cleanup.*always attempted.*timing authority.*finally/isu,
	);
	assert.doesNotMatch(authority.summary, /checks.*cleanup await|fence every.*cleanup await/isu);
	assert.match(authority.summary, /no native-media.*OpenFX.*caption burn\/mux.*codec.*qualification/isu);
	assert.match(
		encoder.summary,
		/1,280.*720.*1 through 30.*2,000,000.*1 TiB/isu,
	);
	assert.match(encoder.summary, /two SharedArrayBuffer.*rings.*16 MiB/isu);
	assert.match(encoder.summary, /float32 WAV.*2 GiB.*8,000 through 768,000/isu);
	assert.match(
		encoder.summary,
		/MP4.*WebM.*SHA-256.*structurally.*second.*delivery pass.*TOCTOU/isu,
	);
	assert.match(
		encoder.summary,
		/generation.*currentness.*AbortSignal.*acquisition.*render.*encode.*output.*external operations/isu,
	);
	assert.match(
		encoder.summary,
		/cleanup.*always attempted.*aborts.*disposes.*both.*rings.*destination.*exactly once.*terminate/isu,
	);
	assert.match(encoder.summary, /preserves cleanup failures/iu);
	assert.doesNotMatch(encoder.summary, /checks.*cleanup await|fence every.*cleanup await/isu);
	assert.match(
		encoder.summary,
		/selected V27.*maintained keyed V20 encoder.*existing video routes.*does not qualify.*heap.*RSS.*GC.*CPU.*elapsed.*codec conformance.*reference scale/isu,
	);
	assert.match(publication.summary, /version-6.*or.*version-7.*keyed.*same.*video.*route/isu);
	assert.match(rollback.summary, /version-7.*keyed.*generation.*container.*digest.*exactly once/isu);

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
	assert.equal(fixture.status, 'provisional');
	assert.equal(fixture.kind, 'deterministic-direct-mp4-webm-node-transport-witness');
	assert.deepEqual(fixture.milestones, ['2']);
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
	]) assert.equal(fixture.specification[field], false, field);
	assert.match(
		fixture.limitation,
		/small Node.*mock FFmpeg.*2,097,169-byte.*transport.*three.*not.*actual codecs.*conformance.*reference-scale/isu,
	);
	assert.match(
		fixture.limitation,
		/complete.*worker MEMFS.*does not bound.*source-video.*audio.*Blob residency.*codec memory.*heap.*RSS.*CPU.*elapsed time/isu,
	);
	assert.deepEqual(
		budgets.workloads.find(({ id }) => id === 'm2-streaming-bounded-memory')?.fixtureIds,
		['m2-streaming-project-8gib-v1', 'm2-direct-wav-385mib-v1'],
	);
	for (const path of fixture.evidence) {
		await access(new URL(`../${path.split('#')[0]}`, import.meta.url));
	}
});

test('the threat and quality documents limit direct video claims to the proved transport slice', async () => {
	const [threatModel, qualityBudgets] = await Promise.all([
		readFile(new URL('../docs/production-threat-model.md', import.meta.url), 'utf8'),
		readFile(new URL('../docs/quality-budgets.md', import.meta.url), 'utf8'),
	]);
	const threatStart = threatModel.indexOf('The maintained exact direct MP4 route');
	const threatEnd = threatModel.indexOf('\n### Electron renderer', threatStart);
	assert.ok(threatStart >= 0 && threatEnd > threatStart);
	const threatDocumentation = threatModel.slice(threatStart, threatEnd).replace(/\s+/gu, ' ');
	const qualityStart = qualityBudgets.indexOf('A fifth provisional milestone 2 fixture');
	const qualityEnd = qualityBudgets.indexOf('\nThe [legacy-schema refusal witness]', qualityStart);
	assert.ok(qualityStart >= 0 && qualityEnd > qualityStart);
	const qualityDocumentation = qualityBudgets.slice(qualityStart, qualityEnd).replace(/\s+/gu, ' ');

	assert.match(
		threatDocumentation,
		/direct MP4.*WebM.*version[- ]6.*browser.*before.*preflight.*desktop.*after.*stat.*900,000.*WORKERFS.*worker MEMFS.*one.*stat.*one[- ]MiB.*close.*commit.*no.*final.*`Blob`.*legacy/isu,
	);
	assert.match(
		threatDocumentation,
		/worker MEMFS.*Blob.*residency.*codec.*conformance.*memory.*heap.*RSS.*CPU.*elapsed time.*browser.*operating[- ]system.*picker.*packaged.*reference[- ]scale.*quota.*durability.*crash.*power[- ]loss.*unqualified/isu,
	);
	assert.match(
		qualityDocumentation,
		/direct MP4 and WebM.*2,097,169-byte.*three.*1,048,576.*1,048,576.*17.*one stat.*zero.*`readFile`.*outside.*bounded-memory workload.*stays planned/isu,
	);
});

function findControl(matrix, riskId, controlId) {
	const risk = matrix.risks.find(({ id }) => id === riskId);
	assert.ok(risk, riskId);
	const control = risk.currentControls.find(({ id }) => id === controlId);
	assert.ok(control, controlId);
	return control;
}
