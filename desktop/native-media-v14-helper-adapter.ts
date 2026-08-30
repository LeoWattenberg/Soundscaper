/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Stages one pathless V14 request into an exact contract-v1 media-render helper job.
 * Evaluated carriers retain Web Core semantic authority while the helper's
 * explicit backend selects one real native hardware or CPU encoder.
 */

import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';

import {
	assertNativeMediaRelativeDestination,
	createNativeMediaPublicationPlan,
} from '../src/common/editor/native-media-atomic-publication.ts';
import { NATIVE_MEDIA_WEB_BACKEND } from '../src/common/editor/native-media-backend-policy.ts';
import { nativeMediaV14RequiresEvaluatedCarrier } from '../src/common/editor/native-media-v14-render-family.ts';
import { nativeMediaV14EncodeDispatch } from '../src/common/editor/native-media-v14-native-dispatch.ts';
import { canonicalizeNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { assertNativeMediaPlanEnvelopeV2 } from '../src/common/editor/native-media-plan-envelope-v2.ts';
import type { FramescaperMediaHostDescriptor } from './framescaper-media-host-payload.ts';
import {
	HELPER_DATA_CHUNK_MAXIMUM_BYTES,
	HELPER_DATA_PLANE_MAXIMUM_BYTES,
	HELPER_DATA_PLANE_VERSION,
	type HelperDataPlaneBinding,
} from './helper-data-plane.ts';
import { sendHelperDataPlaneFile, type HelperDataPlaneIoPort } from './helper-data-plane-io.ts';
import type { HelperDataPlaneTransferPort } from './helper-data-plane-transfer.ts';
import type {
	HelperNativeInputGrant,
	HelperNativeFileIdentity,
} from './helper-native-job-contract.ts';
import { validateHelperNativeMediaEncodeBackend } from './helper-native-media-backend.ts';
import type { NativeMediaHelperPoolJobRequest } from './native-media-helper-pool.ts';
import type { NativeMediaV14ExecutionReceipt } from './native-media-v14-executor.ts';
import type { FramescaperNativeMediaV14RuntimeRequest } from './native-media-v14-runtime-contract.ts';
import type { FramescaperNativeMediaProxyV14RuntimeRequest } from './native-media-v14-runtime-contract.ts';
import {
	isHelperOutputDirectoryGrant,
	type HelperOutputGrant,
} from './helper-native-output-grant.ts';
import {
	admitNativeMediaOutputTreeSummary,
	createNativeMediaOutputTreeIdentity,
} from './native-media-output-tree.ts';

const SHA256 = /^[a-f0-9]{64}$/u;
const PROXY_OUTPUT_MINIMUM_CEILING_BYTES = 512 * 1024 ** 2;
const PROXY_OUTPUT_BYTES_PER_SECOND = 8 * 1024 ** 2;

/**
 * One whole-source ProRes Proxy MOV scales with duration — roughly three
 * megabytes a second at the 1280x720 recipe ceiling — so the previous flat
 * half-gigabyte cap refused every clip past a few minutes: exactly the media
 * proxies exist for. Eight megabytes per source second keeps the bound real
 * without starving it, and the old flat value remains the floor.
 */
export function framescaperNativeMediaV14ProxyOutputCeiling(
	envelope: FramescaperNativeMediaV14RuntimeRequest['attempt']['envelope'],
): number {
	const seconds = envelope.plan.sources.reduce((total, source) => {
		const timing = source.timing as Readonly<{
			kind?: string; frameCount?: number; rate?: Readonly<{ num: number; den: number }>;
		}> | undefined;
		if (!timing || typeof timing.frameCount !== 'number' || !Number.isSafeInteger(timing.frameCount)
			|| !timing.rate || typeof timing.rate.num !== 'number' || typeof timing.rate.den !== 'number'
			|| !Number.isSafeInteger(timing.rate.num) || !Number.isSafeInteger(timing.rate.den)
			|| timing.rate.num <= 0) {
			return total;
		}
		return Math.max(total, Math.ceil((timing.frameCount * timing.rate.den) / timing.rate.num));
	}, 0);
	return Math.min(HELPER_DATA_PLANE_MAXIMUM_BYTES,
		Math.max(PROXY_OUTPUT_MINIMUM_CEILING_BYTES, safeProduct([seconds, PROXY_OUTPUT_BYTES_PER_SECOND])));
}

export interface NativeMediaV14HelperAdapterMessageChannel {
	readonly hostPort: HelperDataPlaneIoPort;
	readonly helperPort: HelperDataPlaneTransferPort;
}

export interface NativeMediaV14HelperAdapterOptions {
	readonly descriptor: FramescaperMediaHostDescriptor;
	readonly scratchRoot: string;
	readonly createMessageChannel: () => NativeMediaV14HelperAdapterMessageChannel;
	readonly runJob: (request: NativeMediaHelperPoolJobRequest) => Promise<unknown>;
}

export function createNativeMediaV14HelperAdapter(options: NativeMediaV14HelperAdapterOptions) {
	const scratchRoot = absolutePath(options.scratchRoot, 'V14 helper scratch root');
	if (typeof options.createMessageChannel !== 'function' || typeof options.runJob !== 'function') {
		throw new TypeError('The selected V14 helper adapter requires exact runtime ports.');
	}
	return Object.freeze({
		execute: (request: FramescaperNativeMediaV14RuntimeRequest) => execute(options, scratchRoot, request),
		executeProxy: (request: FramescaperNativeMediaProxyV14RuntimeRequest) => (
			executeProxy(options, scratchRoot, request)
		),
	});
}

async function executeProxy(
	options: NativeMediaV14HelperAdapterOptions,
	scratchRoot: string,
	request: FramescaperNativeMediaProxyV14RuntimeRequest,
): Promise<Readonly<{
	planFingerprint: string; byteLength: number; sha256: string; publication: 'verified-temporary';
}>> {
	assertProxyRequest(request);
	await mkdir(scratchRoot, { recursive: true, mode: 0o700 });
	const stagingRoot = await mkdtemp(join(scratchRoot, 'proxy-v14-'));
	let transfer: Promise<unknown> | null = null;
	const transferAbort = new AbortController();
	try {
		const prepared = await prepareProxy(options.descriptor, stagingRoot, request);
		const channel = options.createMessageChannel();
		transfer = sendHelperDataPlaneFile({
			binding: prepared.planBinding, port: channel.hostPort,
			path: prepared.planPath, signal: transferAbort.signal,
		});
		const job = Object.freeze({
			kind: 'media-proxy' as const,
			grant: prepared.grant,
			dataPlaneTransfers: Object.freeze([Object.freeze({
				streamId: prepared.planBinding.streamId, port: channel.helperPort,
			})]),
			resourcePolicy: prepared.resourcePolicy,
			onProgress: request.onProgress,
		});
		const result = await runJobWithTransfer(options, job, transfer, transferAbort, request.signal);
		const output = helperOutput(result, prepared.grant.output);
		return Object.freeze({
			planFingerprint: request.envelope.fingerprint,
			byteLength: output.byteLength, sha256: output.sha256,
			publication: 'verified-temporary',
		});
	} finally {
		transferAbort.abort();
		await transfer?.catch(() => undefined);
		await rm(stagingRoot, { recursive: true, force: true });
	}
}

async function execute(
	options: NativeMediaV14HelperAdapterOptions,
	scratchRoot: string,
	request: FramescaperNativeMediaV14RuntimeRequest,
): Promise<NativeMediaV14ExecutionReceipt> {
	assertRequest(request);
	await mkdir(scratchRoot, { recursive: true, mode: 0o700 });
	const stagingRoot = await mkdtemp(join(scratchRoot, 'v14-'));
	let transfer: Promise<unknown> | null = null;
	const transferAbort = new AbortController();
	try {
		const prepared = await prepare(options.descriptor, stagingRoot, request);
		const channel = options.createMessageChannel();
		transfer = sendHelperDataPlaneFile({
			binding: prepared.planBinding, port: channel.hostPort,
			path: prepared.planPath, signal: transferAbort.signal,
		});
		const job = Object.freeze({
			kind: 'media-render' as const,
			grant: prepared.grant,
			dataPlaneTransfers: Object.freeze([Object.freeze({
				streamId: prepared.planBinding.streamId, port: channel.helperPort,
			}), ...prepared.dataPlaneTransfers]),
			resourcePolicy: prepared.resourcePolicy,
			onProgress: request.onProgress,
		});
		const result = await runJobWithTransfer(
			options, job, transfer, transferAbort, request.attempt.signal,
		);
		const output = helperOutput(result, prepared.grant.output);
		return Object.freeze({
			planFingerprint: request.attempt.envelope.fingerprint,
			byteLength: output.byteLength, sha256: output.sha256, publication: 'verified-temporary',
			...('tree' in output ? { tree: output.tree } : {}),
		});
	} finally {
		transferAbort.abort();
		await transfer?.catch(() => undefined);
		await rm(stagingRoot, { recursive: true, force: true });
	}
}
async function runJobWithTransfer(
	options: NativeMediaV14HelperAdapterOptions,
	request: NativeMediaHelperPoolJobRequest,
	transfer: Promise<unknown>,
	transferAbort: AbortController,
	signal?: AbortSignal,
): Promise<unknown> {
	const jobAbort = new AbortController();
	const abort = (reason?: unknown): void => {
		jobAbort.abort(reason);
		transferAbort.abort(reason);
	};
	const relayAbort = (): void => abort(signal?.reason);
	if (signal?.aborted) relayAbort();
	else signal?.addEventListener('abort', relayAbort, { once: true });
	const running = Promise.resolve().then(() => options.runJob(Object.freeze({
		...request, signal: jobAbort.signal,
	})));
	try {
		const [result] = await Promise.all([running, transfer]);
		return result;
	} catch (error) {
		abort(error);
		await Promise.allSettled([running, transfer]);
		throw error;
	} finally {
		signal?.removeEventListener('abort', relayAbort);
	}
}
async function prepare(
	descriptor: FramescaperMediaHostDescriptor,
	stagingRoot: string,
	request: FramescaperNativeMediaV14RuntimeRequest,
) {
	const canonical = canonicalizeNativeMediaPlan(request.attempt.envelope.plan);
	const planBytes = Buffer.from(canonical);
	const planPath = join(stagingRoot, 'canonical-plan.json');
	await writeFile(planPath, planBytes, { flag: 'wx', mode: 0o600 });
	const sources: HelperNativeInputGrant[] = [];
	if (request.derivedInputs === null) {
		for (const [index, body] of request.sourceBodies.entries()) {
			const path = join(stagingRoot, `source-${String(index).padStart(6, '0')}.media`);
			const staged = materializationResult(
				await body.materialize(path, request.attempt.signal), body.byteLength, body.contentSha256,
			);
			sources.push(Object.freeze({
				type: 'file' as const, role: 'original' as const, path,
				bytes: staged.byteLength, sha256: staged.sha256, identity: await fileIdentity(path),
			}));
		}
	}
	const timing = [];
	for (const [index, body] of request.timingBodies.entries()) {
		const path = join(stagingRoot, `timing-${String(index).padStart(6, '0')}.scti`);
		await writeAuthenticated(path, body.bytes, body.sha256);
		timing.push(Object.freeze({
			role: 'video-timing' as const, path, bytes: body.bytes.byteLength,
			sha256: body.sha256, identity: await fileIdentity(path),
		}));
	}
	if (request.derivedInputs !== null) {
		sources.push(...await request.derivedInputs.materialize(stagingRoot, request.attempt.signal));
	}
	const dataPlaneTransfers = request.derivedInputs?.transfers?.() ?? Object.freeze([]);
	const planBinding = binding(planBytes.byteLength, request.attempt.envelope.fingerprint);
	const destination = await destinationGrant(request);
	const scratchIdentity = await directoryIdentity(stagingRoot);
	const maximumOutputBytes = framescaperNativeMediaV14OutputCeiling(request.attempt.envelope);
	const sourceBytes = sources.map((source) => source.type === 'file' ? source.bytes : source.binding.byteLength);
	const derivedScratchBytes = request.derivedInputs === null
		? sources.flatMap((source) => source.type === 'file' ? [source.bytes] : [])
		: [request.derivedInputs.scratchByteLength ?? request.derivedInputs.byteLength];
	const scratchBytes = safeSum([planBytes.byteLength,
		...derivedScratchBytes,
		...timing.map(({ bytes }) => bytes)]);
	const grant = Object.freeze({
		executable: Object.freeze({
			role: 'ffmpeg' as const, path: descriptor.path, bytes: descriptor.byteLength,
			sha256: descriptor.sha256, identity: descriptor.identity,
		}),
		backend: helperEncodeBackend(request.attempt.backend),
		plan: planBinding, sources: Object.freeze(sources),
		...(timing.length === 0 ? {} : { videoTimingAssets: Object.freeze(timing) }),
		output: Object.freeze({ ...destination, maximumBytes: maximumOutputBytes }),
		scratch: Object.freeze({
			rootPath: stagingRoot, rootIdentity: scratchIdentity,
			reservationId: randomBytes(20).toString('hex'), maximumBytes: scratchBytes,
		}),
	});
	return Object.freeze({
		grant, planBinding, planPath, dataPlaneTransfers,
		temporaryPath: destination.temporaryPath, finalPath: destination.finalPath,
		rootPath: destination.rootPath, rootIdentity: destination.rootIdentity,
		resourcePolicy: Object.freeze({
			maximumInputBytes: safeSum([descriptor.byteLength, planBytes.byteLength,
				...sourceBytes, ...timing.map(({ bytes }) => bytes)]),
			maximumOutputBytes, maximumScratchBytes: scratchBytes,
			maximumDataPlaneBytes: safeSum([planBytes.byteLength,
				...sources.flatMap((source) => source.type === 'stream' ? [source.binding.byteLength] : [])]),
			maximumInFlightChunks: 1,
			maximumRssBytes: 1024 ** 3,
		}),
	});
}

async function prepareProxy(
	descriptor: FramescaperMediaHostDescriptor,
	stagingRoot: string,
	request: FramescaperNativeMediaProxyV14RuntimeRequest,
) {
	const canonical = canonicalizeNativeMediaPlan(request.envelope.plan);
	const planBytes = Buffer.from(canonical);
	const planPath = join(stagingRoot, 'canonical-plan.json');
	await writeFile(planPath, planBytes, { flag: 'wx', mode: 0o600 });
	const sourcePath = join(stagingRoot, 'source-000000.media');
	const source = request.sourceBody;
	const staged = materializationResult(
		await source.materialize(sourcePath, request.signal), source.byteLength, source.contentSha256,
	);
	const sourceGrant = Object.freeze({
		type: 'file' as const, role: 'original' as const, path: sourcePath,
		bytes: staged.byteLength, sha256: staged.sha256, identity: await fileIdentity(sourcePath),
	});
	const timing = [];
	for (const [index, body] of request.timingBodies.entries()) {
		const path = join(stagingRoot, `timing-${String(index).padStart(6, '0')}.scti`);
		await writeAuthenticated(path, body.bytes, body.sha256);
		timing.push(Object.freeze({
			role: 'video-timing' as const, path, bytes: body.bytes.byteLength,
			sha256: body.sha256, identity: await fileIdentity(path),
		}));
	}
	const planBinding = binding(planBytes.byteLength, request.envelope.fingerprint);
	const destination = await destinationGrantFor(request.destination, request.envelope.fingerprint);
	const scratchIdentity = await directoryIdentity(stagingRoot);
	const scratchBytes = safeSum([
		planBytes.byteLength, sourceGrant.bytes, ...timing.map(({ bytes }) => bytes),
	]);
	const grant = Object.freeze({
		executable: Object.freeze({
			role: 'ffmpeg' as const, path: descriptor.path, bytes: descriptor.byteLength,
			sha256: descriptor.sha256, identity: descriptor.identity,
		}),
		plan: planBinding, source: sourceGrant,
		...(timing.length === 0 ? {} : { videoTimingAssets: Object.freeze(timing) }),
		proxyRecipe: request.recipe,
		output: Object.freeze({ ...destination,
			maximumBytes: framescaperNativeMediaV14ProxyOutputCeiling(request.envelope) }),
		scratch: Object.freeze({
			rootPath: stagingRoot, rootIdentity: scratchIdentity,
			reservationId: randomBytes(20).toString('hex'), maximumBytes: scratchBytes,
		}),
	});
	return Object.freeze({
		grant, planBinding, planPath, temporaryPath: destination.temporaryPath,
		resourcePolicy: Object.freeze({
			maximumInputBytes: safeSum([
				descriptor.byteLength, planBytes.byteLength, sourceGrant.bytes,
				...timing.map(({ bytes }) => bytes),
			]),
			maximumOutputBytes: framescaperNativeMediaV14ProxyOutputCeiling(request.envelope),
			maximumScratchBytes: scratchBytes,
			maximumDataPlaneBytes: planBytes.byteLength, maximumInFlightChunks: 1,
			maximumRssBytes: 1024 ** 3,
		}),
	});
}

async function destinationGrant(request: FramescaperNativeMediaV14RuntimeRequest) {
	const profileId = request.attempt.envelope.plan.deliveryProfile;
	if (profileId === undefined) throw new Error('The selected V14 output has no exact delivery profile.');
	const dispatch = nativeMediaV14EncodeDispatch(profileId);
	const treeIdentity = dispatch.imageSequence ? createNativeMediaOutputTreeIdentity({
		jobId: request.attempt.jobId, planFingerprint: request.attempt.envelope.fingerprint,
		rootGrantId: request.attempt.rootGrantId,
		relativeDestination: request.attempt.relativeDestination,
		sources: request.attempt.sources, profileId,
		frameCount: request.attempt.envelope.summary.outputFrameCount,
	}) : null;
	return destinationGrantFor(request.destination, request.attempt.envelope.fingerprint, treeIdentity);
}

async function destinationGrantFor(
	destination: FramescaperNativeMediaV14RuntimeRequest['destination'],
	planFingerprint: string,
	treeIdentity: ReturnType<typeof createNativeMediaOutputTreeIdentity> | null = null,
) {
	const rootPath = absolutePath(destination.rootPath, 'V14 destination root');
	const rootDetails = await lstat(rootPath, { bigint: true });
	if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()
		|| await realpath(rootPath) !== rootPath
		|| destination.volumeIdentity !== `device:${rootDetails.dev.toString(16)}`
		|| destination.directoryIdentity
			!== `device:${rootDetails.dev.toString(16)}:inode:${rootDetails.ino.toString(16)}`) {
		throw new Error('The selected V14 destination root changed exact identity.');
	}
	const publication = createNativeMediaPublicationPlan({
		jobId: destination.jobId,
		relativeDestination: assertNativeMediaRelativeDestination(destination.relativeDestination),
		planFingerprint,
	});
	if (publication.temporaryRelativePath !== destination.temporaryRelativePath) {
		throw new Error('The selected V14 temporary publication name changed.');
	}
	const finalPath = inside(rootPath, publication.relativeDestination);
	const temporaryPath = inside(rootPath, publication.temporaryRelativePath);
	await mkdirParents(rootPath, finalPath);
	const base = Object.freeze({
		rootPath, rootIdentity: numericIdentity(rootDetails), temporaryPath, finalPath,
	});
	return treeIdentity === null ? base : Object.freeze({
		kind: 'directory' as const, ...base, treeIdentity,
	});
}

function assertProxyRequest(request: FramescaperNativeMediaProxyV14RuntimeRequest): void {
	if (!request || request.adapterVersion !== 1 || typeof request.onProgress !== 'function') {
		throw new TypeError('The selected V14 proxy runtime request is malformed.');
	}
	assertNativeMediaPlanEnvelopeV2(request.envelope);
	const source = request.envelope.plan.sources.find(({ sourceId }) => (
		sourceId === request.sourceBody.sourceId
	));
	if (request.envelope.planVersion !== 14 || !source
		|| source.contentSha256 !== request.sourceBody.contentSha256
		|| typeof request.sourceBody.materialize !== 'function'
		|| !Number.isSafeInteger(request.sourceBody.byteLength) || request.sourceBody.byteLength < 1
		|| request.recipe.id !== 'framescaper-native-prores-proxy-mov-v1'
		|| !Number.isSafeInteger(request.recipe.width) || request.recipe.width < 2
		|| request.recipe.width > 1280 || request.recipe.width % 2 !== 0
		|| !Number.isSafeInteger(request.recipe.height) || request.recipe.height < 2
		|| request.recipe.height > 720 || request.recipe.height % 2 !== 0) {
		throw new Error('The selected V14 proxy request changed plan, source, or recipe authority.');
	}
	for (const body of request.timingBodies) {
		if (!(body.bytes instanceof Uint8Array) || body.bytes.byteLength < 1
			|| !SHA256.test(body.sha256) || digest(body.bytes) !== body.sha256) {
			throw new Error('A selected V14 proxy timing body changed exact identity.');
		}
	}
}

function assertRequest(request: FramescaperNativeMediaV14RuntimeRequest): void {
	if (!request || request.adapterVersion !== 1 || typeof request.onProgress !== 'function') {
		throw new TypeError('The selected V14 runtime request is malformed.');
	}
	assertNativeMediaPlanEnvelopeV2(request.attempt.envelope);
	if (request.attempt.envelope.planVersion !== 14
		|| request.sourceBodies.length !== request.attempt.sources.length) {
		throw new TypeError('The selected V14 runtime request has mismatched plan authority.');
	}
	const carrierRequired = nativeMediaV14RequiresEvaluatedCarrier(request.attempt.envelope.plan);
	if ((request.derivedInputs !== null) !== carrierRequired) {
		throw new Error('Selected V14 execution changed its evaluated-carrier authority.');
	}
	helperEncodeBackend(request.attempt.backend);
	for (const [index, body] of request.sourceBodies.entries()) {
		const source = request.attempt.sources[index];
		if (!Number.isSafeInteger(body.byteLength) || body.byteLength < 1
			|| typeof body.materialize !== 'function' || typeof body.mimeType !== 'string'
			|| body.sourceId !== source?.sourceId || body.grantId !== source.grantId
			|| body.contentSha256 !== source.contentSha256 || !SHA256.test(body.contentSha256)) {
			throw new Error('A selected V14 source body changed exact identity.');
		}
	}
	for (const body of request.timingBodies) {
		if (!(body.bytes instanceof Uint8Array) || body.bytes.byteLength < 1
			|| !SHA256.test(body.sha256) || digest(body.bytes) !== body.sha256) {
			throw new Error('A selected V14 timing body changed exact identity.');
		}
	}
}

function helperEncodeBackend(value: string) {
	// The web fallback is a typed refusal owned by the renderer route; mapping
	// it silently onto native CPU here would execute real native work while the
	// result stayed labelled web-core — the synthesized receipt the plan forbids.
	if (value === NATIVE_MEDIA_WEB_BACKEND) {
		throw new RangeError('The Web Core fallback never executes through the native helper.');
	}
	return validateHelperNativeMediaEncodeBackend(value);
}

function binding(byteLength: number, sha256: string): HelperDataPlaneBinding {
	return Object.freeze({
		dataPlaneVersion: HELPER_DATA_PLANE_VERSION, transport: 'message-port',
		streamId: randomBytes(20).toString('hex'), direction: 'host-to-helper',
		byteLength, sha256, maximumChunkBytes: HELPER_DATA_CHUNK_MAXIMUM_BYTES,
		maximumInFlightChunks: 1,
	});
}

function materializationResult(value: unknown, byteLength: number, sha256: string) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A selected V14 source materialization returned no identity.');
	}
	const row = value as Record<string, unknown>;
	if (Reflect.ownKeys(row).sort().join(',') !== 'byteLength,sha256'
		|| row.byteLength !== byteLength || row.sha256 !== sha256) {
		throw new Error('A selected V14 source materialization changed exact identity.');
	}
	return Object.freeze({ byteLength, sha256 });
}

export function framescaperNativeMediaV14OutputCeiling(
	envelope: FramescaperNativeMediaV14RuntimeRequest['attempt']['envelope'],
): number {
	const summary = envelope.summary;
	const plan = envelope.plan;
	const profileId = plan.deliveryProfile;
	const bytesPerPixel = profileId !== undefined && nativeMediaV14EncodeDispatch(profileId).imageSequence ? 16 : 4;
	const body = safeProduct([summary.width, summary.height, summary.outputFrameCount, bytesPerPixel]);
	const manifestAllowance = safeProduct([summary.outputFrameCount + 1, 512]);
	// A ceiling with no audio term refused correct completed exports on small
	// canvases: a 64x64 music-heavy timeline's PCM track alone can outweigh
	// the raw-video allowance. Grant audio the same worst-case spirit — raw
	// eight-channel float32 for the full output duration.
	const rawAudio = plan.output.includeAudio
		? (BigInt(summary.outputFrameCount) * BigInt(plan.output.frameRate.den)
			* BigInt(plan.timebase.sampleRate) * 32n) / BigInt(plan.output.frameRate.num) + 32n
		: 0n;
	const audioAllowance = rawAudio > BigInt(HELPER_DATA_PLANE_MAXIMUM_BYTES)
		? HELPER_DATA_PLANE_MAXIMUM_BYTES : Number(rawAudio);
	const total = Math.min(HELPER_DATA_PLANE_MAXIMUM_BYTES, body + audioAllowance);
	return Math.min(HELPER_DATA_PLANE_MAXIMUM_BYTES,
		Math.max(1, total > HELPER_DATA_PLANE_MAXIMUM_BYTES - manifestAllowance
			? HELPER_DATA_PLANE_MAXIMUM_BYTES : total + manifestAllowance));
}

async function writeAuthenticated(path: string, bytes: Uint8Array, sha256: string): Promise<void> {
	if (!SHA256.test(sha256) || digest(bytes) !== sha256) throw new Error('V14 staged bytes changed digest.');
	await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
}

async function fileIdentity(path: string): Promise<HelperNativeFileIdentity> {
	const details = await lstat(path);
	if (!details.isFile() || details.isSymbolicLink()) throw new Error('A V14 staged file changed type.');
	return Object.freeze({ dev: details.dev, ino: details.ino });
}
async function directoryIdentity(path: string): Promise<HelperNativeFileIdentity> {
	const details = await lstat(path);
	if (!details.isDirectory() || details.isSymbolicLink()) throw new Error('A V14 staged directory changed type.');
	return Object.freeze({ dev: details.dev, ino: details.ino });
}
function numericIdentity(details: Awaited<ReturnType<typeof lstat>>): HelperNativeFileIdentity {
	return Object.freeze({ dev: Number(details.dev), ino: Number(details.ino) });
}

async function mkdirParents(root: string, finalPath: string): Promise<void> {
	const parent = finalPath.slice(0, Math.max(finalPath.lastIndexOf('/'), finalPath.lastIndexOf('\\')));
	await mkdir(parent, { recursive: true, mode: 0o700 });
	let current = root;
	const child = relative(root, parent);
	for (const segment of child.split(/[\\/]/u).filter(Boolean)) {
		current = join(current, segment);
		const details = await lstat(current);
		if (!details.isDirectory() || details.isSymbolicLink()) {
			throw new Error('A selected V14 output parent is not a regular directory.');
		}
	}
}
function inside(root: string, relativePath: string): string {
	const value = resolve(root, ...relativePath.split('/'));
	const child = relative(root, value);
	if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('A selected V14 output escaped its root.');
	return value;
}
function absolutePath(value: unknown, label: string): string {
	if (typeof value !== 'string' || !isAbsolute(value) || normalize(value) !== value || value.includes('\0')) {
		throw new TypeError(`${label} must be one absolute normalized path.`);
	}
	return value;
}
function helperOutput(value: unknown, outputGrant: HelperOutputGrant) {
	const output = (value as Readonly<{ output?: unknown }> | null)?.output;
	if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error('The V14 helper returned no output.');
	const row = output as Record<string, unknown>;
	if (row.temporaryPath !== outputGrant.temporaryPath || !Number.isSafeInteger(row.byteLength)
		|| Number(row.byteLength) < 1 || typeof row.sha256 !== 'string' || !SHA256.test(row.sha256)) {
		throw new Error('The V14 helper output receipt is malformed.');
	}
	if (!isHelperOutputDirectoryGrant(outputGrant)) {
		if (Reflect.ownKeys(row).sort().join(',') !== 'byteLength,identity,sha256,temporaryPath') {
			throw new Error('The V14 helper file output receipt has unsupported fields.');
		}
		return Object.freeze({ byteLength: Number(row.byteLength), sha256: row.sha256 });
	}
	if (row.kind !== 'directory'
		|| Reflect.ownKeys(row).sort().join(',') !== 'byteLength,identity,kind,sha256,temporaryPath,tree') {
		throw new Error('The V14 helper directory output receipt is malformed.');
	}
	const tree = admitNativeMediaOutputTreeSummary(row.tree, outputGrant.treeIdentity);
	if (row.sha256 !== tree.manifestSha256) throw new Error('The V14 helper tree digest changed.');
	return Object.freeze({ byteLength: Number(row.byteLength), sha256: row.sha256, tree });
}
function digest(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function safeProduct(values: readonly number[]): number {
	let total = 1;
	for (const value of values) {
		total *= value;
		if (!Number.isSafeInteger(total) || total > HELPER_DATA_PLANE_MAXIMUM_BYTES) return HELPER_DATA_PLANE_MAXIMUM_BYTES;
	}
	return total;
}
function safeSum(values: readonly number[]): number {
	let total = 0;
	for (const value of values) {
		total += value;
		if (!Number.isSafeInteger(total) || total > HELPER_DATA_PLANE_MAXIMUM_BYTES) {
			throw new RangeError('The selected V14 helper input byte total exceeds its hard bound.');
		}
	}
	return total;
}
