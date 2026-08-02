/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const budgetsUrl = new URL('../config/quality-budgets.json', import.meta.url);

test('exact realtime MP3 publication has narrow capability and rollback controls', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const publication = findControl(
		matrix,
		'desktop-write-path-capabilities',
		'exact-direct-realtime-mp3-mix-save',
	);
	const rollback = findControl(
		matrix,
		'long-job-cancellation',
		'direct-realtime-mp3-mix-save-rollback',
	);

	for (const path of [
		'patches/npm/@ffmpeg+ffmpeg+0.12.15.patch',
		'src/common/editor/ffmpeg-output-stream.ts',
		'src/common/editor/ffmpeg.js',
		'src/common/editor/controller/direct-mp3-export.ts',
		'src/common/editor/controller/export-service.ts',
		'src/common/editor/file-save-stream.ts',
		'tests/audio-editor-ffmpeg-output-range-patch.test.js',
		'tests/audio-editor-ffmpeg-output-stream.test.ts',
		'tests/audio-editor-ffmpeg-idle.test.js',
		'tests/audio-editor-export-direct-mp3.test.ts',
	]) {
		assert.ok(publication.evidence.some((item) => item.path === path), path);
		await access(new URL(`../${path}`, import.meta.url));
	}
	for (const path of [
		'src/common/editor/ffmpeg-output-stream.ts',
		'src/common/editor/ffmpeg.js',
		'src/common/editor/controller/direct-mp3-export.ts',
		'src/common/editor/controller/export-service.ts',
		'tests/audio-editor-ffmpeg-output-stream.test.ts',
		'tests/audio-editor-ffmpeg-idle.test.js',
		'tests/audio-editor-export-direct-mp3.test.ts',
	]) assert.ok(rollback.evidence.some((item) => item.path === path), path);

	assert.match(
		publication.summary,
		/exact realtime MP3.*one mix.*`mp3`.*`audio\/mpeg`.*`\.mp3`.*FFmpeg.*128, 192, 256, or 320.*one or two.*channels/isu,
	);
	assert.match(
		publication.summary,
		/selects.*target before render.*Only after.*FFmpeg.*stat.*open.*exact-size writer.*Prepared Blob mode.*legacy.*final-Blob.*download/isu,
	);
	assert.match(
		publication.summary,
		/WAV.*WORKERFS.*worker MEMFS.*at most one MiB.*one read and write.*backpressure.*never.*whole-file `readFile`.*stat, emitted, destination-written, and committed-result.*no final renderer MP3 `Blob`.*download/isu,
	);
	assert.match(
		publication.summary,
		/269,484,049-byte.*258.*transport arithmetic and backpressure only.*not.*reference-scale.*worker MEMFS.*native or WASM codec memory.*heap.*RSS/isu,
	);
	assert.match(
		publication.summary,
		/other formats.*stems.*video.*offline.*custom FFmpeg arguments.*browser.*operating-system.*native-picker.*packaged.*durability.*crash.*power loss.*unqualified/isu,
	);
	assert.match(
		rollback.summary,
		/cancellation during FFmpeg execution.*terminates.*runtime.*before commit aborts.*unpublished destination.*exactly once.*primary.*cleanup.*AggregateError/isu,
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

test('the direct realtime MP3 fixture records transport correctness without memory or scale claims', async () => {
	const budgets = JSON.parse(await readFile(budgetsUrl, 'utf8'));
	const fixture = budgets.fixtures.find(({ id }) => id === 'm2-direct-realtime-mp3-output-v1');
	assert.ok(fixture);
	assert.equal(fixture.status, 'provisional');
	assert.equal(fixture.kind, 'deterministic-direct-realtime-mp3-node-transport-witness');
	assert.deepEqual(fixture.milestones, ['2']);
	assert.equal(fixture.specification.admittedMode, 'realtime-single-mix-mp3');
	assert.equal(fixture.specification.preparedDestinationMode, 'exact-size-stream');
	assert.equal(fixture.specification.stagingInputMode, 'WORKERFS-mounted-WAV-Blob');
	assert.equal(fixture.specification.codecOutputMode, 'worker-MEMFS');
	assert.equal(fixture.specification.maximumOutputRangeBytes, 1_048_576);
	assert.equal(fixture.specification.virtualTransportByteLength, 269_484_049);
	assert.equal(fixture.specification.virtualTransportChunkCount, 258);
	assert.equal(fixture.specification.maximumConcurrentRangeReads, 1);
	assert.equal(fixture.specification.maximumConcurrentSinkWrites, 1);
	assert.equal(fixture.specification.wholeOutputReadFileCalls, 0);
	assert.equal(fixture.specification.serviceStagingPreflightBytes, 8);
	assert.equal(fixture.specification.serviceEncodedOutputBytes, 5);
	assert.equal(fixture.specification.serviceEncodedOutputChunks, 2);
	assert.equal(fixture.specification.destinationSelectedBeforeRender, true);
	assert.equal(fixture.specification.destinationOpenedAfterFfmpegStat, true);
	assert.equal(fixture.specification.preparedBlobFallbackRetained, true);
	assert.equal(fixture.specification.directRouteDownloadCalls, 0);
	for (const field of [
		'actualFfmpegCodecExecutionQualified',
		'codecConformanceQualified',
		'workerMemfsQualified',
		'nativeWasmCodecMemoryQualified',
		'rendererHeapQualified',
		'processRssQualified',
		'browserQualified',
		'operatingSystemQualified',
		'referenceScaleQualified',
		'quotaQualified',
		'filesystemDurabilityQualified',
		'crashPowerLossQualified',
		'packagedElectronQualified',
	]) assert.equal(fixture.specification[field], false, field);
	assert.match(
		fixture.limitation,
		/small Node correctness fixture.*virtual.*(?:transport|range) arithmetic and backpressure.*does not.*actual FFmpeg codec.*reference-scale/isu,
	);
	assert.match(
		fixture.limitation,
		/complete encoded output remains.*worker MEMFS.*does not bound.*native or WASM codec memory.*heap.*RSS/isu,
	);
	assert.deepEqual(
		budgets.workloads.find(({ id }) => id === 'm2-streaming-bounded-memory')?.fixtureIds,
		['m2-streaming-project-8gib-v1', 'm2-direct-wav-385mib-v1'],
	);
	for (const path of fixture.evidence) {
		await access(new URL(`../${path.split('#')[0]}`, import.meta.url));
	}
});

test('the threat and quality documents limit direct MP3 claims to the proved transport slice', async () => {
	const [threatModel, qualityBudgets] = await Promise.all([
		readFile(new URL('../docs/production-threat-model.md', import.meta.url), 'utf8'),
		readFile(new URL('../docs/quality-budgets.md', import.meta.url), 'utf8'),
	]);

	assert.match(
		threatModel,
		/direct realtime MP3.*target before render.*exact writer.*after.*stat.*WORKERFS.*worker MEMFS.*one[- ]MiB.*backpressure.*no whole-output.*renderer.*destination close.*commit.*final renderer MP3 `Blob`/isu,
	);
	assert.match(
		threatModel,
		/worker MEMFS.*native or WASM codec memory.*reference-scale.*browser.*operating-system.*packaged.*crash.*power-loss.*unqualified/isu,
	);
	assert.match(
		qualityBudgets,
		/direct realtime MP3.*269,484,049-byte.*258.*transport arithmetic and backpressure only.*outside.*bounded-memory workload.*stays planned/isu,
	);
});

function findControl(matrix, riskId, controlId) {
	const risk = matrix.risks.find(({ id }) => id === riskId);
	assert.ok(risk, riskId);
	const control = risk.currentControls.find(({ id }) => id === controlId);
	assert.ok(control, controlId);
	return control;
}
