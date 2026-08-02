/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const budgetsUrl = new URL('../config/quality-budgets.json', import.meta.url);

test('exact native-PCM ZIP32 stem publication has narrow capability and rollback controls', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const publication = findControl(
		matrix,
		'desktop-write-path-capabilities',
		'exact-direct-native-pcm-zip32-stem-save',
	);
	const rollback = findControl(
		matrix,
		'long-job-cancellation',
		'direct-native-pcm-zip32-stem-save-rollback',
	);

	for (const path of [
		'src/common/editor/controller/direct-stem-archive-export.ts',
		'src/common/editor/controller/export-service.ts',
		'src/common/editor/controller/sequential-zip32-stream.ts',
		'src/common/editor/controller/zip32.ts',
		'tests/audio-editor-export-direct-stem-archive.test.ts',
		'tests/audio-editor-export-direct-stem-stream.test.ts',
		'tests/audio-editor-sequential-zip32-stream.test.ts',
	]) {
		assert.ok(publication.evidence.some((item) => item.path === path), path);
		await access(new URL(`../${path}`, import.meta.url));
	}
	for (const path of [
		'src/common/editor/controller/direct-stem-archive-export.ts',
		'src/common/editor/controller/export-service.ts',
		'src/common/editor/controller/sequential-zip32-stream.ts',
		'tests/audio-editor-export-direct-stem-stream.test.ts',
		'tests/audio-editor-sequential-zip32-stream.test.ts',
	]) assert.ok(rollback.evidence.some((item) => item.path === path), path);

	assert.match(
		publication.summary,
		/native-PCM.*exact ZIP32.*WAV, AIFF, or BWF stems.*Before target selection.*entry.*same order.*exact entry names and sizes.*recomputed.*archive byte length/isu,
	);
	assert.match(
		publication.summary,
		/Web\/Electron.*prepared exact-size streaming destination.*selects and opens.*before.*render.*per-stem staging.*temporary-storage preflight charges the largest sequential intermediate.*rather than the aggregate/isu,
	);
	assert.match(
		publication.summary,
		/source slices to 64 KiB.*awaits.*sink backpressure.*emitted bytes.*ZIP32 layout.*closes the destination.*after close.*planned, emitted, destination-written, and committed-result byte counts/isu,
	);
	assert.match(
		publication.summary,
		/Prepared Blob mode declines the direct route.*browser Blob\/download path proceeds unchanged/isu,
	);
	assert.match(
		publication.summary,
		/Compressed stems.*video.*7z.*final-Blob direct publication remain excluded/isu,
	);
	assert.match(
		publication.summary,
		/does not qualify.*browser or operating-system behavior.*reference scale/isu,
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
		rollback.summary,
		/failure.*cancellation.*cancels a pending source read.*cleans the current per-stem staging.*aborts the unpublished destination.*no commit or publication/isu,
	);
	assert.match(
		rollback.summary,
		/Destination close.*precede.*non-cancellable commit.*ownership.*committed result.*committed-result size drift.*post-publication integrity failure, not rollback/isu,
	);
	assert.match(
		rollback.summary,
		/Nested archive and service cleanup.*underlying prepared abort exactly once.*zero commit.*zero download publication/isu,
	);
});

test('the direct native-PCM ZIP32 fixture records bounded correctness without scale claims', async () => {
	const budgets = JSON.parse(await readFile(budgetsUrl, 'utf8'));
	const fixture = budgets.fixtures.find(({ id }) => id === 'm2-direct-native-pcm-zip32-stems-v1');
	assert.ok(fixture);
	assert.equal(fixture.status, 'provisional');
	assert.equal(fixture.kind, 'deterministic-direct-native-pcm-zip32-node-witness');
	assert.deepEqual(fixture.milestones, ['2']);
	assert.deepEqual(fixture.specification.admittedStemFormats, ['wav', 'aiff', 'bwf']);
	assert.equal(fixture.specification.archiveFormat, 'zip32');
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
	assert.equal(fixture.specification.directRouteBlobConstructions, 0);
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
		/small Node correctness fixture.*not reference-scale.*renderer-heap.*process-RSS.*filesystem-durability/isu,
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

	for (const path of fixture.evidence) await access(new URL(`../${path.split('#')[0]}`, import.meta.url));
});

test('the threat and quality documents state the exact slice and its exclusions', async () => {
	const [threatModel, qualityBudgets] = await Promise.all([
		readFile(new URL('../docs/production-threat-model.md', import.meta.url), 'utf8'),
		readFile(new URL('../docs/quality-budgets.md', import.meta.url), 'utf8'),
	]);

	assert.match(
		threatModel,
		/exact native-PCM ZIP32 stem.*WAV, AIFF, and BWF.*entries.*order.*sizes.*before target selection.*destination.*before render.*largest sequential intermediate.*64 KiB.*backpressure.*emitted.*closing the destination.*After close.*destination-written.*committed-result/isu,
	);
	assert.match(
		threatModel,
		/failure or cancellation.*clean.*abort.*unpublished.*Compressed.*stems.*video.*7z.*final-Blob.*fallback.*unchanged/isu,
	);
	assert.match(
		qualityBudgets,
		/direct native-PCM ZIP32\s+stem.*small focused Node correctness.*does not exercise.*browser or operating-system.*not reference-scale.*bounded-memory workload.*stays planned/isu,
	);
});

function findControl(matrix, riskId, controlId) {
	const risk = matrix.risks.find(({ id }) => id === riskId);
	assert.ok(risk, riskId);
	const control = risk.currentControls.find(({ id }) => id === controlId);
	assert.ok(control, controlId);
	return control;
}
