/* SPDX-License-Identifier: AGPL-3.0-only */
/** Main-private V12 project/body authority for durable native-media jobs. */

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm, statfs, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import {
	createNativeMediaPublicationPlan,
} from '../src/common/editor/native-media-atomic-publication.ts';
import {
	type NativeMediaPlanEnvelopeV1,
} from '../src/common/editor/native-media-plan-envelope.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { resolveNativeMediaProxyGeometry } from '../src/common/editor/native-media-proxy-recipe.ts';
import type { NativeQueueRecordV2 } from '../src/common/editor/native-queue-record.ts';
import type { NativeQueueRevalidationV1 } from '../src/common/editor/native-queue-state-machine.ts';
import {
	HELPER_DATA_CHUNK_MAXIMUM_BYTES,
	HELPER_DATA_PLANE_MAXIMUM_BYTES,
	type HelperDataPlaneBinding,
} from './helper-data-plane.ts';
import { sendHelperDataPlaneFile, type HelperDataPlaneIoPort } from './helper-data-plane-io.ts';
import type { HelperDataPlaneTransferPort } from './helper-data-plane-transfer.ts';
import type { HelperNativeFileIdentity } from './helper-native-job-contract.ts';
import type { NativeMediaHelperPoolJobRequest } from './native-media-helper-pool.ts';
import type { PreparedNativeMediaQueueJob } from './native-media-queue-dispatcher.ts';
import { authenticateOpenFxProjectTimingAssets } from './openfx-main-project-timing-authority.ts';
import {
	recoverNativeImageSequenceCheckpoint,
	type FramescaperNativeCheckpointStore,
} from './native-services-checkpoint-recovery.ts';
import {
	publishVerifiedNativeMediaOutput,
	type FramescaperNativePublicationFence,
	type FramescaperNativePublicationPort,
} from './native-services-publication.ts';
import {
	authenticateNativeProjectPlanBodies,
	nativeProjectPlanBodyMetadataMatches,
	stageAuthenticatedVideoTimingAssets,
	type AuthenticatedNativeProjectPlanBodies,
	type NativeProjectMediaBody,
} from './native-services-video-timing-staging.ts';
import type {
	FramescaperNativeRootGrant,
	FramescaperNativeRootObservation,
} from './native-services-root-repository.ts';

const SHA256 = /^[a-f0-9]{64}$/u;
const MAXIMUM_SOURCE_BODIES = 4_096;

type ProjectBody = NativeProjectMediaBody;

interface ProjectRecord {
	readonly projectId: string;
	readonly projectRevision: number;
	readonly projectSha256: string;
	readonly bodies: readonly Readonly<ProjectBody>[];
}

interface ProjectBundle {
	readonly project: Readonly<{ readonly projectRevision: number; readonly sha256: string }>;
	readonly document: string;
	readonly bodies: readonly Readonly<ProjectBody>[];
}

export interface FramescaperNativeProjectAuthorityPort {
	projectState(projectId: string): Readonly<{ open: boolean; writable: boolean }>;
	projectRecord(projectId: string): ProjectRecord | null;
	readProjectBundle(projectId: string): Promise<unknown>;
	readBody(body: unknown): Promise<Uint8Array>;
}

export interface FramescaperNativeProjectAuthorityMessageChannel {
	readonly hostPort: HelperDataPlaneIoPort;
	readonly helperPort: HelperDataPlaneTransferPort;
}

export interface FramescaperNativeProjectAuthorityOptions {
	readonly project: FramescaperNativeProjectAuthorityPort;
	readonly scratchRoot: string;
	readonly executable: () => Readonly<{
		path: string;
		byteLength: number;
		sha256: string;
		identity: Readonly<HelperNativeFileIdentity>;
	}> | null;
	readonly createMessageChannel: () => FramescaperNativeProjectAuthorityMessageChannel;
	readonly probeRoot: (grant: FramescaperNativeRootGrant) => Promise<FramescaperNativeRootObservation>;
	readonly publicationPortFor: (grant: FramescaperNativeRootGrant) => FramescaperNativePublicationPort;
	readonly publicationFenceFor: (
		record: NativeQueueRecordV2,
		root: FramescaperNativeRootGrant,
	) => FramescaperNativePublicationFence;
	readonly reserveScratch: (request: Readonly<{
		jobId: string;
		directoryName: string;
		manifestDigest: string;
		rootIdentity: string;
		requestedBytes: number;
		volume: Readonly<{ totalBytes: number; freeBytes: number }>;
	}>) => Promise<void> | void;
	readonly settleScratch: (jobId: string, outcome: 'succeeded' | 'cancelled' | 'failed') => Promise<void>;
	readonly scratchMatches: (record: NativeQueueRecordV2, manifestDigest: string) => Promise<boolean> | boolean;
	readonly licensingCleared: (record: NativeQueueRecordV2) => boolean;
	readonly checkpointStore?: FramescaperNativeCheckpointStore;
	readonly checkpointInspectFor?: FramescaperNativeServicesProjectCheckpointInspectFor;
	readonly onCheckpointError?: (error: unknown, record: NativeQueueRecordV2) => void;
}

type FramescaperNativeServicesProjectCheckpointInspectFor = (
	grant: FramescaperNativeRootGrant,
) => Parameters<typeof recoverNativeImageSequenceCheckpoint>[0]['inspect'];

export class FramescaperNativeProjectAuthority {
	readonly #options: FramescaperNativeProjectAuthorityOptions;
	readonly #scratchRoot: string;

	constructor(options: FramescaperNativeProjectAuthorityOptions) {
		this.#options = options;
		this.#scratchRoot = absolutePath(options.scratchRoot, 'scratch root');
	}

	projectState(projectId: string): Readonly<{ open: boolean; writable: boolean }> {
		return this.#options.project.projectState(projectId);
	}

	openFxTimingAssets(plan: unknown) {
		return authenticateOpenFxProjectTimingAssets({
			plan, project: this.#options.project, parseBundle: projectBundle,
		});
	}

	watchProject(projectId: string): Readonly<{
		schemaVersion: 20;
		projectId: string;
		projectRevision: number;
		open: boolean;
		writable: boolean;
	}> | null {
		const state = this.projectState(projectId);
		const record = this.#options.project.projectRecord(projectId);
		if (record === null || record.projectId !== projectId) return null;
		return Object.freeze({
			schemaVersion: 20, projectId, projectRevision: record.projectRevision,
			open: state.open, writable: state.writable,
		});
	}

	/** Recover the narrow save-before-watch-acknowledgement crash window. */
	async watchImportAlreadyPresent(projectId: string, contentSha256: string): Promise<boolean> {
		if (!SHA256.test(contentSha256)) throw new TypeError('A watch-import recovery digest is invalid.');
		const record = this.#options.project.projectRecord(projectId);
		if (record === null || record.projectId !== projectId) return false;
		const bundle = projectBundle(await this.#options.project.readProjectBundle(projectId));
		if (bundle.project.projectRevision !== record.projectRevision
			|| bundle.project.sha256 !== record.projectSha256) {
			throw new Error('The watch-import recovery project changed while it was inspected.');
		}
		let value: unknown;
		try { value = JSON.parse(bundle.document) as unknown; }
		catch { throw new Error('The watch-import recovery project is not canonical JSON.'); }
		return projectContainsWatchImport(value, projectId, record.projectRevision, contentSha256);
	}

	async revalidate(
		record: NativeQueueRecordV2,
		root: FramescaperNativeRootGrant | null,
		rootAuthorized: boolean,
	): Promise<NativeQueueRevalidationV1> {
		const project = this.#options.project.projectRecord(record.projectId);
		const plan = storedPlan(record);
		const planMatches = plan.fingerprint === record.planFingerprint;
		const rootValid = rootAuthorized && root !== null && await this.#rootValid(root);
		const manifestDigest = scratchManifestDigest(record, root?.directoryIdentity ?? 'missing-root');
		const scratchMatches = record.state === 'running'
			? await this.#options.scratchMatches(record, manifestDigest)
			: true;
		const checkpoint = await recoverNativeImageSequenceCheckpoint({
			record, rootUsable: rootValid && scratchMatches,
			...(this.#options.checkpointStore ? { store: this.#options.checkpointStore } : {}),
			...(root && this.#options.checkpointInspectFor
				? { inspect: this.#options.checkpointInspectFor(root) } : {}),
			onError: (error) => this.#options.onCheckpointError?.(error, record),
		});
		return Object.freeze({
			projectRevisionMatches: project?.projectRevision === record.projectRevision,
			planFingerprintMatches: planMatches,
			inputFingerprintsMatch: project !== null && inputsMatch(record, project, plan.plan),
			rootGrantAuthorized: rootAuthorized,
			rootGrantValid: rootValid,
			licensingCleared: this.#options.licensingCleared(record),
			helperBuildMatches: this.#options.executable() !== null,
			scratchIdentityMatches: scratchMatches,
			...checkpoint,
		});
	}

	async prepare(
		record: NativeQueueRecordV2,
		root: FramescaperNativeRootGrant,
	): Promise<PreparedNativeMediaQueueJob> {
		const executable = this.#options.executable();
		if (executable === null) throw new Error('The authenticated native media executable is unavailable.');
		if (!this.#options.licensingCleared(record)) throw new Error('Native media licensing remains fail-closed.');
		if (!await this.#rootValid(root)) throw new Error('The native destination root changed identity.');
		const projectRecord = this.#options.project.projectRecord(record.projectId);
		if (!projectRecord || projectRecord.projectRevision !== record.projectRevision) {
			throw new Error('The native queue project revision is no longer current.');
		}
		const bundle = projectBundle(await this.#options.project.readProjectBundle(record.projectId));
		if (bundle.project.projectRevision !== record.projectRevision
			|| bundle.project.sha256 !== projectRecord.projectSha256
			|| !inputsMatch(record, projectRecord, storedPlan(record).plan)) {
			throw new Error('The native queue project or input fingerprint changed before staging.');
		}
		const authenticated = await authenticateNativeProjectPlanBodies({
			plan: storedPlan(record).plan, inputFingerprints: record.inputFingerprints,
			bodies: bundle.bodies,
			readBody: (body) => this.#options.project.readBody(body),
			maximumStagedBytes: record.reservations.scratchBytes,
		});
		const directory = await this.#prepareScratch(record, root);
		try {
			return await this.#preparedJob(record, root, executable, authenticated, bundle, directory);
		} catch (error) {
			await this.#options.settleScratch(record.jobId, 'failed').catch(() => undefined);
			throw error;
		}
	}

	async #prepareScratch(
		record: NativeQueueRecordV2,
		root: FramescaperNativeRootGrant,
	): Promise<Readonly<{ path: string; manifestDigest: string }>> {
		await mkdir(this.#scratchRoot, { recursive: true, mode: 0o700 });
		const directoryName = `job-${record.jobId}`;
		const path = join(this.#scratchRoot, directoryName);
		const manifestDigest = scratchManifestDigest(record, root.directoryIdentity);
		const volume = await statfs(this.#scratchRoot, { bigint: true });
		await this.#options.reserveScratch({
			jobId: record.jobId, directoryName, manifestDigest,
			rootIdentity: root.directoryIdentity, requestedBytes: record.reservations.scratchBytes,
			volume: Object.freeze({
				totalBytes: safeBigInt(volume.blocks * volume.bsize, 'scratch volume bytes'),
				freeBytes: safeBigInt(volume.bavail * volume.bsize, 'scratch free bytes'),
			}),
		});
		await resetOwnedScratch(path, record.jobId, manifestDigest, root.directoryIdentity);
		return Object.freeze({ path, manifestDigest });
	}

	async #preparedJob(
		record: NativeQueueRecordV2,
		root: FramescaperNativeRootGrant,
		executable: NonNullable<ReturnType<FramescaperNativeProjectAuthorityOptions['executable']>>,
		authenticated: AuthenticatedNativeProjectPlanBodies,
		bundle: ProjectBundle,
		directory: Readonly<{ path: string; manifestDigest: string }>,
	): Promise<PreparedNativeMediaQueueJob> {
		const { envelope } = authenticated;
		const planPath = join(directory.path, 'queue-plan.json');
		await writeFile(planPath, record.planPayload, { flag: 'wx', mode: 0o600 });
		const sources = [];
		for (const [index, body] of authenticated.originals.entries()) {
			const path = join(directory.path, `source-${String(index).padStart(4, '0')}.media`);
			const bytes = await this.#options.project.readBody(body);
			if (bytes.byteLength !== body.byteLength || digest(bytes) !== body.sha256) {
				throw new Error('A managed native source body changed during staging.');
			}
			await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
			const identity = await fileIdentity(path);
			sources.push(Object.freeze({
				type: 'file' as const, role: 'original' as const, path,
				bytes: body.byteLength, sha256: body.sha256, identity,
			}));
		}
		const videoTimingAssets = await stageAuthenticatedVideoTimingAssets(
			directory.path, authenticated.timingAssets,
		);
		const publication = createNativeMediaPublicationPlan({
			jobId: record.jobId, relativeDestination: record.relativeDestination,
			planFingerprint: record.planFingerprint,
		});
		const output = await outputGrant(root, publication, maximumOutputBytes(envelope));
		const scratchIdentity = await directoryIdentity(directory.path);
		const planBinding = dataBinding(record, envelope);
		const channel = this.#options.createMessageChannel();
		const transferAbort = new AbortController();
		const transfer = sendHelperDataPlaneFile({
			binding: planBinding, port: channel.hostPort, path: planPath, signal: transferAbort.signal,
		});
		const base = {
			executable: Object.freeze({
				role: 'ffmpeg' as const, path: executable.path, bytes: executable.byteLength,
				sha256: executable.sha256, identity: executable.identity,
			}),
			plan: planBinding,
			...(videoTimingAssets.length === 0 ? {} : { videoTimingAssets }),
			output,
			scratch: Object.freeze({
				rootPath: directory.path, rootIdentity: scratchIdentity,
				reservationId: digest(`${record.jobId}:helper-reservation`).slice(0, 40),
				maximumBytes: record.reservations.scratchBytes,
			}),
		};
		const kind = record.taskKind === 'proxy-generation' ? 'media-proxy' as const : 'media-render' as const;
		const grant = kind === 'media-proxy'
			? Object.freeze({
				...base, source: onlySource(sources),
				proxyRecipe: proxyRecipe(bundle, record.inputFingerprints[0]?.sourceId),
			})
			: Object.freeze({ ...base, sources: Object.freeze(sources) });
		const request = Object.freeze({
			kind,
			grant,
			dataPlaneTransfers: Object.freeze([Object.freeze({
				streamId: planBinding.streamId, port: channel.helperPort,
			})]),
			resourcePolicy: Object.freeze({
				maximumInputBytes: safeSum(executable.byteLength, authenticated.requiredStagedBytes),
				maximumOutputBytes: output.maximumBytes,
				maximumScratchBytes: record.reservations.scratchBytes,
				maximumDataPlaneBytes: envelope.canonicalByteLength,
				maximumInFlightChunks: 1,
				maximumRssBytes: record.reservations.processTreeRssBytes,
			}),
		}) as NativeMediaHelperPoolJobRequest;
		let settled = false;
		return Object.freeze({
			request,
			publish: async (result: unknown) => {
				await transfer;
				const outputResult = helperOutput(result);
				await publishVerifiedNativeMediaOutput({
					plan: publication, currentPlanFingerprint: record.planFingerprint,
					finalized: true, declaredByteLength: outputResult.byteLength,
					declaredSha256: outputResult.sha256,
				}, this.#options.publicationPortFor(root), this.#options.publicationFenceFor(record, root));
			},
			cleanup: async (outcome: 'succeeded' | 'paused' | 'cancelled' | 'failed') => {
				if (settled) return;
				settled = true;
				transferAbort.abort();
				await transfer.catch(() => undefined);
				await this.#options.settleScratch(record.jobId, outcome === 'paused' ? 'cancelled' : outcome);
			},
		});
	}

	async #rootValid(root: FramescaperNativeRootGrant): Promise<boolean> {
		const observed = await this.#options.probeRoot(root);
		return observed.exists && observed.directory && !observed.symbolicLink
			&& observed.canonicalPath === root.rootPath
			&& observed.volumeIdentity === root.volumeIdentity
			&& observed.directoryIdentity === root.directoryIdentity;
	}
}

function projectContainsWatchImport(
	value: unknown,
	projectId: string,
	projectRevision: number,
	contentSha256: string,
): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const project = value as Record<string, unknown>;
	if (project.schemaVersion !== 20 || project.id !== projectId
		|| project.revision !== projectRevision || !Array.isArray(project.sources)
		|| !project.projectBin || typeof project.projectBin !== 'object') return false;
	const sourceIds = new Set(project.sources.flatMap((source) => {
		if (!source || typeof source !== 'object' || Array.isArray(source)) return [];
		const row = source as Record<string, unknown>;
		return row.kind === 'video' && row.contentSha256 === contentSha256
			&& typeof row.id === 'string' ? [row.id] : [];
	}));
	const clips = (project.projectBin as Record<string, unknown>).clips;
	return sourceIds.size > 0 && Array.isArray(clips) && clips.some((clip) => {
		if (!clip || typeof clip !== 'object' || Array.isArray(clip)) return false;
		return sourceIds.has(String((clip as Record<string, unknown>).sourceId));
	});
}

function storedPlan(record: NativeQueueRecordV2): Readonly<{
	plan: Readonly<Record<string, unknown>>;
	fingerprint: string;
}> {
	let value: unknown;
	try { value = JSON.parse(record.planPayload) as unknown; }
	catch { throw new Error('The queued native media plan is not JSON.'); }
	const fingerprint = fingerprintNativeMediaPlan(value);
	const plan = value as Readonly<Record<string, unknown>>;
	if (plan.version !== record.planVersion || fingerprint.sha256 !== record.planFingerprint
		|| fingerprint.canonical !== record.planPayload) {
		throw new Error('The queued native media plan changed exact version or fingerprint.');
	}
	return Object.freeze({ plan, fingerprint: fingerprint.sha256 });
}

function projectBundle(value: unknown): ProjectBundle {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A V12 native project bundle is unavailable.');
	const raw = value as Record<string, unknown>;
	if (typeof raw.document !== 'string' || !raw.project || typeof raw.project !== 'object'
		|| !Array.isArray(raw.bodies) || raw.bodies.length > MAXIMUM_SOURCE_BODIES) {
		throw new TypeError('A V12 native project bundle is malformed.');
	}
	const project = raw.project as Record<string, unknown>;
	if (!Number.isSafeInteger(project.projectRevision) || typeof project.sha256 !== 'string'
		|| !SHA256.test(project.sha256)) throw new TypeError('A V12 native project row is malformed.');
	return Object.freeze({
		project: Object.freeze({ projectRevision: Number(project.projectRevision), sha256: project.sha256 }),
		document: raw.document,
		bodies: Object.freeze(raw.bodies.map(projectBody)),
	});
}

function projectBody(value: unknown): Readonly<ProjectBody> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A native project body is malformed.');
	const body = value as Record<string, unknown>;
	if (!['video-original', 'video-proxy', 'video-timing'].includes(String(body.kind))
		|| typeof body.encoding !== 'string'
		|| (body.kind === 'video-proxy' && typeof body.bindingId !== 'string')
		|| typeof body.sourceId !== 'string' || body.sourceId.length === 0
		|| body.storageKey !== body.sourceId
		|| typeof body.mimeType !== 'string' || body.mimeType.length === 0
		|| !Number.isSafeInteger(body.byteLength) || Number(body.byteLength) < 1
		|| typeof body.sha256 !== 'string' || !SHA256.test(body.sha256)) {
		throw new TypeError('A native project body has invalid identity or digest fields.');
	}
	return Object.freeze({
		kind: body.kind as ProjectBody['kind'], encoding: body.encoding,
		...(body.kind === 'video-proxy' ? { bindingId: body.bindingId as string } : {}),
		sourceId: body.sourceId, storageKey: body.sourceId, mimeType: body.mimeType,
		byteLength: Number(body.byteLength), sha256: body.sha256,
	});
}

function inputsMatch(record: NativeQueueRecordV2, project: ProjectRecord, plan: unknown): boolean {
	return nativeProjectPlanBodyMetadataMatches(plan, record.inputFingerprints, project.bodies);
}

function dataBinding(record: NativeQueueRecordV2, envelope: NativeMediaPlanEnvelopeV1): HelperDataPlaneBinding {
	return Object.freeze({
		dataPlaneVersion: 1, transport: 'message-port',
		streamId: digest(`${record.jobId}:plan:${record.planFingerprint}`).slice(0, 40),
		direction: 'host-to-helper', byteLength: envelope.canonicalByteLength,
		sha256: record.planFingerprint,
		maximumChunkBytes: HELPER_DATA_CHUNK_MAXIMUM_BYTES, maximumInFlightChunks: 1,
	});
}

async function outputGrant(
	root: FramescaperNativeRootGrant,
	publication: ReturnType<typeof createNativeMediaPublicationPlan>,
	maximumBytes: number,
) {
	const rootIdentity = await directoryIdentity(root.rootPath);
	const finalPath = resolveInside(root.rootPath, publication.relativeDestination);
	const temporaryPath = resolveInside(root.rootPath, publication.temporaryRelativePath);
	await assertExistingParent(root.rootPath, dirname(finalPath));
	try {
		const partial = await lstat(temporaryPath);
		if (!partial.isFile() || partial.isSymbolicLink()) throw new Error('A native partial output is not a regular file.');
		await unlink(temporaryPath);
	} catch (error) {
		if (!missing(error)) throw error;
	}
	return Object.freeze({ rootPath: root.rootPath, rootIdentity, temporaryPath, finalPath, maximumBytes });
}

function maximumOutputBytes(envelope: NativeMediaPlanEnvelopeV1): number {
	const summary = envelope.summary;
	const pixels = safeProduct(summary.width, summary.height, Math.max(1, summary.outputFrameCount), 4);
	return Math.min(HELPER_DATA_PLANE_MAXIMUM_BYTES, Math.max(1, pixels));
}

function proxyRecipe(bundle: ProjectBundle, sourceId: string | undefined) {
	if (!sourceId) throw new Error('A proxy queue record must name one exact original source.');
	const project = JSON.parse(bundle.document) as Record<string, unknown>;
	const source = Array.isArray(project.sources) ? project.sources.find((candidate) => (
		candidate && typeof candidate === 'object' && (candidate as Record<string, unknown>).id === sourceId
	)) as Record<string, unknown> | undefined : undefined;
	if (!source) throw new Error('A proxy queue source is absent from its exact project.');
	const geometry = resolveNativeMediaProxyGeometry(Number(source.width), Number(source.height));
	return Object.freeze({
		id: 'framescaper-native-prores-proxy-mov-v1' as const,
		width: geometry.width,
		height: geometry.height,
	});
}

function onlySource<Value>(sources: readonly Value[]): Value {
	if (sources.length !== 1) throw new Error('A proxy queue job requires exactly one original source.');
	return sources[0]!;
}

function helperOutput(value: unknown): Readonly<{ byteLength: number; sha256: string }> {
	const output = (value as Record<string, unknown> | null)?.output as Record<string, unknown> | undefined;
	if (!output || !Number.isSafeInteger(output.byteLength) || Number(output.byteLength) < 0
		|| typeof output.sha256 !== 'string' || !SHA256.test(output.sha256)) {
		throw new Error('The native helper returned no exact verified output.');
	}
	return Object.freeze({ byteLength: Number(output.byteLength), sha256: output.sha256 });
}

async function resetOwnedScratch(path: string, jobId: string, manifestDigest: string, rootIdentity: string): Promise<void> {
	try {
		const current = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')) as Record<string, unknown>;
		if (current.jobId !== jobId || current.manifestDigest !== manifestDigest || current.rootIdentity !== rootIdentity) {
			throw new Error('Existing native scratch is not owned by this exact queue job.');
		}
		await rm(path, { recursive: true, force: false });
	} catch (error) {
		if (!missing(error)) throw error;
	}
	await mkdir(path, { recursive: false, mode: 0o700 });
	await writeFile(join(path, 'manifest.json'), JSON.stringify({ jobId, manifestDigest, rootIdentity }), {
		flag: 'wx', mode: 0o600,
	});
}

function scratchManifestDigest(record: NativeQueueRecordV2, rootIdentity: string): string {
	return digest(`${record.jobId}:${record.planFingerprint}:${rootIdentity}`);
}

async function fileIdentity(path: string): Promise<Readonly<HelperNativeFileIdentity>> {
	const value = await lstat(path);
	if (!value.isFile() || value.isSymbolicLink()) throw new Error('A staged native source is not a regular file.');
	return Object.freeze({ dev: value.dev, ino: value.ino });
}

async function directoryIdentity(path: string): Promise<Readonly<HelperNativeFileIdentity>> {
	const value = await lstat(path);
	if (!value.isDirectory() || value.isSymbolicLink()) throw new Error('A native directory grant changed identity.');
	return Object.freeze({ dev: value.dev, ino: value.ino });
}

async function assertExistingParent(root: string, parent: string): Promise<void> {
	if (relative(root, parent).startsWith('..') || isAbsolute(relative(root, parent))) throw new Error('A native output escaped its root.');
	const value = await lstat(parent);
	if (!value.isDirectory() || value.isSymbolicLink() || await realpath(parent) !== parent) {
		throw new Error('A native output parent is not one canonical regular directory.');
	}
}

function resolveInside(root: string, relativePath: string): string {
	const path = resolve(root, ...relativePath.split('/'));
	const child = relative(root, path);
	if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('A native path escaped its granted root.');
	return path;
}

function absolutePath(value: string, label: string): string {
	if (typeof value !== 'string' || !isAbsolute(value) || normalize(value) !== value || value.includes('\0')) {
		throw new TypeError(`The native ${label} must be an absolute normalized path.`);
	}
	return value;
}

function digest(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }

function safeProduct(...values: number[]): number {
	return values.reduce((total, value) => {
		if (!Number.isSafeInteger(value) || value < 0 || (value !== 0 && total > Number.MAX_SAFE_INTEGER / value)) {
			return HELPER_DATA_PLANE_MAXIMUM_BYTES;
		}
		return total * value;
	}, 1);
}

function safeSum(left: number, right: number): number {
	if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0
		|| left > Number.MAX_SAFE_INTEGER - right) throw new RangeError('Native staged byte accounting overflowed.');
	return left + right;
}

function safeBigInt(value: bigint, label: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(`Native ${label} is out of range.`);
	return number;
}

function missing(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && 'code' in error
		&& (error.code === 'ENOENT' || error.code === 'ENOTDIR'));
}
