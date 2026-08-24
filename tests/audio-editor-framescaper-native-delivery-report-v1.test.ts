/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { addDeliveryReportItem, createDeliveryReport, sealDeliveryReport } from '../src/common/editor/delivery-report.ts';
import {
	createFramescaperNativeDeliveryReportSeedV1,
	sealFramescaperNativeDeliveryReportV1,
} from '../src/framescaper/delivery-native-report-v1.ts';

const SHA_A = 'aa'.repeat(32);
const SHA_B = 'bb'.repeat(32);
const JOB_ID = 'ab'.repeat(20);

test('native delivery reports are seeded from the exact job and sealed after verified publication', () => {
	const report = plannedReport();
	const seed = createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, planFingerprint: SHA_A, targetId: 'native-mezzanine-prores',
		profileId: 'encode-mov-prores-422-hq', captionDisposition: 'mux', plannedReport: report,
	});
	const sealed = sealFramescaperNativeDeliveryReportV1(seed, {
		status: 'succeeded',
		backendAttempts: [{ attempt: 1, backend: 'native-cpu', outcome: 'succeeded', failureCode: null }],
		conformance: [{ checkId: 'reopen', passed: true, detail: null }],
		artifacts: [{ relativePath: 'master.mov', byteLength: 4096, sha256: SHA_B }],
		publication: 'complete',
		finalReport: report,
	});
	assert.equal(sealed.jobId, JOB_ID);
	assert.equal(sealed.seedFingerprint, seed.seedFingerprint);
	assert.equal(sealed.status, 'succeeded');
	assert.equal(sealed.publication, 'complete');
	assert.equal(sealed.artifacts[0]?.sha256, SHA_B);
	assert.equal(Object.isFrozen(sealed), true);
	assert.equal(Object.isFrozen(sealed.artifacts), true);
});

test('hardware delivery permits exactly one identical-plan CPU retry and reports both attempts', () => {
	const seed = createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, planFingerprint: SHA_A, targetId: 'native-hardware-h264',
		profileId: 'encode-mp4-h264', captionDisposition: 'none', plannedReport: plannedReport(),
	});
	const sealed = sealFramescaperNativeDeliveryReportV1(seed, {
		status: 'succeeded',
		backendAttempts: [
			{ attempt: 1, backend: 'media-foundation', outcome: 'failed', failureCode: 'hardware-encode-failed' },
			{ attempt: 2, backend: 'native-cpu', outcome: 'succeeded', failureCode: null },
		],
		conformance: [{ checkId: 'duration', passed: true, detail: null }],
		artifacts: [{ relativePath: 'master.mp4', byteLength: 512, sha256: SHA_B }],
		publication: 'complete', finalReport: plannedReport(),
	});
	assert.deepEqual(sealed.backendAttempts.map(({ attempt, backend }) => [attempt, backend]), [
		[1, 'media-foundation'], [2, 'native-cpu'],
	]);
});

test('failed and web-core-required jobs never receive a false native receipt', () => {
	const seed = createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, planFingerprint: SHA_A, targetId: 'native-hardware-h264',
		profileId: 'encode-mp4-h264', captionDisposition: 'none', plannedReport: plannedReport(),
	});
	const failed = sealFramescaperNativeDeliveryReportV1(seed, {
		status: 'failed',
		backendAttempts: [{
			attempt: 1, backend: 'native-cpu', outcome: 'web-core-required', failureCode: 'web-core-required',
		}],
		conformance: [], artifacts: [], publication: 'not-published', finalReport: plannedReport(),
	});
	assert.equal(failed.status, 'failed');
	assert.equal(failed.publication, 'not-published');
	assert.deepEqual(failed.artifacts, []);

	for (const mutate of [
		(value: Record<string, unknown>) => { value.status = 'succeeded'; },
		(value: Record<string, unknown>) => { value.publication = 'complete'; },
		(value: Record<string, unknown>) => { value.artifacts = [{ relativePath: 'false.mov', byteLength: 1, sha256: SHA_B }]; },
	]) {
		const input = {
			status: 'failed',
			backendAttempts: [{
				attempt: 1, backend: 'native-cpu', outcome: 'web-core-required', failureCode: 'web-core-required',
			}],
			conformance: [], artifacts: [], publication: 'not-published', finalReport: plannedReport(),
		} as Record<string, unknown>;
		mutate(input);
		assert.throws(() => sealFramescaperNativeDeliveryReportV1(seed, input), /failed|publication|artifact|succeeded/iu);
	}
});

test('native report sealing rejects unreported conversion errors and forged retries', () => {
	const seed = createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, planFingerprint: SHA_A, targetId: 'native-mezzanine-prores',
		profileId: 'encode-mov-prores-422-hq', captionDisposition: 'mux', plannedReport: plannedReport(),
	});
	for (const backendAttempts of [
		[],
		[{ attempt: 2, backend: 'native-cpu', outcome: 'succeeded', failureCode: null }],
		[
			{ attempt: 1, backend: 'hardware', outcome: 'failed', failureCode: 'failed' },
			{ attempt: 2, backend: 'native-cpu', outcome: 'failed', failureCode: 'failed' },
			{ attempt: 3, backend: 'native-cpu', outcome: 'succeeded', failureCode: null },
		],
	]) {
		assert.throws(() => sealFramescaperNativeDeliveryReportV1(seed, {
			status: 'succeeded', backendAttempts, conformance: [],
			artifacts: [{ relativePath: 'master.mov', byteLength: 1, sha256: SHA_B }],
			publication: 'complete', finalReport: plannedReport(),
		}), /attempt|conformance/iu);
	}
});

function plannedReport() {
	const report = createDeliveryReport({
		format: 'native-mezzanine-prores', container: 'mov', codec: 'prores', lossless: false,
	});
	addDeliveryReportItem(report, {
		code: 'caption-mux', disposition: 'converted', data: { codec: 'mov_text' },
	});
	return sealDeliveryReport(report);
}
