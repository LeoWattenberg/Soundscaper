/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { addDeliveryReportItem, createDeliveryReport, sealDeliveryReport } from '../src/common/editor/delivery-report.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { createNativeMediaPlanEnvelopeV2 } from '../src/common/editor/native-media-plan-envelope-v2.ts';
import {
	createFramescaperNativeDeliveryReportSeedV1,
	sealFramescaperNativeDeliveryReportV1,
} from '../src/framescaper/delivery-native-report-v1.ts';
import { createFramescaperNativeRenderPlanAuthorityV28 } from '../src/framescaper/editor-native-render-plan-authority-v28.ts';
import {
	createFramescaperProjectUnifiedRenderDeliveryBundleV15,
} from '../src/framescaper/editor-project-unified-render-delivery-v15.ts';
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
	const bundle = v15Bundle({
		trackId: 'captions-en', mux: true, burnIn: false, sidecar: null,
	});
	const envelope = bundle.envelope;
	const seed = createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, targetId: 'native-mezzanine-prores', envelope,
		deliveryBundle: bundle, plannedReport: report,
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
		jobId: JOB_ID, targetId: 'native-mezzanine-prores', envelope: tampered,
		deliveryBundle: Object.freeze({ ...bundle, envelope: tampered, plan: tampered.plan }),
		plannedReport: report,
	}), /fingerprint.*derived/iu);
	assert.throws(() => createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, targetId: 'native-mezzanine-prores', envelope: envelope.plan, plannedReport: report,
	}), /envelopeVersion|envelope version/iu);
	assert.throws(() => createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, targetId: 'native-mezzanine-prores', envelope, plannedReport: report,
	}), /V15.*bundle|bundle/iu);
	assert.throws(() => createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, targetId: 'native-mezzanine-prores', envelope,
		deliveryBundle: Object.freeze({ ...bundle, plan: structuredClone(bundle.plan) }),
		plannedReport: report,
	}), /bundle plan|envelope plan/iu);
	const sealed = sealFramescaperNativeDeliveryReportV1(
		seed, successfulResult(seed, report), { envelope, deliveryBundle: bundle },
	);
	assert.equal(sealed.jobId, JOB_ID);
	assert.equal(sealed.seedFingerprint, seed.seedFingerprint);
	assert.equal(sealed.status, 'succeeded');
	assert.equal(sealed.publication, 'complete');
	assert.equal(sealed.artifacts[0]?.sha256, SHA_B);
	assert.equal(Object.isFrozen(sealed), true);
	assert.equal(Object.isFrozen(sealed.artifacts), true);
});

test('V15 success closes the exact derived artifact manifest and conformance inventory', () => {
	const bundle = v15Bundle({
		trackId: 'captions-en', mux: true, burnIn: false, sidecar: 'srt',
	});
	const seed = createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, targetId: 'native-mezzanine-prores',
		envelope: bundle.envelope, deliveryBundle: bundle, plannedReport: plannedReport(),
	});
	const sidecar = bundle.captionAdapter!.sidecarDocument!;
	const changedAdapter = Object.freeze({
		...bundle.captionAdapter!,
		sidecarDocument: Object.freeze({ ...sidecar, text: `${sidecar.text}\nsubstituted` }),
	});
	assert.throws(() => createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, targetId: 'native-mezzanine-prores', envelope: bundle.envelope,
		deliveryBundle: Object.freeze({ ...bundle, captionAdapter: changedAdapter }),
		plannedReport: plannedReport(),
	}), /caption sidecar document digest/iu);
	assert.deepEqual(seed.requiredArtifactManifest, [{
		artifactId: 'picture-master', kind: 'file', relativePath: 'master.mov',
		expectedByteLength: null, expectedSha256: null,
	}, {
		artifactId: 'caption-sidecar', kind: 'file', relativePath: 'captions.srt',
		expectedByteLength: new TextEncoder().encode(sidecar.text).byteLength,
		expectedSha256: sidecar.sha256,
	}]);
	assert.deepEqual(seed.requiredConformanceCheckIds, [
		'artifact-integrity:caption-sidecar',
		'artifact-integrity:picture-master',
		'caption-mux-document',
		'caption-sidecar-document',
		'container-reopen',
		'embedded-audio',
		'picture-codec',
		'picture-duration',
		'picture-frame-count',
		'picture-geometry',
		'picture-pixel-format',
		'publication-atomic',
		'target-profile',
	]);

	const closure = { envelope: bundle.envelope, deliveryBundle: bundle };
	const valid = successfulResult(seed, plannedReport());
	assert.doesNotThrow(() => sealFramescaperNativeDeliveryReportV1(seed, valid, closure));
	for (const [label, mutate] of [
		['missing artifact', (value: Record<string, unknown>) => {
			(value.artifacts as unknown[]).pop();
		}],
		['extra artifact', (value: Record<string, unknown>) => {
			(value.artifacts as unknown[]).push({
				artifactId: 'invented', kind: 'file', relativePath: 'invented.mov',
				byteLength: 1, sha256: SHA_B,
			});
		}],
		['artifact ID substitution', (value: Record<string, unknown>) => {
			((value.artifacts as Record<string, unknown>[])[0]!).artifactId = 'invented';
		}],
		['artifact path substitution', (value: Record<string, unknown>) => {
			((value.artifacts as Record<string, unknown>[])[1]!).relativePath = 'other.srt';
		}],
		['known artifact digest substitution', (value: Record<string, unknown>) => {
			((value.artifacts as Record<string, unknown>[])[1]!).sha256 = SHA_B;
		}],
		['missing conformance', (value: Record<string, unknown>) => {
			(value.conformance as unknown[]).pop();
		}],
		['extra conformance', (value: Record<string, unknown>) => {
			(value.conformance as unknown[]).push({ checkId: 'invented', passed: true, detail: null });
		}],
		['conformance ID substitution', (value: Record<string, unknown>) => {
			((value.conformance as Record<string, unknown>[])[0]!).checkId = 'invented';
		}],
	] as const) {
		const changed = structuredClone(valid) as Record<string, unknown>;
		mutate(changed);
		assert.throws(
			() => sealFramescaperNativeDeliveryReportV1(seed, changed, closure),
			/artifact|conformance|closure|manifest/iu,
			label,
		);
	}
	const forgedSeed = structuredClone(seed);
	(forgedSeed.requiredConformanceCheckIds as string[]).pop();
	assert.throws(
		() => sealFramescaperNativeDeliveryReportV1(forgedSeed, valid, closure),
		/seed.*exact derived|fingerprint/iu,
	);
});

test('hardware delivery permits exactly one identical-plan CPU retry and reports both attempts', () => {
	const seed = createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, targetId: 'native-hardware-h264',
		envelope: H264_ENVELOPE, plannedReport: reportWithItems([]),
	});
	assert.equal(seed.profileId, 'encode-mp4-h264');
	assert.equal(seed.hardwarePolicy, 'hardware-first-identical-cpu-retry');
	const sealed = sealFramescaperNativeDeliveryReportV1(seed, {
		...successfulResult(seed, reportWithItems([])),
		backendAttempts: [
			{ attempt: 1, backend: 'media-foundation', outcome: 'failed', failureCode: 'hardware-encode-failed' },
			{ attempt: 2, backend: 'native-cpu', outcome: 'succeeded', failureCode: null },
		],
	}, { envelope: H264_ENVELOPE });
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
		}, { envelope: V14_ENVELOPE }), /hardware policy|native-cpu|retry/iu);
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
	}, { envelope: V14_ENVELOPE });
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
		assert.throws(
			() => sealFramescaperNativeDeliveryReportV1(seed, input, { envelope: V14_ENVELOPE }),
			/failed|publication|artifact|succeeded/iu,
		);
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
		}, { envelope: V14_ENVELOPE }), /attempt|conformance/iu);
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
		const bundle = v15Bundle({ trackId: 'captions-en', ...request });
		const seed = createFramescaperNativeDeliveryReportSeedV1({
			jobId: JOB_ID, targetId: 'native-mezzanine-prores',
			envelope: bundle.envelope, deliveryBundle: bundle,
			plannedReport: plannedReport(),
		});
		assert.equal(seed.captionDisposition, expected);
		assert.equal(seed.requiredConformanceCheckIds.includes('caption-mux-document'), request.mux);
		assert.equal(seed.requiredConformanceCheckIds.includes('caption-burn-plan'), request.burnIn);
		assert.equal(seed.requiredConformanceCheckIds.includes('caption-sidecar-document'), request.sidecar !== null);
		assert.equal(
			seed.requiredArtifactManifest.some(({ artifactId }) => artifactId === 'caption-sidecar'),
			request.sidecar !== null,
		);
	}
});

test('image-sequence closure requires its tree and exact companion-audio artifact', () => {
	const delivery = {
		kind: 'image-sequence' as const,
		format: 'png' as const,
		frameRate: { num: 24, den: 1 },
		preserveAlpha: true as const,
	};
	const authority = createFramescaperNativeRenderPlanAuthorityV28(PROJECT, delivery);
	const bundle = createFramescaperProjectUnifiedRenderDeliveryBundleV15(
		PROFILE, PROJECT, authority, {
			deliveryProfile: 'encode-png-sequence',
			companionAudio: { formatId: 'bwf', sampleFormat: 'int24' },
		},
	);
	const seed = createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, targetId: 'native-image-sequence-png',
		envelope: bundle.envelope, deliveryBundle: bundle, plannedReport: reportWithItems([]),
	});
	assert.deepEqual(seed.requiredArtifactManifest.map(({ artifactId, kind, relativePath }) => ({
		artifactId, kind, relativePath,
	})), [{
		artifactId: 'picture-sequence', kind: 'directory', relativePath: 'frames',
	}, {
		artifactId: 'companion-audio', kind: 'file', relativePath: 'audio.wav',
	}]);
	assert.equal(seed.requiredConformanceCheckIds.includes('image-sequence-tree'), true);
	assert.equal(seed.requiredConformanceCheckIds.includes('companion-audio-plan'), true);
	assert.throws(() => createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, targetId: 'native-image-sequence-png', envelope: bundle.envelope,
		deliveryBundle: Object.freeze({
			...bundle,
			companionAudioBundle: Object.freeze({
				...bundle.companionAudioBundle!,
				authorityPayload: `${bundle.companionAudioBundle!.authorityPayload} `,
			}),
		}),
		plannedReport: reportWithItems([]),
	}), /companion-audio authority payload/iu);
	assert.doesNotThrow(() => sealFramescaperNativeDeliveryReportV1(
		seed, successfulResult(seed, reportWithItems([])), { envelope: bundle.envelope, deliveryBundle: bundle },
	));
});

test('native report sealing preserves every planned conversion item exactly', () => {
	const planned = plannedReport();
	const seed = createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, targetId: 'native-mezzanine-prores',
		envelope: V14_ENVELOPE, plannedReport: planned,
	});
	const base = successfulResult(seed, planned);
	assert.throws(() => sealFramescaperNativeDeliveryReportV1(seed, {
		...base, finalReport: reportWithItems([]),
	}, { envelope: V14_ENVELOPE }), /planned.*report item|drop/iu);
	assert.throws(() => sealFramescaperNativeDeliveryReportV1(seed, {
		...base,
		finalReport: reportWithItems([{
			code: 'caption-mux', disposition: 'converted', data: { codec: 'webvtt' },
		}]),
	}, { envelope: V14_ENVELOPE }), /planned.*report item|chang/iu);
	const extended = sealFramescaperNativeDeliveryReportV1(seed, {
		...base,
		finalReport: reportWithItems([
			{ code: 'caption-mux', disposition: 'converted', data: { codec: 'mov_text' } },
			{ code: 'native-reopen', disposition: 'preserved', data: { passed: true } },
		]),
	}, { envelope: V14_ENVELOPE });
	assert.equal(extended.report.items.length, 2);
});

test('sealing refuses a re-fingerprinted seed whose inventory is not the plan closure', () => {
	// The seed fingerprint proves self-consistency, never custody: a forged
	// seed can drop the sidecar from its manifest and check inventory, then
	// re-fingerprint itself and pair with an equally impoverished result.
	// Only re-deriving the closure from the envelope at seal time catches it.
	const bundle = v15Bundle({ trackId: 'captions-en', mux: false, burnIn: false, sidecar: 'srt' });
	const closure = { envelope: bundle.envelope, deliveryBundle: bundle };
	const seed = createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, targetId: 'native-mezzanine-prores',
		envelope: bundle.envelope, deliveryBundle: bundle, plannedReport: plannedReport(),
	});
	const foundation = structuredClone(seed) as unknown as Record<string, unknown>;
	delete foundation.seedFingerprint;
	foundation.requiredArtifactManifest = seed.requiredArtifactManifest
		.filter(({ artifactId }) => artifactId !== 'caption-sidecar');
	foundation.requiredConformanceCheckIds = seed.requiredConformanceCheckIds
		.filter((checkId) => !checkId.includes('sidecar'));
	const forged = Object.freeze({
		...foundation, seedFingerprint: fingerprintNativeMediaPlan(foundation).sha256,
	});
	const impoverished = successfulResult(
		forged as unknown as ReturnType<typeof createFramescaperNativeDeliveryReportSeedV1>,
		plannedReport(),
	);
	assert.throws(
		() => sealFramescaperNativeDeliveryReportV1(forged, impoverished, closure),
		/not bound to its plan envelope closure/u,
	);
});

test('a burn-in delivery cannot seal while silent about what it cannot draw', () => {
	// The web delivery inventory names undrawable characters and overlapping
	// cues; a native burn-in that stays silent about blanks in its own picture
	// is exactly the hidden conversion the delivery gate forbids.
	const project = createFramescaperProjectV28(PROFILE, {
		...framescaperV20Options(),
		finishing: { captionTracks: [{
			...captionTrack(),
			cues: [{
				schemaVersion: 1, id: 'cue-1', startFrame: 0, endFrame: 48_000, text: '漢字',
				styleId: null, regionId: null, speakerId: null, words: [],
			}, {
				schemaVersion: 1, id: 'cue-2', startFrame: 24_000, endFrame: 72_000, text: 'Overlap',
				styleId: null, regionId: null, speakerId: null, words: [],
			}],
		}] },
	});
	const authority = createFramescaperNativeRenderPlanAuthorityV28(project);
	const bundle = createFramescaperProjectUnifiedRenderDeliveryBundleV15(PROFILE, project, authority, {
		deliveryProfile: 'encode-mov-prores-422-hq',
		captionRequest: { trackId: 'captions-en', mux: false, burnIn: true, sidecar: null },
	});
	assert.throws(() => createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, targetId: 'native-mezzanine-prores',
		envelope: bundle.envelope, deliveryBundle: bundle, plannedReport: plannedReport(),
	}), /delivery\.captions-(undrawable|overlapping) disclosure/u);

	const disclosed = reportWithItems([{
		code: 'delivery.captions-overlapping', disposition: 'converted', severity: 'warning',
		scope: { kind: 'track', id: 'captions-en' }, data: { trackId: 'captions-en' },
	}, {
		code: 'delivery.captions-undrawable', disposition: 'omitted', severity: 'warning',
		scope: { kind: 'track', id: 'captions-en' },
		data: { trackId: 'captions-en', characters: '漢字' },
	}]);
	const seed = createFramescaperNativeDeliveryReportSeedV1({
		jobId: JOB_ID, targetId: 'native-mezzanine-prores',
		envelope: bundle.envelope, deliveryBundle: bundle, plannedReport: disclosed,
	});
	const sealed = sealFramescaperNativeDeliveryReportV1(
		seed, successfulResult(seed, disclosed), { envelope: bundle.envelope, deliveryBundle: bundle },
	);
	assert.equal(
		sealed.report.items.filter(({ code }) => code.startsWith('delivery.captions-')).length,
		2,
	);
});

function plannedReport() {
	return reportWithItems([{
		code: 'caption-mux', disposition: 'converted', data: { codec: 'mov_text' },
	}]);
}

function reportWithItems(items: readonly Readonly<{
	readonly code: string;
	readonly disposition: 'preserved' | 'converted' | 'missing' | 'omitted';
	readonly severity?: 'info' | 'warning' | 'error';
	readonly scope?: Readonly<Record<string, unknown>>;
	readonly data: Readonly<Record<string, unknown>>;
}>[]) {
	const report = createDeliveryReport({
		format: 'native-mezzanine-prores', container: 'mov', codec: 'prores', lossless: false,
	});
	for (const item of items) addDeliveryReportItem(report, item);
	return sealDeliveryReport(report);
}

function v15Bundle(request: FramescaperCaptionDeliveryRequestV28) {
	return createFramescaperProjectUnifiedRenderDeliveryBundleV15(
		PROFILE, PROJECT, AUTHORITY, {
			deliveryProfile: 'encode-mov-prores-422-hq', captionRequest: request,
		},
	);
}

function successfulResult(
	seed: ReturnType<typeof createFramescaperNativeDeliveryReportSeedV1>,
	finalReport: ReturnType<typeof plannedReport>,
) {
	return {
		status: 'succeeded' as const,
		backendAttempts: [{ attempt: 1, backend: 'native-cpu', outcome: 'succeeded', failureCode: null }],
		conformance: seed.requiredConformanceCheckIds.map((checkId) => ({
			checkId, passed: true, detail: null,
		})),
		artifacts: seed.requiredArtifactManifest.map((artifact) => ({
			artifactId: artifact.artifactId,
			kind: artifact.kind,
			relativePath: artifact.relativePath,
			byteLength: artifact.expectedByteLength ?? 4_096,
			sha256: artifact.expectedSha256 ?? SHA_B,
		})),
		publication: 'complete' as const,
		finalReport,
	};
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
