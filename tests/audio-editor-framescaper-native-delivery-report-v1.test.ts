/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { addDeliveryReportItem, createDeliveryReport, sealDeliveryReport } from '../src/common/editor/delivery-report.ts';
import { createNativeMediaPlanEnvelopeV2 } from '../src/common/editor/native-media-plan-envelope-v2.ts';
import {
	createFramescaperNativeDeliveryReportSeedV1,
	sealFramescaperNativeDeliveryReportV1,
} from '../src/framescaper/delivery-native-report-v1.ts';
import { createFramescaperNativeRenderPlanAuthorityV28 } from '../src/framescaper/editor-native-render-plan-authority-v28.ts';
import { createFramescaperProjectNativeMediaPlanEnvelopeV15 } from '../src/framescaper/editor-project-unified-render-delivery-v15.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV28 } from '../src/framescaper/editor-project-unified-render-plan-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import type { FramescaperCaptionDeliveryRequestV28 } from '../src/framescaper/video-caption-delivery-v28.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const SHA_B = 'bb'.repeat(32);
const JOB_ID = 'ab'.repeat(20);
const PROFILE = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
const PROJECT = createFramescaperProjectV28(PROFILE, {
	...framescaperV20Options(),
	finishing: { captionTracks: [captionTrack()] },
});
const AUTHORITY = createFramescaperNativeRenderPlanAuthorityV28(PROJECT);
const V14_ENVELOPE = createNativeMediaPlanEnvelopeV2(
	createFramescaperProjectUnifiedExactRenderPlanV28(PROFILE, PROJECT, AUTHORITY),
);
const H264_ENVELOPE = h264Envelope();

test('native delivery reports derive plan identity and caption state from one exact envelope', () => {
	const report = plannedReport();
	const envelope = v15Envelope({
		trackId: 'captions-en', mux: true, burnIn: false, sidecar: null,
	});
	const seed = createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, targetId: 'native-mezzanine-prores', envelope, plannedReport: report,
	});
	assert.equal(seed.planFingerprint, envelope.fingerprint);
	assert.equal(seed.profileId, 'encode-mov-prores-422-hq');
	assert.equal(seed.hardwarePolicy, 'native-cpu');
	assert.equal(seed.captionDisposition, 'mux');
	assert.throws(() => createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, targetId: 'native-mezzanine-prores', envelope, plannedReport: report,
		planFingerprint: 'aa'.repeat(32),
	} as never), /unsupported fields/iu);
	const tampered = structuredClone(envelope);
	(tampered as unknown as { fingerprint: string }).fingerprint = 'aa'.repeat(32);
	assert.throws(() => createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, targetId: 'native-mezzanine-prores', envelope: tampered, plannedReport: report,
	}), /fingerprint.*derived/iu);
	assert.throws(() => createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, targetId: 'native-mezzanine-prores', envelope: envelope.plan, plannedReport: report,
	}), /envelopeVersion|envelope version/iu);
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
		jobId: JOB_ID, targetId: 'native-hardware-h264',
		envelope: H264_ENVELOPE, plannedReport: reportWithItems([]),
	});
	assert.equal(seed.profileId, 'encode-mp4-h264');
	assert.equal(seed.hardwarePolicy, 'hardware-first-identical-cpu-retry');
	const sealed = sealFramescaperNativeDeliveryReportV1(seed, {
		status: 'succeeded',
		backendAttempts: [
			{ attempt: 1, backend: 'media-foundation', outcome: 'failed', failureCode: 'hardware-encode-failed' },
			{ attempt: 2, backend: 'native-cpu', outcome: 'succeeded', failureCode: null },
		],
		conformance: [{ checkId: 'duration', passed: true, detail: null }],
		artifacts: [{ relativePath: 'master.mp4', byteLength: 512, sha256: SHA_B }],
		publication: 'complete', finalReport: reportWithItems([]),
	});
	assert.deepEqual(sealed.backendAttempts.map(({ attempt, backend }) => [attempt, backend]), [
		[1, 'media-foundation'], [2, 'native-cpu'],
	]);
});

test('native report policy refuses arbitrary targets, profile mismatches, and hardware on CPU-only targets', () => {
	for (const [targetId, envelope] of [
		['native-hardware-h264', V14_ENVELOPE],
		['native-mezzanine-prores', H264_ENVELOPE],
		['web-1080p', H264_ENVELOPE],
		['invented-native-target', H264_ENVELOPE],
	] as const) {
		assert.throws(() => createFramescaperNativeDeliveryReportSeedV1({
			jobId: JOB_ID, targetId, envelope, plannedReport: reportWithItems([]),
		}), /target|profile|native-media-v15/iu);
	}
	const cpuSeed = createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, targetId: 'native-mezzanine-prores',
		envelope: V14_ENVELOPE, plannedReport: reportWithItems([]),
	});
	for (const backendAttempts of [
		[{ attempt: 1, backend: 'media-foundation', outcome: 'succeeded', failureCode: null }],
		[
			{ attempt: 1, backend: 'media-foundation', outcome: 'failed', failureCode: 'hardware-encode-failed' },
			{ attempt: 2, backend: 'native-cpu', outcome: 'succeeded', failureCode: null },
		],
	]) {
		assert.throws(() => sealFramescaperNativeDeliveryReportV1(cpuSeed, {
			status: 'succeeded', backendAttempts,
			conformance: [{ checkId: 'duration', passed: true, detail: null }],
			artifacts: [{ relativePath: 'master.mov', byteLength: 512, sha256: SHA_B }],
			publication: 'complete', finalReport: reportWithItems([]),
		}), /hardware policy|native-cpu|retry/iu);
	}
});

test('failed and web-core-required jobs never receive a false native receipt', () => {
	const seed = createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, targetId: 'native-mezzanine-prores',
		envelope: V14_ENVELOPE, plannedReport: plannedReport(),
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
		jobId: JOB_ID, targetId: 'native-mezzanine-prores',
		envelope: V14_ENVELOPE, plannedReport: plannedReport(),
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

test('native delivery reports represent every selected caption delivery combination', () => {
	const combinations: readonly [
		Omit<FramescaperCaptionDeliveryRequestV28, 'trackId'>,
		string,
	][] = [
		[{ mux: true, burnIn: false, sidecar: null }, 'mux'],
		[{ mux: false, burnIn: true, sidecar: null }, 'burn-in'],
		[{ mux: false, burnIn: false, sidecar: 'srt' }, 'sidecar'],
		[{ mux: true, burnIn: true, sidecar: null }, 'mux-and-burn-in'],
		[{ mux: true, burnIn: false, sidecar: 'srt' }, 'mux-and-sidecar'],
		[{ mux: false, burnIn: true, sidecar: 'srt' }, 'burn-in-and-sidecar'],
		[{ mux: true, burnIn: true, sidecar: 'srt' }, 'mux-and-burn-in-and-sidecar'],
	];
	assert.equal(createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, targetId: 'native-mezzanine-prores',
		envelope: V14_ENVELOPE, plannedReport: plannedReport(),
	}).captionDisposition, 'none');
	for (const [request, expected] of combinations) {
		const seed = createFramescaperNativeDeliveryReportSeedV1({
			jobId: JOB_ID, targetId: 'native-mezzanine-prores',
			envelope: v15Envelope({ trackId: 'captions-en', ...request }),
			plannedReport: plannedReport(),
		});
		assert.equal(seed.captionDisposition, expected);
	}
});

test('native report sealing preserves every planned conversion item exactly', () => {
	const planned = plannedReport();
	const seed = createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, targetId: 'native-mezzanine-prores',
		envelope: V14_ENVELOPE, plannedReport: planned,
	});
	const base = {
		status: 'succeeded' as const,
		backendAttempts: [{ attempt: 1, backend: 'native-cpu', outcome: 'succeeded', failureCode: null }],
		conformance: [{ checkId: 'reopen', passed: true, detail: null }],
		artifacts: [{ relativePath: 'master.mov', byteLength: 4096, sha256: SHA_B }],
		publication: 'complete' as const,
	};
	assert.throws(() => sealFramescaperNativeDeliveryReportV1(seed, {
		...base, finalReport: reportWithItems([]),
	}), /planned.*report item|drop/iu);
	assert.throws(() => sealFramescaperNativeDeliveryReportV1(seed, {
		...base,
		finalReport: reportWithItems([{
			code: 'caption-mux', disposition: 'converted', data: { codec: 'webvtt' },
		}]),
	}), /planned.*report item|chang/iu);
	const extended = sealFramescaperNativeDeliveryReportV1(seed, {
		...base,
		finalReport: reportWithItems([
			{ code: 'caption-mux', disposition: 'converted', data: { codec: 'mov_text' } },
			{ code: 'native-reopen', disposition: 'preserved', data: { passed: true } },
		]),
	});
	assert.equal(extended.report.items.length, 2);
});

function plannedReport() {
	return reportWithItems([{
		code: 'caption-mux', disposition: 'converted', data: { codec: 'mov_text' },
	}]);
}

function reportWithItems(items: readonly Readonly<{
	readonly code: string;
	readonly disposition: 'preserved' | 'converted' | 'missing' | 'omitted';
	readonly data: Readonly<Record<string, unknown>>;
}>[]) {
	const report = createDeliveryReport({
		format: 'native-mezzanine-prores', container: 'mov', codec: 'prores', lossless: false,
	});
	for (const item of items) addDeliveryReportItem(report, item);
	return sealDeliveryReport(report);
}

function v15Envelope(request: FramescaperCaptionDeliveryRequestV28) {
	return createFramescaperProjectNativeMediaPlanEnvelopeV15(
		PROFILE, PROJECT, AUTHORITY, {
			deliveryProfile: 'encode-mov-prores-422-hq', captionRequest: request,
		},
	);
}

function h264Envelope() {
	const plan = structuredClone(V14_ENVELOPE.plan) as unknown as Record<string, unknown>;
	plan.deliveryProfile = 'encode-mp4-h264';
	plan.format = { container: 'mp4', extension: 'mp4', mimeType: 'video/mp4' };
	plan.codecs = {
		video: 'h264', videoEncoder: 'libx264', audio: 'aac', audioEncoder: 'aac', pixelFormat: 'yuv420p',
	};
	const output = plan.output as Record<string, unknown>;
	output.canvas = {
		...(output.canvas as Record<string, unknown>), pixelFormat: 'yuv420p',
	};
	return createNativeMediaPlanEnvelopeV2(plan);
}

function captionTrack(): Record<string, unknown> {
	return {
		schemaVersion: 1, id: 'captions-en', sequenceId: 'main-sequence', name: 'English',
		language: 'en', styles: [], regions: [], speakers: [], cues: [{
			schemaVersion: 1, id: 'cue-1', startFrame: 0, endFrame: 48_000, text: 'Caption',
			styleId: null, regionId: null, speakerId: null, words: [],
		}],
	};
}
