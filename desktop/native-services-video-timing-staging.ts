/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-only resolution of declarative VFR references into authenticated SCTI bodies. */

import { createHash } from 'node:crypto';

import {
	createNativeMediaPlanEnvelopeV1,
	type NativeMediaPlanEnvelopeV1,
} from '../src/common/editor/native-media-plan-envelope.ts';
import {
	createNativeMediaPlanEnvelopeV2,
	type NativeMediaPlanEnvelopeV2,
} from '../src/common/editor/native-media-plan-envelope-v2.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import {
	nativeMediaPlanVideoTimingAssetInputs,
	type NativeMediaPlanVideoTimingAssetInput,
} from '../src/common/editor/native-media-plan-video-timing.ts';
import {
	bindVideoSourceTimingView,
	type BoundVideoSourceTimingView,
	type VideoSourceTimingView,
} from '../src/common/editor/video-source-timing-view.ts';
import {
	validateVideoTimingAssetBytes,
	VIDEO_TIMING_ASSET_MIME_TYPE,
} from '../src/common/editor/video-timing-asset.ts';

export interface NativeProjectMediaBody {
	readonly kind: 'video-original' | 'video-proxy' | 'video-timing';
	readonly encoding: string;
	readonly bindingId?: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface AuthenticatedNativeProjectBody {
	readonly body: Readonly<NativeProjectMediaBody>;
	readonly bytes: Uint8Array;
}

export interface AuthenticatedNativeProjectTimingBodiesV1OrV2 {
	readonly envelope: NativeMediaPlanEnvelopeV1 | NativeMediaPlanEnvelopeV2;
	readonly timingAssets: readonly (AuthenticatedNativeProjectBody & Readonly<{
		readonly input: NativeMediaPlanVideoTimingAssetInput;
	}>)[];
	readonly requiredStagedBytes: number;
}

export interface NativePlanVideoTimingAssetBytes {
	readonly input: NativeMediaPlanVideoTimingAssetInput;
	readonly bytes: Uint8Array;
}

export interface AuthenticatedNativePlanTimingAssetsV1OrV2 {
	readonly envelope: NativeMediaPlanEnvelopeV1 | NativeMediaPlanEnvelopeV2;
	readonly timingAssets: readonly NativePlanVideoTimingAssetBytes[];
	readonly requiredStagedBytes: number;
}

export async function authenticateNativeProjectTimingBodiesV1OrV2(input: Readonly<{
	readonly plan: unknown;
	readonly bodies: readonly Readonly<NativeProjectMediaBody>[];
	readonly readBody: (body: Readonly<NativeProjectMediaBody>) => Promise<Uint8Array>;
	readonly maximumStagedBytes: number;
}>): Promise<AuthenticatedNativeProjectTimingBodiesV1OrV2> {
	const timingInputs = nativeMediaPlanVideoTimingAssetInputs(input.plan);
	const timings = exactTimingBodies(timingInputs, input.bodies);
	const requiredStagedBytes = requiredTimingStagedBytes(input.plan, timingInputs);
	assertStagedByteLimit(input.maximumStagedBytes, requiredStagedBytes,
		'The native scratch reservation cannot stage its exact plan and timing assets.');
	return loadAuthenticatedProjectTimingBodies({
		plan: input.plan, timings, readBody: input.readBody,
		maximumStagedBytes: input.maximumStagedBytes, requiredStagedBytes,
	});
}

async function loadAuthenticatedProjectTimingBodies(input: Readonly<{
	readonly plan: unknown;
	readonly timings: readonly Readonly<{
		readonly body: NativeProjectMediaBody;
		readonly input: NativeMediaPlanVideoTimingAssetInput;
	}>[];
	readonly readBody: (body: Readonly<NativeProjectMediaBody>) => Promise<Uint8Array>;
	readonly maximumStagedBytes: number;
	readonly requiredStagedBytes: number;
}>): Promise<AuthenticatedNativeProjectTimingBodiesV1OrV2> {
	const loadedTimings: Array<AuthenticatedNativeProjectBody & Readonly<{
		readonly input: NativeMediaPlanVideoTimingAssetInput;
	}>> = [];
	for (const { body, input: timingInput } of input.timings) {
		loadedTimings.push(Object.freeze({
			...await loadBody(body, input.readBody), input: timingInput,
		}));
	}
	const authenticated = authenticateNativePlanVideoTimingAssetsV1OrV2({
		plan: input.plan,
		assets: loadedTimings,
		maximumStagedBytes: input.maximumStagedBytes,
	});
	if (authenticated.requiredStagedBytes !== input.requiredStagedBytes) {
		throw new Error('Authenticated native timing bytes changed their preflight geometry.');
	}
	return Object.freeze({
		envelope: authenticated.envelope,
		timingAssets: Object.freeze(loadedTimings),
		requiredStagedBytes: input.requiredStagedBytes,
	});
}

/** Bind exact ordered SCTI bytes to a declarative plan before any helper grant is minted. */
export function authenticateNativePlanVideoTimingAssetsV1OrV2(input: Readonly<{
	readonly plan: unknown;
	readonly assets: readonly NativePlanVideoTimingAssetBytes[];
	readonly maximumStagedBytes: number;
}>): AuthenticatedNativePlanTimingAssetsV1OrV2 {
	const timingInputs = nativeMediaPlanVideoTimingAssetInputs(input.plan);
	if (!Array.isArray(input.assets) || input.assets.length !== timingInputs.length) {
		throw new Error('The native plan requires its exact timing asset count in plan order.');
	}
	const requiredStagedBytes = requiredTimingStagedBytes(input.plan, timingInputs);
	assertStagedByteLimit(input.maximumStagedBytes, requiredStagedBytes,
		'The native scratch reservation cannot stage its exact plan and timing assets.');
	const suppliedDigests = new Set<string>();
	const loadedTimings = timingInputs.map((timingInput, index) => {
		const candidate = input.assets[index];
		const suppliedDigest = candidate?.input?.sha256;
		if (typeof suppliedDigest === 'string' && suppliedDigests.has(suppliedDigest)) {
			throw new Error('A native timing asset digest was duplicated or replayed.');
		}
		if (typeof suppliedDigest === 'string') suppliedDigests.add(suppliedDigest);
		if (!candidate || !sameTimingInput(candidate.input, timingInput)) {
			throw new Error('A native timing asset is outside the exact plan order or source authority.');
		}
		if (!(candidate.bytes instanceof Uint8Array)
			|| Object.getPrototypeOf(candidate.bytes) !== Uint8Array.prototype
			|| !(candidate.bytes.buffer instanceof ArrayBuffer)) {
			throw new TypeError('Native timing asset bytes must be one private Uint8Array.');
		}
		const bytes = new Uint8Array(candidate.bytes);
		validateVideoTimingAssetBytes(timingInput, bytes);
		return Object.freeze({ input: timingInput, bytes });
	});
	const timingSidecars = new Map<string, BoundVideoSourceTimingView>();
	for (const loaded of loadedTimings) {
		const index = validateVideoTimingAssetBytes(loaded.input, loaded.bytes);
		const view: VideoSourceTimingView = Object.freeze({
			kind: 'vfr', reference: loaded.input, index,
		});
		const rate = Object.freeze({ num: 1, den: 1 });
		const token = bindVideoSourceTimingView(new Map([[loaded.input.sourceId, view]]), {
			id: loaded.input.sourceId, kind: 'video', contentSha256: loaded.input.sourceSha256,
			frameRate: rate, sourceFrameCount: loaded.input.frameCount,
			timingAsset: loaded.input, timingDecision: { mode: 'exact', rate, backend: 'native-main' },
		});
		timingSidecars.set(loaded.input.sourceId, token);
	}
	const version = (input.plan as Readonly<{ version?: unknown }>).version;
	const envelope = version === 14
		? createNativeMediaPlanEnvelopeV2(input.plan, timingInputs.length === 0 ? undefined : timingSidecars)
		: createNativeMediaPlanEnvelopeV1(input.plan, timingInputs.length === 0 ? undefined : timingSidecars);
	return Object.freeze({
		envelope,
		timingAssets: Object.freeze(loadedTimings),
		requiredStagedBytes,
	});
}

function sameTimingInput(
	value: unknown,
	expected: NativeMediaPlanVideoTimingAssetInput,
): value is NativeMediaPlanVideoTimingAssetInput {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype
			&& Object.getPrototypeOf(value) !== null)) return false;
	const record = value as Record<string, unknown>;
	const fields = [
		'inputIndex', 'sourceId', 'encoding', 'storageKey', 'sha256', 'sourceSha256',
		'byteLength', 'frameCount', 'timescale', 'finalFrameDurationTicks',
	] as const;
	const keys = Reflect.ownKeys(record);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string'
		|| !fields.includes(key as typeof fields[number]))) return false;
	return fields.every((field) => {
		const descriptor = Object.getOwnPropertyDescriptor(record, field);
		return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
			&& descriptor.value === expected[field];
	});
}

function exactTimingBodies(
	inputs: readonly NativeMediaPlanVideoTimingAssetInput[],
	bodies: readonly Readonly<NativeProjectMediaBody>[],
): readonly Readonly<{ body: NativeProjectMediaBody; input: NativeMediaPlanVideoTimingAssetInput }>[] {
	return Object.freeze(inputs.map((input) => {
		const matches = bodies.filter((body) => body.kind === 'video-timing'
			&& body.encoding === input.encoding && body.sourceId === input.storageKey
			&& body.storageKey === input.storageKey && body.mimeType === VIDEO_TIMING_ASSET_MIME_TYPE
			&& body.byteLength === input.byteLength && body.sha256 === input.sha256);
		if (matches.length !== 1) {
			throw new Error(`VFR source ${input.sourceId} has no unique exact video-timing project body.`);
		}
		return Object.freeze({ body: matches[0]!, input });
	}));
}

async function loadBody(
	body: Readonly<NativeProjectMediaBody>,
	readBody: (body: Readonly<NativeProjectMediaBody>) => Promise<Uint8Array>,
): Promise<AuthenticatedNativeProjectBody> {
	const bytes = await readBody(body);
	if (!(bytes instanceof Uint8Array) || bytes.byteLength !== body.byteLength
		|| createHash('sha256').update(bytes).digest('hex') !== body.sha256) {
		throw new Error('A managed native project body changed during authenticated staging.');
	}
	return Object.freeze({ body, bytes });
}

function safeSum(left: number, right: number): number {
	if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0
		|| left > Number.MAX_SAFE_INTEGER - right) {
		throw new RangeError('Native staged byte accounting overflowed.');
	}
	return left + right;
}

function requiredTimingStagedBytes(
	plan: unknown,
	inputs: readonly NativeMediaPlanVideoTimingAssetInput[],
): number {
	return inputs.reduce(
		(total, input) => safeSum(total, input.byteLength),
		fingerprintNativeMediaPlan(plan).byteLength,
	);
}

function assertStagedByteLimit(maximum: number, required: number, message: string): void {
	if (!Number.isSafeInteger(maximum) || maximum < 1 || required > maximum) {
		throw new RangeError(message);
	}
}
