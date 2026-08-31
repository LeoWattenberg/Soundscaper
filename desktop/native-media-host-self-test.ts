/* SPDX-License-Identifier: AGPL-3.0-only */

/** Runs the pinned host self-test through the verified OS launcher. */

import type { FramescaperMediaHostDescriptor } from './framescaper-media-host-payload.ts';
import { authenticateNativeMediaFile } from './native-media-file-auth.ts';
import {
	runIsolatedNativeMediaHostControl,
	type IsolatedNativeMediaHostControlResult,
} from './native-media-isolated-host-process.ts';

export interface FramescaperMediaHostSelfTestResult {
	readonly contractVersion: 1;
	readonly ffmpeg: '9.0.1';
	readonly networkInitialized: false;
	readonly versionsMatch: true;
	readonly exactRetimeMatches: true;
	readonly proresProxyEncoderPresent: true;
	readonly professionalCharacteristicsMatches: true;
}

export interface FramescaperMediaHostSelectedV20RenderSelfTestResult {
	readonly contractVersion: 1;
	readonly operation: 'media-render';
	readonly profile: 'selected-v20-v7-v8';
	readonly planVersions: readonly [7, 8];
	readonly exactPictureOrdinals: boolean;
	readonly keyedEvaluatedRgbaExecutor: boolean;
	readonly staticCompositionExecutor: boolean;
	readonly maximumInFlightFrames: 0 | 1;
	readonly evaluatedRgbaInputBound: boolean;
	readonly staticGeometryAdapterBound: boolean;
	readonly captionDeliveryAdapterBound: boolean;
	readonly stagedAudioInputBound: boolean;
	readonly deliveryCodecSetAvailable: boolean;
	readonly frameCoreReady: boolean;
	readonly ready: boolean;
}

export interface FramescaperMediaHostSelectedV28V14RenderSelfTestResult {
	readonly contractVersion: 1;
	readonly operation: 'media-render';
	readonly profile: 'selected-v28-v14-carrier';
	readonly planVersion: 14;
	readonly rgbaFramePackVersion: 1;
	readonly exactPictureOrdinals: boolean;
	readonly evaluatedRgbaExecutor: boolean;
	readonly maximumInFlightFrames: 0 | 1;
	readonly stagedAudioInputBound: boolean;
	readonly deliveryCodecSetAvailable: boolean;
	readonly ready: boolean;
}

export const FRAMESCAPER_MEDIA_HOST_SELF_TEST_TIMEOUT_MS = 30_000;
const FRAMESCAPER_MEDIA_HOST_SELF_TEST_TIMEOUT_MAXIMUM_MS = 60_000;

export interface FramescaperMediaHostSelfTestOptions {
	readonly timeoutMs?: number;
	/** Test-only process seam. Production always uses the branded isolated launcher. */
	readonly invokeControl?: (
		descriptor: FramescaperMediaHostDescriptor,
		arguments_: readonly string[],
		maximumDurationMs: number,
	) => Promise<IsolatedNativeMediaHostControlResult>;
}

export function assertFramescaperMediaHostSelfTest(
	value: unknown,
): asserts value is FramescaperMediaHostSelfTestResult {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('The Framescaper media-host self-test must return one plain record.');
	}
	const record = value as Record<string, unknown>;
	const expected = [
		'contractVersion', 'ffmpeg', 'networkInitialized', 'versionsMatch', 'exactRetimeMatches',
		'proresProxyEncoderPresent', 'professionalCharacteristicsMatches',
	].sort();
	const actual = Object.keys(record).sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])
		|| record.contractVersion !== 1 || record.ffmpeg !== '9.0.1'
		|| record.networkInitialized !== false || record.versionsMatch !== true
		|| record.exactRetimeMatches !== true || record.proresProxyEncoderPresent !== true
		|| record.professionalCharacteristicsMatches !== true) {
		throw new TypeError(
			'The Framescaper media-host FFmpeg, retime, proxy, and professional-probe self-test did not pass.',
		);
	}
}

export function assertFramescaperMediaHostSelectedV20RenderSelfTest(
	value: unknown,
): asserts value is FramescaperMediaHostSelectedV20RenderSelfTestResult {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('The selected-V20 media-render self-test must return one plain record.');
	}
	const record = value as Record<string, unknown>;
	const expected = [
		'contractVersion', 'operation', 'profile', 'planVersions', 'exactPictureOrdinals',
		'keyedEvaluatedRgbaExecutor', 'staticCompositionExecutor', 'maximumInFlightFrames',
		'evaluatedRgbaInputBound', 'staticGeometryAdapterBound', 'captionDeliveryAdapterBound',
		'stagedAudioInputBound',
		'deliveryCodecSetAvailable', 'frameCoreReady', 'ready',
	].sort();
	const actual = Object.keys(record).sort();
	const plans = record.planVersions;
	const booleans = [
		record.exactPictureOrdinals, record.keyedEvaluatedRgbaExecutor,
		record.staticCompositionExecutor, record.evaluatedRgbaInputBound,
		record.staticGeometryAdapterBound, record.captionDeliveryAdapterBound,
		record.stagedAudioInputBound,
		record.deliveryCodecSetAvailable, record.frameCoreReady, record.ready,
	];
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])
		|| record.contractVersion !== 1 || record.operation !== 'media-render'
		|| record.profile !== 'selected-v20-v7-v8'
		|| !Array.isArray(plans) || plans.length !== 2 || plans[0] !== 7 || plans[1] !== 8
		|| booleans.some((entry) => typeof entry !== 'boolean')
		|| (record.maximumInFlightFrames !== 0 && record.maximumInFlightFrames !== 1)) {
		throw selectedV20SelfTestError();
	}
	const frameCoreReady = record.exactPictureOrdinals === true
		&& record.keyedEvaluatedRgbaExecutor === true
		&& record.staticCompositionExecutor === true
		&& record.maximumInFlightFrames === 1;
	const ready = frameCoreReady && record.evaluatedRgbaInputBound === true
		&& record.staticGeometryAdapterBound === true
		&& record.captionDeliveryAdapterBound === true && record.stagedAudioInputBound === true
		&& record.deliveryCodecSetAvailable === true;
	if (record.frameCoreReady !== frameCoreReady || record.ready !== ready) {
		throw selectedV20SelfTestError();
	}
}

export function assertFramescaperMediaHostSelectedV28V14RenderSelfTest(
	value: unknown,
): asserts value is FramescaperMediaHostSelectedV28V14RenderSelfTestResult {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw selectedV28V14SelfTestError();
	}
	const record = value as Record<string, unknown>;
	const expected = [
		'contractVersion', 'operation', 'profile', 'planVersion', 'rgbaFramePackVersion',
		'exactPictureOrdinals', 'evaluatedRgbaExecutor', 'maximumInFlightFrames',
		'stagedAudioInputBound', 'deliveryCodecSetAvailable', 'ready',
	].sort();
	const actual = Object.keys(record).sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])
		|| record.contractVersion !== 1 || record.operation !== 'media-render'
		|| record.profile !== 'selected-v28-v14-carrier' || record.planVersion !== 14
		|| record.rgbaFramePackVersion !== 1
		|| (record.maximumInFlightFrames !== 0 && record.maximumInFlightFrames !== 1)
		|| [record.exactPictureOrdinals, record.evaluatedRgbaExecutor,
			record.stagedAudioInputBound, record.deliveryCodecSetAvailable, record.ready]
			.some((entry) => typeof entry !== 'boolean')) {
		throw selectedV28V14SelfTestError();
	}
	const ready = record.exactPictureOrdinals === true
		&& record.evaluatedRgbaExecutor === true && record.maximumInFlightFrames === 1
		&& record.stagedAudioInputBound === true && record.deliveryCodecSetAvailable === true;
	if (record.ready !== ready) throw selectedV28V14SelfTestError();
}

export function runFramescaperMediaHostSelfTest(
	descriptor: FramescaperMediaHostDescriptor,
	options: FramescaperMediaHostSelfTestOptions = {},
): Promise<FramescaperMediaHostSelfTestResult> {
	return verifyDescriptor(descriptor).then(async () => {
		const timeout = selfTestTimeout(options);
		const result = await (options.invokeControl ?? runIsolatedNativeMediaHostControl)(
			descriptor, ['--self-test'], timeout,
		);
		assertBoundedControlResult(result);
		if (result.exitCode !== 0) throw new Error(
			`The media-host self-test failed (${String(result.exitCode)}): ${result.stderr}`,
		);
		const value = parseSelfTestJson(result.stdout);
		assertFramescaperMediaHostSelfTest(value);
		return value;
	});
}

export function runFramescaperMediaHostSelectedV20RenderSelfTest(
	descriptor: FramescaperMediaHostDescriptor,
	options: FramescaperMediaHostSelfTestOptions = {},
): Promise<FramescaperMediaHostSelectedV20RenderSelfTestResult> {
	return verifyDescriptor(descriptor).then(async () => {
		const timeout = selfTestTimeout(options);
		const result = await (options.invokeControl ?? runIsolatedNativeMediaHostControl)(
			descriptor,
			['--self-test-operation', 'selected-v20-render'],
			timeout,
		);
		assertBoundedControlResult(result);
		if (result.exitCode !== 0 && result.exitCode !== 78) throw new Error(
			`The selected-V20 media-render self-test failed (${String(result.exitCode)}): ${result.stderr}`,
		);
		const value = parseSelfTestJson(result.stdout);
		assertFramescaperMediaHostSelectedV20RenderSelfTest(value);
		if ((result.exitCode === 0) !== value.ready) {
			throw new Error('The selected-V20 media-render self-test exit status does not match its result.');
		}
		return value;
	});
}

export function runFramescaperMediaHostSelectedV28V14RenderSelfTest(
	descriptor: FramescaperMediaHostDescriptor,
	options: FramescaperMediaHostSelfTestOptions = {},
): Promise<FramescaperMediaHostSelectedV28V14RenderSelfTestResult> {
	return verifyDescriptor(descriptor).then(async () => {
		const timeout = selfTestTimeout(options);
		const result = await (options.invokeControl ?? runIsolatedNativeMediaHostControl)(
			descriptor, ['--self-test-operation', 'selected-v28-v14-render'], timeout,
		);
		assertBoundedControlResult(result);
		if (result.exitCode !== 0 && result.exitCode !== 78) throw new Error(
			`The selected-V28/V14 media-render self-test failed (${String(result.exitCode)}): ${result.stderr}`,
		);
		const value = parseSelfTestJson(result.stdout);
		assertFramescaperMediaHostSelectedV28V14RenderSelfTest(value);
		if ((result.exitCode === 0) !== value.ready) {
			throw new Error('The selected-V28/V14 media-render self-test exit status does not match its result.');
		}
		return value;
	});
}

function parseSelfTestJson(stdout: string): unknown {
	try { return JSON.parse(stdout) as unknown; }
	catch { throw new Error('The media-host self-test returned malformed JSON.'); }
}

function assertBoundedControlResult(value: IsolatedNativeMediaHostControlResult): void {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Reflect.ownKeys(value).length !== 3
		|| typeof value.stdout !== 'string' || typeof value.stderr !== 'string'
		|| !Number.isSafeInteger(value.exitCode)
		|| Buffer.byteLength(value.stdout) + Buffer.byteLength(value.stderr) > 64 * 1024) {
		throw new Error('The media-host self-test returned an invalid or oversized control result.');
	}
}

function selectedV20SelfTestError(): TypeError {
	return new TypeError(
		'The selected-V20 media-render self-test did not return its exact closed result.',
	);
}

function selectedV28V14SelfTestError(): TypeError {
	return new TypeError(
		'The selected-V28/V14 carrier self-test did not return its exact closed result.',
	);
}

function selfTestTimeout(options: FramescaperMediaHostSelfTestOptions): number {
	if (!options || typeof options !== 'object' || Array.isArray(options)
		|| Reflect.ownKeys(options).some((key) => key !== 'timeoutMs' && key !== 'invokeControl')
		|| (options.invokeControl !== undefined && typeof options.invokeControl !== 'function')) {
		throw new TypeError('Framescaper media-host self-test options are invalid.');
	}
	const value = options.timeoutMs ?? FRAMESCAPER_MEDIA_HOST_SELF_TEST_TIMEOUT_MS;
	if (!Number.isSafeInteger(value) || value < 1
		|| value > FRAMESCAPER_MEDIA_HOST_SELF_TEST_TIMEOUT_MAXIMUM_MS) {
		throw new RangeError('Framescaper media-host self-test timeout is outside its closed bound.');
	}
	return value;
}

async function verifyDescriptor(descriptor: FramescaperMediaHostDescriptor): Promise<void> {
	await authenticateNativeMediaFile({
		path: descriptor.path, byteLength: descriptor.byteLength,
		sha256: descriptor.sha256, identity: descriptor.identity,
	});
}
