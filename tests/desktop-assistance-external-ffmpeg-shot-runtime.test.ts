/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	ASSISTANCE_EXTERNAL_FFMPEG_SHOT_REQUIRED_CAPABILITIES,
	ASSISTANCE_EXTERNAL_FFMPEG_SHOT_RUNTIME_MODULE_ID,
	createExternalFfmpegAssistanceShotRuntimeAdapter,
} from '../desktop/assistance-external-ffmpeg-shot-runtime.ts';
import { externalFfmpegExecutablePairClosureSha256 } from '../desktop/external-ffmpeg-node-runtime.ts';
import type {
	ExternalFfmpegPreferenceService,
	ExternalFfmpegPreferenceStatus,
	ExternalFfmpegRuntimeAdmission,
	ExternalFfmpegRuntimeInvalidationReason,
} from '../desktop/external-ffmpeg-preference-service.ts';
import {
	ExternalFfmpegShotDetectorError,
	type ExternalFfmpegShotDetector,
	type ExternalFfmpegShotDetectorOptions,
} from '../desktop/external-ffmpeg-shot-detector.ts';
import type { ExternalFfmpegShotDetectionResult } from '../desktop/external-ffmpeg-shot-detection-output.ts';

const FFMPEG = '/opt/qualified/bin/ffmpeg';
const FFPROBE = '/opt/qualified/bin/ffprobe';
const FFMPEG_SHA256 = 'a'.repeat(64);
const FFPROBE_SHA256 = 'b'.repeat(64);
const VIDEO = '/private/shot-job/source.media';
const RESULT: ExternalFfmpegShotDetectionResult = Object.freeze({
	schemaVersion: 1,
	detector: 'ffmpeg-scdet',
	timescale: 90_000,
	sourceFrameCount: 3,
	boundaries: Object.freeze([
		Object.freeze({ sourceFrame: 2, presentationTick: '6006', score: 0.425 }),
	]),
});

test('reports only an authenticated admission with every fixed-graph capability as available', async () => {
	const missing = [...ASSISTANCE_EXTERNAL_FFMPEG_SHOT_REQUIRED_CAPABILITIES.filters];
	missing.splice(missing.indexOf('scdet'), 1);
	const cases: readonly [ExternalFfmpegRuntimeAdmission | null, boolean, RegExp | null][] = [
		[null, false, /not been admitted/iu],
		[admission(), true, null],
		[admission({ filters: missing }), false, /capabilities/iu],
		[admission({ demuxers: [] }), false, /capabilities/iu],
		[admission({ muxers: [] }), false, /capabilities/iu],
		[invalidPairAdmission(), false, /identity/iu],
	];
	for (const [current, available, reason] of cases) {
		const preference = preferenceFixture(current);
		const status = await createExternalFfmpegAssistanceShotRuntimeAdapter({
			preferences: preference.service,
		}).status();
		assert.equal(status.available, available);
		assert.equal(status.moduleId, ASSISTANCE_EXTERNAL_FFMPEG_SHOT_RUNTIME_MODULE_ID);
		if (reason === null) assert.equal(status.reason, null);
		else assert.match(status.reason ?? '', reason);
		assert.deepEqual(preference.invalidations, []);
	}
});

test('projects one exact admission, hashes both executables, qualifies first, then detects in staged private storage', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-shot-runtime-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const ffmpegPath = join(root, 'ffmpeg');
	const ffprobePath = join(root, 'ffprobe');
	const videoPath = join(root, 'source.media');
	const ffmpegBytes = Buffer.from('admitted ffmpeg executable');
	const ffprobeBytes = Buffer.from('admitted ffprobe executable');
	await Promise.all([
		writeFile(ffmpegPath, ffmpegBytes),
		writeFile(ffprobePath, ffprobeBytes),
		writeFile(videoPath, 'video'),
	]);
	const admitted = admission({
		executablePath: ffmpegPath,
		ffprobePath,
		ffmpegSha256: sha256(ffmpegBytes),
		ffprobeSha256: sha256(ffprobeBytes),
	});
	const preference = preferenceFixture(admitted);
	const events: string[] = [];
	const controller = new AbortController();
	const captured: ExternalFfmpegShotDetectorOptions[] = [];
	const runtime = createExternalFfmpegAssistanceShotRuntimeAdapter({
		preferences: preference.service,
		createDetector(options) {
			captured.push(options);
			return detectorFixture({
				async qualify(request) {
					events.push('qualify');
					assert.equal(request?.signal, controller.signal);
					assert.equal(await options.digestExecutable(ffmpegPath), sha256(ffmpegBytes));
					assert.equal(await options.digestExecutable(ffprobePath), sha256(ffprobeBytes));
				},
				async detect(request) {
					events.push('detect');
					assert.deepEqual(request, { sourcePath: videoPath, signal: controller.signal });
					return RESULT;
				},
			});
		},
	});

	assert.equal(await runtime.detect({ videoPath, signal: controller.signal }), RESULT);
	assert.deepEqual(events, ['qualify', 'detect']);
	assert.equal(captured[0]?.workingDirectory, root);
	assert.deepEqual(captured[0]?.pair, {
		executablePath: ffmpegPath,
		ffmpegSha256: sha256(ffmpegBytes),
		ffprobePath,
		ffprobeSha256: sha256(ffprobeBytes),
		executablePairClosureSha256: admitted.identity.executablePairClosureSha256,
	});
	assert.deepEqual(preference.invalidations, []);
});

test('returns unavailable and quarantines the exact admission before constructing an incompatible detector', async () => {
	for (const current of [admission({ filters: [] }), invalidPairAdmission()]) {
		const preference = preferenceFixture(current);
		let factories = 0;
		const runtime = createExternalFfmpegAssistanceShotRuntimeAdapter({
			preferences: preference.service,
			createDetector() { factories += 1; return detectorFixture(); },
		});
		assert.equal(await runtime.detect({ videoPath: VIDEO }), null);
		assert.equal(factories, 0);
		assert.deepEqual(preference.invalidations, [[current, 'identity-changed']]);
	}
	const absent = preferenceFixture(null);
	assert.equal(await createExternalFfmpegAssistanceShotRuntimeAdapter({
		preferences: absent.service,
	}).detect({ videoPath: VIDEO }), null);
	assert.deepEqual(absent.invalidations, []);
});

test('turns typed qualification incompatibility into exact-admission invalidation and null', async () => {
	const cases: readonly [ExternalFfmpegShotDetectorError['reason'], ExternalFfmpegRuntimeInvalidationReason][] = [
		['canary-failed', 'identity-changed'],
		['identity-changed', 'identity-changed'],
		['metadata-invalid', 'identity-changed'],
		['metadata-limit', 'identity-changed'],
		['process-failed', 'identity-changed'],
		['process-signalled', 'identity-changed'],
		['stderr-limit', 'identity-changed'],
		['timeout', 'identity-changed'],
		['executable-unavailable', 'executable-unavailable'],
		['spawn-failed', 'executable-unavailable'],
	];
	for (const [reason, invalidationReason] of cases) {
		const admitted = admission();
		const preference = preferenceFixture(admitted);
		const runtime = runtimeFixture(preference, detectorFixture({
			qualify: () => Promise.reject(detectorError(reason)),
		}));
		assert.equal(await runtime.detect({ videoPath: VIDEO }), null, reason);
		assert.deepEqual(preference.invalidations, [[admitted, invalidationReason]], reason);
	}
});

test('returns null only for typed runtime loss during actual detection', async () => {
	const cases: readonly [ExternalFfmpegShotDetectorError['reason'], ExternalFfmpegRuntimeInvalidationReason][] = [
		['identity-changed', 'identity-changed'],
		['executable-unavailable', 'executable-unavailable'],
		['spawn-failed', 'executable-unavailable'],
	];
	for (const [reason, invalidationReason] of cases) {
		const admitted = admission();
		const preference = preferenceFixture(admitted);
		const runtime = runtimeFixture(preference, detectorFixture({
			detect: () => Promise.reject(detectorError(reason)),
		}));
		assert.equal(await runtime.detect({ videoPath: VIDEO }), null, reason);
		assert.deepEqual(preference.invalidations, [[admitted, invalidationReason]], reason);
	}
});

test('keeps malformed metadata and actual media/process failures hard', async () => {
	const reasons: readonly ExternalFfmpegShotDetectorError['reason'][] = [
		'metadata-invalid', 'metadata-limit', 'process-failed', 'process-signalled',
		'stderr-limit', 'timeout', 'canary-failed', 'request-rejected', 'unqualified', 'busy',
	];
	for (const reason of reasons) {
		const preference = preferenceFixture(admission());
		const expected = detectorError(reason);
		const runtime = runtimeFixture(preference, detectorFixture({
			detect: () => Promise.reject(expected),
		}));
		await assert.rejects(runtime.detect({ videoPath: VIDEO }), (error) => error === expected, reason);
		assert.deepEqual(preference.invalidations, [], reason);
	}
	const preference = preferenceFixture(admission());
	const malformed = new SyntaxError('bad actual shot payload');
	await assert.rejects(runtimeFixture(preference, detectorFixture({
		detect: () => Promise.reject(malformed),
	})).detect({ videoPath: VIDEO }), (error) => error === malformed);
	assert.deepEqual(preference.invalidations, []);
});

test('propagates caller cancellation exactly before, during, and after qualification', async () => {
	const before = new AbortController();
	const beforeReason = new Error('cancel before factory');
	before.abort(beforeReason);
	let factories = 0;
	const preference = preferenceFixture(admission());
	const beforeRuntime = createExternalFfmpegAssistanceShotRuntimeAdapter({
		preferences: preference.service,
		createDetector() { factories += 1; return detectorFixture(); },
	});
	await assert.rejects(beforeRuntime.detect({ videoPath: VIDEO, signal: before.signal }),
		(error) => error === beforeReason);
	assert.equal(factories, 0);

	for (const phase of ['qualify', 'detect'] as const) {
		const controller = new AbortController();
		const reason = new Error(`cancel during ${phase}`);
		const current = preferenceFixture(admission());
		const detector = detectorFixture({
			[phase]: () => {
				controller.abort(reason);
				return Promise.reject(detectorError('cancelled'));
			},
		});
		await assert.rejects(runtimeFixture(current, detector).detect({
			videoPath: VIDEO, signal: controller.signal,
		}), (error) => error === reason);
		assert.deepEqual(current.invalidations, []);
	}
});

test('withholds work when exact admission authority changes after qualification', async () => {
	const original = admission();
	const replacement = admission({
		ffmpegSha256: 'c'.repeat(64),
		ffprobeSha256: 'd'.repeat(64),
	});
	const preference = preferenceFixture(original);
	let detections = 0;
	const runtime = runtimeFixture(preference, detectorFixture({
		qualify: () => { preference.current = replacement; return Promise.resolve(); },
		detect: () => { detections += 1; return Promise.resolve(RESULT); },
	}));
	assert.equal(await runtime.detect({ videoPath: VIDEO }), null);
	assert.equal(detections, 0);
	assert.deepEqual(preference.invalidations, []);
});

test('does not hide invalidation failures or malformed adapter requests', async () => {
	const invalidationFailure = new Error('quarantine persistence failed');
	const preference = preferenceFixture(admission(), invalidationFailure);
	await assert.rejects(runtimeFixture(preference, detectorFixture({
		qualify: () => Promise.reject(detectorError('canary-failed')),
	})).detect({ videoPath: VIDEO }), (error) => error === invalidationFailure);
	const ordinaryQualificationFailure = new Error('unexpected qualification failure');
	const ordinaryPreference = preferenceFixture(admission());
	await assert.rejects(runtimeFixture(ordinaryPreference, detectorFixture({
		qualify: () => Promise.reject(ordinaryQualificationFailure),
	})).detect({ videoPath: VIDEO }), (error) => error === ordinaryQualificationFailure);
	assert.deepEqual(ordinaryPreference.invalidations, []);

	const runtime = runtimeFixture(preferenceFixture(admission()), detectorFixture());
	await assert.rejects(runtime.detect({ videoPath: 'relative/source.media' }), TypeError);
	await assert.rejects(runtime.detect({ videoPath: VIDEO, arguments: ['-version'] } as never), TypeError);
});

function runtimeFixture(preference: PreferenceFixture, detector: ExternalFfmpegShotDetector) {
	return createExternalFfmpegAssistanceShotRuntimeAdapter({
		preferences: preference.service,
		createDetector: () => detector,
	});
}

interface DetectorFixtureOverrides {
	readonly qualify?: (
		request?: Readonly<{ readonly signal?: AbortSignal }>,
	) => Promise<unknown>;
	readonly detect?: ExternalFfmpegShotDetector['detect'];
}

function detectorFixture(overrides: DetectorFixtureOverrides = {}): ExternalFfmpegShotDetector {
	return Object.freeze({
		async qualify(request?: Readonly<{ readonly signal?: AbortSignal }>) {
			await overrides.qualify?.(request);
			return Object.freeze({
				schemaVersion: 1,
				detector: 'ffmpeg-scdet',
				executablePairClosureSha256: admission().identity.executablePairClosureSha256,
				canary: Object.freeze({ sourceFrameCount: 4, boundarySourceFrame: 2 }),
			});
		},
		detect: overrides.detect ?? (() => Promise.resolve(RESULT)),
	});
}

function detectorError(reason: ExternalFfmpegShotDetectorError['reason']): ExternalFfmpegShotDetectorError {
	return new ExternalFfmpegShotDetectorError(reason, `shot detector ${reason}`);
}

interface PreferenceFixture {
	current: ExternalFfmpegRuntimeAdmission | null;
	readonly invalidations: Array<readonly [ExternalFfmpegRuntimeAdmission, ExternalFfmpegRuntimeInvalidationReason]>;
	readonly service: Pick<ExternalFfmpegPreferenceService, 'admission' | 'invalidateAdmission'>;
}

function preferenceFixture(
	initial: ExternalFfmpegRuntimeAdmission | null,
	invalidationFailure?: Error,
): PreferenceFixture {
	const fixture = {} as PreferenceFixture;
	const invalidations: PreferenceFixture['invalidations'] = [];
	Object.assign(fixture, {
		current: initial,
		invalidations,
		service: Object.freeze({
			admission: () => fixture.current,
			invalidateAdmission: async (
				expected: ExternalFfmpegRuntimeAdmission,
				reason: ExternalFfmpegRuntimeInvalidationReason,
			): Promise<ExternalFfmpegPreferenceStatus> => {
				invalidations.push([expected, reason]);
				if (invalidationFailure) throw invalidationFailure;
				if (fixture.current === expected) fixture.current = null;
				return preferenceStatus();
			},
		}),
	});
	return fixture;
}

function admission(overrides: Readonly<{
	readonly executablePath?: string;
	readonly ffprobePath?: string;
	readonly ffmpegSha256?: string;
	readonly ffprobeSha256?: string;
	readonly filters?: readonly string[];
	readonly demuxers?: readonly string[];
	readonly muxers?: readonly string[];
}> = {}): ExternalFfmpegRuntimeAdmission {
	const executablePath = overrides.executablePath ?? FFMPEG;
	const ffprobePath = overrides.ffprobePath ?? FFPROBE;
	const ffmpegSha256 = overrides.ffmpegSha256 ?? FFMPEG_SHA256;
	const ffprobeSha256 = overrides.ffprobeSha256 ?? FFPROBE_SHA256;
	const executablePairClosureSha256 = externalFfmpegExecutablePairClosureSha256({
		ffmpegPath: executablePath, ffmpegSha256, ffprobePath, ffprobeSha256,
	});
	return Object.freeze({
		executablePath,
		version: '9.0.1',
		capabilityGeneration: 'e'.repeat(64),
		identity: Object.freeze({
			version: '9.0.1', ffmpegSha256, ffprobePath, ffprobeSha256,
			executablePairClosureSha256,
		}),
		capabilities: Object.freeze({
			encoders: Object.freeze([]),
			decoders: Object.freeze([]),
			muxers: Object.freeze([...(overrides.muxers
				?? ASSISTANCE_EXTERNAL_FFMPEG_SHOT_REQUIRED_CAPABILITIES.muxers)]),
			demuxers: Object.freeze([...(overrides.demuxers
				?? ASSISTANCE_EXTERNAL_FFMPEG_SHOT_REQUIRED_CAPABILITIES.demuxers)]),
			filters: Object.freeze([...(overrides.filters
				?? ASSISTANCE_EXTERNAL_FFMPEG_SHOT_REQUIRED_CAPABILITIES.filters)]),
		}),
	});
}

function invalidPairAdmission(): ExternalFfmpegRuntimeAdmission {
	const valid = admission();
	return Object.freeze({
		...valid,
		identity: Object.freeze({ ...valid.identity, executablePairClosureSha256: 'f'.repeat(64) }),
	});
}

function preferenceStatus(): ExternalFfmpegPreferenceStatus {
	return Object.freeze({
		state: 'quarantined', location: FFMPEG, version: null,
		detail: 'quarantined', canInstall: false, canBrowse: true, canClear: true,
	});
}

function sha256(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}
