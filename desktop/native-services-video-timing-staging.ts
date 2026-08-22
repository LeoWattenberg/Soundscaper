/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-only resolution of declarative VFR references into authenticated SCTI bodies. */

import { createHash } from 'node:crypto';
import { lstat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
	createNativeMediaPlanEnvelopeV1,
	type NativeMediaPlanEnvelopeV1,
} from '../src/common/editor/native-media-plan-envelope.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import {
	nativeMediaPlanVideoTimingAssetInputs,
	type NativeMediaPlanVideoTimingAssetInput,
} from '../src/common/editor/native-media-plan-video-timing.ts';
import type { NativeQueueInputFingerprintV1 } from '../src/common/editor/native-queue-record.ts';
import {
	bindVideoSourceTimingView,
	type BoundVideoSourceTimingView,
	type VideoSourceTimingView,
} from '../src/common/editor/video-source-timing-view.ts';
import {
	validateVideoTimingAssetBytes,
	VIDEO_TIMING_ASSET_MIME_TYPE,
} from '../src/common/editor/video-timing-asset.ts';
import type { HelperVideoTimingAssetGrant } from './helper-native-job-contract.ts';

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

export interface AuthenticatedNativeProjectPlanBodies {
	readonly envelope: NativeMediaPlanEnvelopeV1;
	readonly originals: readonly Readonly<NativeProjectMediaBody>[];
	readonly timingAssets: readonly (AuthenticatedNativeProjectBody & Readonly<{
		readonly input: NativeMediaPlanVideoTimingAssetInput;
	}>)[];
	readonly requiredStagedBytes: number;
}

export function nativeProjectPlanBodyMetadataMatches(
	plan: unknown,
	inputFingerprints: readonly NativeQueueInputFingerprintV1[],
	bodies: readonly Readonly<NativeProjectMediaBody>[],
): boolean {
	try {
		const sources = planSources(plan);
		if (sources.length !== inputFingerprints.length) return false;
		const originals = exactOriginalBodies(inputFingerprints, bodies);
		const timings = exactTimingBodies(nativeMediaPlanVideoTimingAssetInputs(plan), bodies);
		return sources.every((source) => inputFingerprints.some((input) => (
			input.sourceId === source.sourceId && input.sha256 === source.sha256
		))) && originals.length === inputFingerprints.length
			&& timings.length === nativeMediaPlanVideoTimingAssetInputs(plan).length;
	} catch {
		return false;
	}
}

export async function authenticateNativeProjectPlanBodies(input: Readonly<{
	readonly plan: unknown;
	readonly inputFingerprints: readonly NativeQueueInputFingerprintV1[];
	readonly bodies: readonly Readonly<NativeProjectMediaBody>[];
	readonly readBody: (body: Readonly<NativeProjectMediaBody>) => Promise<Uint8Array>;
	readonly maximumStagedBytes: number;
}>): Promise<AuthenticatedNativeProjectPlanBodies> {
	const originals = exactOriginalBodies(input.inputFingerprints, input.bodies);
	const timingInputs = nativeMediaPlanVideoTimingAssetInputs(input.plan);
	const timings = exactTimingBodies(timingInputs, input.bodies);
	const requiredStagedBytes = [...originals, ...timings.map(({ body }) => body)].reduce(
		(total, body) => safeSum(total, body.byteLength),
		fingerprintNativeMediaPlan(input.plan).byteLength,
	);
	if (requiredStagedBytes > input.maximumStagedBytes) {
		throw new RangeError('The native queue scratch reservation cannot stage its exact plan and sources.');
	}
	const loadedTimings: Array<AuthenticatedNativeProjectBody & Readonly<{
		readonly input: NativeMediaPlanVideoTimingAssetInput;
	}>> = [];
	for (const { body, input: timingInput } of timings) {
		loadedTimings.push(Object.freeze({
			...await loadBody(body, input.readBody), input: timingInput,
		}));
	}
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
	const envelope = createNativeMediaPlanEnvelopeV1(
		input.plan,
		timingInputs.length === 0 ? undefined : timingSidecars,
	);
	return Object.freeze({
		envelope,
		originals,
		timingAssets: Object.freeze(loadedTimings),
		requiredStagedBytes,
	});
}

export async function stageAuthenticatedVideoTimingAssets(
	directory: string,
	assets: AuthenticatedNativeProjectPlanBodies['timingAssets'],
): Promise<readonly HelperVideoTimingAssetGrant[]> {
	const grants: HelperVideoTimingAssetGrant[] = [];
	for (const [index, loaded] of assets.entries()) {
		const path = join(directory, `timing-${String(index).padStart(4, '0')}.scti`);
		await writeFile(path, loaded.bytes, { flag: 'wx', mode: 0o600 });
		const identity = await lstat(path);
		if (!identity.isFile() || identity.isSymbolicLink()) {
			throw new Error('A staged native timing asset is not a regular file.');
		}
		grants.push(Object.freeze({
			role: 'video-timing' as const, path, bytes: loaded.body.byteLength,
			sha256: loaded.body.sha256,
			identity: Object.freeze({ dev: identity.dev, ino: identity.ino }),
		}));
	}
	return Object.freeze(grants);
}

function exactOriginalBodies(
	inputs: readonly NativeQueueInputFingerprintV1[],
	bodies: readonly Readonly<NativeProjectMediaBody>[],
): readonly Readonly<NativeProjectMediaBody>[] {
	const used = new Set<NativeProjectMediaBody>();
	const result = inputs.map((input) => {
		const matches = bodies.filter((body) => body.kind === 'video-original'
			&& body.sourceId === input.sourceId && body.sha256 === input.sha256);
		if (matches.length !== 1 || used.has(matches[0]!)) {
			throw new Error('A native source body is missing, duplicated, or outside exact project authority.');
		}
		used.add(matches[0]!);
		return matches[0]!;
	});
	return Object.freeze(result);
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

function planSources(planValue: unknown): readonly Readonly<{ sourceId: string; sha256: string }>[] {
	if (!planValue || typeof planValue !== 'object' || Array.isArray(planValue)) throw new TypeError('Missing plan.');
	const plan = planValue as Record<string, unknown>;
	if (!Array.isArray(plan.sources)) throw new TypeError('Missing unified plan sources.');
	return plan.sources.map((source) => {
		if (!source || typeof source !== 'object' || Array.isArray(source)) throw new TypeError('Malformed source.');
		const row = source as Record<string, unknown>;
		if (typeof row.sourceId !== 'string' || typeof row.contentSha256 !== 'string') {
			throw new TypeError('Malformed source identity.');
		}
		return Object.freeze({ sourceId: row.sourceId, sha256: row.contentSha256 });
	});
}
