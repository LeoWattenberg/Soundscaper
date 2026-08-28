/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned native still decode with opaque, owner-bound RGBA-pack range claims. */

import { constants } from 'node:fs';
import {
	lstat, mkdir, open, rm, unlink, writeFile, type FileHandle,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
	fingerprintNativeMediaPlan,
} from '../src/common/editor/native-media-plan-canonical-form.ts';
import type { HelperDataPlaneIoPort } from './helper-data-plane-io.ts';
import {
	HELPER_DATA_CHUNK_MAXIMUM_BYTES,
	HELPER_DATA_PLANE_MAXIMUM_BYTES,
} from './helper-data-plane.ts';
import {
	receiveHelperDataPlaneReservedFile,
	sendHelperDataPlaneFile,
} from './helper-data-plane-io.ts';
import type { HelperDataPlaneTransferPort } from './helper-data-plane-transfer.ts';
import type { HelperNativeFileIdentity } from './helper-native-job-contract.ts';
import {
	admitFramescaperNativeImageSequenceSource,
	authenticateFramescaperDecodedImageSequencePack,
	createFramescaperNativeImageSequenceDecodePlan,
	exactFramescaperDecodedImageSequenceByteLength,
	type AdmittedNativeImageSequence,
} from './native-image-sequence-decode-admission.ts';
import type { FramescaperNativeMediaRuntime } from './native-media-runtime.ts';
import type { FramescaperNativeImageSequenceDecodeRequest } from './native-image-sequence-decode-contract.ts';

const MAXIMUM_ACTIVE_DECODE_REQUESTS = 4;
const MAXIMUM_OPEN_CLAIMS = 8;
const MAXIMUM_READ_BYTES = 16 * 1024 * 1024;

interface ProjectAuthority {
	projectState(projectId: string): Readonly<{
		schemaFamily: 'framescaper'; schemaVersion: 1; open: boolean; writable: boolean;
	}>;
	readProjectBundle(projectId: string): Promise<unknown>;
}

interface MessageChannel {
	readonly hostPort: HelperDataPlaneIoPort;
	readonly helperPort: HelperDataPlaneTransferPort;
}

interface DecodeClaim {
	readonly claimId: string;
	readonly owner: object;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly sourceId: string;
	readonly path: string;
	readonly handle: FileHandle;
	readonly byteLength: number;
	readonly sha256: string;
	readonly frameCount: number;
	readonly width: number;
	readonly height: number;
	readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
}

interface ActiveDecode {
	readonly owner: object;
	readonly requestId: string;
	readonly abort: AbortController;
	readonly completion: Promise<void>;
	readonly settle: () => void;
}

export interface FramescaperNativeImageSequenceDecodeAuthorityOptions {
	readonly root: string;
	readonly scratchRoot: string;
	readonly project: ProjectAuthority;
	readonly executable: () => Readonly<{
		readonly path: string;
		readonly byteLength: number;
		readonly sha256: string;
		readonly identity: Readonly<HelperNativeFileIdentity>;
	}> | null;
	readonly createMessageChannel: () => MessageChannel;
	readonly mediaRuntime: Pick<FramescaperNativeMediaRuntime, 'available' | 'runJob'>;
	readonly mintOpaqueId: () => string;
	readonly runtimeAvailable: () => boolean;
	/** Report-only milestone-9 stable-release review status. */
}

export class FramescaperNativeImageSequenceDecodeAuthority {
	readonly #options: FramescaperNativeImageSequenceDecodeAuthorityOptions;
	readonly #active = new Map<string, ActiveDecode>();
	readonly #claims = new Map<string, DecodeClaim>();
	readonly #closedClaimHandles = new Set<string>();
	#disposeRequested = false;
	#disposed = false;
	#disposePromise: Promise<void> | null = null;

	constructor(options: FramescaperNativeImageSequenceDecodeAuthorityOptions) {
		assertOptions(options);
		this.#options = Object.freeze({
			...options, root: resolve(options.root), scratchRoot: resolve(options.scratchRoot),
		});
	}

	request(ownerValue: object, request: FramescaperNativeImageSequenceDecodeRequest): Promise<unknown> {
		this.#assertOpen();
		const owner = exactOwner(ownerValue);
		if (request.operation === 'decode') return this.#decode(owner, request);
		if (request.operation === 'cancel') return Promise.resolve(this.#cancel(owner, request.requestId));
		if (request.operation === 'read') return this.#read(owner, request);
		return this.#release(owner, request.claimId);
	}

	async revokeOwner(ownerValue: object): Promise<void> {
		const owner = exactOwner(ownerValue);
		const pending: Promise<void>[] = [];
		for (const active of this.#active.values()) {
			if (active.owner !== owner) continue;
			active.abort.abort(new DOMException('Renderer decode authority was revoked.', 'AbortError'));
			pending.push(active.completion);
		}
		await Promise.all(pending);
		await Promise.all([...this.#claims.values()]
			.filter((claim) => claim.owner === owner)
			.map((claim) => this.#release(owner, claim.claimId)));
	}

	dispose(): Promise<void> {
		if (this.#disposed) return Promise.resolve();
		if (this.#disposePromise !== null) return this.#disposePromise;
		this.#disposeRequested = true;
		const operation = (async () => {
			const pending = [...this.#active.values()];
			for (const active of pending) {
				active.abort.abort(new DOMException('Image-sequence decode authority was disposed.', 'AbortError'));
			}
			await Promise.all(pending.map(({ completion }) => completion));
			const cleanup = await Promise.allSettled(
				[...this.#claims.values()].map((claim) => this.#cleanupClaim(claim)),
			);
			const failures = cleanup.filter((value): value is PromiseRejectedResult => value.status === 'rejected')
				.map(({ reason }) => reason);
			if (failures.length) throw new AggregateError(failures, 'Image-sequence decode disposal cleanup failed.');
			this.#disposed = true;
		})();
		this.#disposePromise = operation.catch((error: unknown) => {
			this.#disposePromise = null;
			throw error;
		});
		return this.#disposePromise;
	}

	async #decode(
		owner: object,
		request: Extract<FramescaperNativeImageSequenceDecodeRequest, { operation: 'decode' }>,
	): Promise<unknown> {
		if (request.schemaFamily !== 'framescaper' || request.schemaVersion !== 1) {
			throw new TypeError('Image-sequence decode requires the current Framescaper project identity.');
		}
		if (!this.#options.runtimeAvailable()
			|| !this.#options.mediaRuntime.available()) {
			throw new Error('Native image-sequence decode is unavailable.');
		}
		if (this.#active.size >= MAXIMUM_ACTIVE_DECODE_REQUESTS
			|| this.#claims.size + this.#active.size >= MAXIMUM_OPEN_CLAIMS
			|| this.#active.has(request.requestId)) {
			throw new Error('Native image-sequence decode capacity or request identity is exhausted.');
		}
		const abort = new AbortController();
		let settle = (): void => undefined;
		const completion = new Promise<void>((resolveCompletion) => { settle = resolveCompletion; });
		const active = Object.freeze({ owner, requestId: request.requestId, abort, completion, settle });
		this.#active.set(request.requestId, active);
		try {
			const admitted = await this.#admitSource(request);
			abort.signal.throwIfAborted();
			return await this.#runDecode(owner, request, admitted, abort.signal);
		} finally {
			if (this.#active.get(request.requestId) === active) this.#active.delete(request.requestId);
			active.settle();
		}
	}

	#cancel(owner: object, requestId: string): boolean {
		const active = this.#active.get(requestId);
		if (!active || active.owner !== owner) return false;
		active.abort.abort(new DOMException('Image-sequence decode was cancelled.', 'AbortError'));
		return true;
	}

	async #read(
		owner: object,
		request: Extract<FramescaperNativeImageSequenceDecodeRequest, { operation: 'read' }>,
	): Promise<Uint8Array> {
		const claim = this.#claims.get(request.claimId);
		if (!claim || claim.owner !== owner || this.#closedClaimHandles.has(claim.claimId)
			|| request.length > MAXIMUM_READ_BYTES
			|| request.offset + request.length > claim.byteLength) {
			throw new Error('The decoded image-sequence range is outside this owner claim.');
		}
		const bytes = new Uint8Array(request.length);
		const result = await claim.handle.read(bytes, 0, bytes.byteLength, request.offset);
		if (result.bytesRead !== bytes.byteLength) throw new Error('The decoded image-sequence range read was short.');
		return bytes;
	}

	async #release(owner: object, claimId: string): Promise<boolean> {
		const claim = this.#claims.get(claimId);
		if (!claim || claim.owner !== owner) return false;
		await this.#cleanupClaim(claim);
		return true;
	}

	async #cleanupClaim(claim: DecodeClaim): Promise<void> {
		if (!this.#closedClaimHandles.has(claim.claimId)) {
			try { await claim.handle.close(); }
			catch (error) {
				throw new AggregateError([error], 'Decoded image-sequence claim cleanup failed.');
			}
			this.#closedClaimHandles.add(claim.claimId);
		}
		try { await unlink(claim.path); }
		catch (error) {
			throw new AggregateError([error], 'Decoded image-sequence claim cleanup failed.');
		}
		this.#claims.delete(claim.claimId);
		this.#closedClaimHandles.delete(claim.claimId);
	}

	async #admitSource(request: Readonly<{
		schemaFamily: 'framescaper'; schemaVersion: 1;
		projectId: string; projectRevision: number; sourceId: string;
	}>) {
		const state = this.#options.project.projectState(request.projectId);
		if (state?.schemaFamily !== 'framescaper' || state.schemaVersion !== 1 || !state.open) {
			throw new Error('Image-sequence decode requires the open current Framescaper project.');
		}
		return admitFramescaperNativeImageSequenceSource({
			schemaFamily: request.schemaFamily, schemaVersion: request.schemaVersion,
			root: this.#options.root, projectId: request.projectId,
			projectRevision: request.projectRevision, sourceId: request.sourceId,
			projectBundle: await this.#options.project.readProjectBundle(request.projectId),
		});
	}

	async #runDecode(
		owner: object,
		request: Readonly<{ requestId: string; projectId: string; projectRevision: number; sourceId: string }>,
		admitted: AdmittedNativeImageSequence,
		signal: AbortSignal,
	): Promise<unknown> {
		const executable = this.#options.executable();
		if (!executable) throw new Error('The authenticated native media executable is unavailable.');
		const plan = createFramescaperNativeImageSequenceDecodePlan(
			request.projectId, request.projectRevision, admitted.source,
		);
		const fingerprint = fingerprintNativeMediaPlan(plan);
		const planBytes = Buffer.from(fingerprint.canonical);
		const outputBytes = exactFramescaperDecodedImageSequenceByteLength(admitted.source);
		if (outputBytes > HELPER_DATA_PLANE_MAXIMUM_BYTES) {
			throw new RangeError('The decoded image sequence exceeds the helper data-plane ceiling.');
		}
		await Promise.all([
			mkdir(this.#options.scratchRoot, { recursive: true, mode: 0o700 }),
			mkdir(join(this.#options.root, 'decode-plans'), { recursive: true, mode: 0o700 }),
			mkdir(join(this.#options.root, 'decoded-claims'), { recursive: true, mode: 0o700 }),
		]);
		const scratchIdentity = await directoryIdentity(this.#options.scratchRoot);
		const planPath = join(this.#options.root, 'decode-plans', `${request.requestId}.json`);
		const claimId = opaqueId(this.#options.mintOpaqueId());
		const outputPath = join(this.#options.root, 'decoded-claims', `${claimId}.rgba-pack`);
		await writeFile(planPath, planBytes, { flag: 'wx', mode: 0o600 });
		const planBinding = Object.freeze({
			dataPlaneVersion: 1 as const, transport: 'message-port' as const,
			streamId: opaqueId(this.#options.mintOpaqueId()), direction: 'host-to-helper' as const,
			byteLength: planBytes.byteLength, sha256: fingerprint.sha256,
			maximumChunkBytes: HELPER_DATA_CHUNK_MAXIMUM_BYTES, maximumInFlightChunks: 1,
		});
		const outputReservation = Object.freeze({
			dataPlaneVersion: 1 as const, transport: 'message-port' as const,
			streamId: opaqueId(this.#options.mintOpaqueId()), direction: 'helper-to-host' as const,
			exactByteLength: outputBytes, maximumByteLength: outputBytes,
			maximumChunkBytes: HELPER_DATA_CHUNK_MAXIMUM_BYTES, maximumInFlightChunks: 1,
		});
		const [packStat, inventoryStat] = await Promise.all([
			regularFileIdentity(admitted.packPath), regularFileIdentity(admitted.inventoryPath),
		]);
		const profile = profileId(admitted.source.extension);
		const grant = Object.freeze({
			executable: Object.freeze({
				role: 'ffmpeg' as const, path: executable.path, bytes: executable.byteLength,
				sha256: executable.sha256, identity: executable.identity,
			}),
			plan: planBinding,
			sources: Object.freeze([
				Object.freeze({ type: 'file' as const, role: 'image-sequence-pack' as const,
					path: admitted.packPath, bytes: admitted.source.sourcePack.byteLength,
					sha256: admitted.source.sourcePack.sha256, identity: packStat }),
				Object.freeze({ type: 'file' as const, role: 'image-sequence-inventory' as const,
					path: admitted.inventoryPath, bytes: admitted.source.inventory.byteLength,
					sha256: admitted.source.inventory.sha256, identity: inventoryStat }),
			]),
			output: outputReservation,
			scratch: Object.freeze({
				rootPath: this.#options.scratchRoot, rootIdentity: scratchIdentity,
				reservationId: request.requestId, maximumBytes: safeAdd(planBytes.byteLength, outputBytes),
			}),
			imageSequence: Object.freeze({
				kind: 'native-image-sequence-decode-v1' as const, profileId: profile,
				frameRate: admitted.source.frameRate,
			}),
		});
		const planChannel = this.#options.createMessageChannel();
		const outputChannel = this.#options.createMessageChannel();
		const transferAbort = new AbortController();
		const relay = (): void => transferAbort.abort(signal.reason);
		if (signal.aborted) relay(); else signal.addEventListener('abort', relay, { once: true });
		try {
			const sending = sendHelperDataPlaneFile({
				binding: planBinding, port: planChannel.hostPort, path: planPath, signal: transferAbort.signal,
			});
			const receiving = receiveHelperDataPlaneReservedFile({
				reservation: outputReservation, port: outputChannel.hostPort,
				path: outputPath, signal: transferAbort.signal,
			});
			const running = this.#options.mediaRuntime.runJob({
				kind: 'media-decode', grant,
				dataPlaneTransfers: Object.freeze([
					Object.freeze({ streamId: planBinding.streamId, port: planChannel.helperPort }),
					Object.freeze({ streamId: outputReservation.streamId, port: outputChannel.helperPort }),
				]),
				resourcePolicy: Object.freeze({
					maximumInputBytes: safeSum([
						executable.byteLength, planBytes.byteLength,
						admitted.source.sourcePack.byteLength, admitted.source.inventory.byteLength,
					]),
					maximumOutputBytes: outputBytes,
					maximumScratchBytes: safeAdd(planBytes.byteLength, outputBytes),
					maximumDataPlaneBytes: safeAdd(planBytes.byteLength, outputBytes),
					maximumInFlightChunks: 1,
				}),
				signal,
			});
			let result: unknown;
			let completion: Awaited<typeof receiving>;
			try { [result, , completion] = await Promise.all([running, sending, receiving]); }
			catch (error) {
				transferAbort.abort(error);
				await Promise.allSettled([sending, receiving]);
				throw error;
			}
			const handle = await open(outputPath, constants.O_RDONLY | constants.O_NOFOLLOW);
			let installed = false;
			try {
				assertJobCompletion(result, completion);
				const header = await authenticateFramescaperDecodedImageSequencePack(handle, admitted.source, completion);
				signal.throwIfAborted();
				this.#assertOpen();
				if (this.#claims.size >= MAXIMUM_OPEN_CLAIMS) {
					throw new Error('Decoded image-sequence claim capacity changed before installation.');
				}
				const claim: DecodeClaim = Object.freeze({
					claimId, owner, projectId: request.projectId, projectRevision: request.projectRevision,
					sourceId: request.sourceId, path: outputPath, handle,
					byteLength: completion.byteLength, sha256: completion.sha256,
					frameCount: header.frameCount, width: header.width, height: header.height,
					frameRate: admitted.source.frameRate,
				});
				this.#claims.set(claimId, claim);
				installed = true;
				return Object.freeze({
					claimId, sourceId: claim.sourceId, byteLength: claim.byteLength, sha256: claim.sha256,
					frameCount: claim.frameCount, width: claim.width, height: claim.height,
					frameRate: claim.frameRate,
				});
			} finally {
				if (!installed) await handle.close().catch(() => undefined);
			}
		} catch (error) {
			await unlink(outputPath).catch(() => undefined);
			throw error;
		} finally {
			signal.removeEventListener('abort', relay);
			transferAbort.abort();
			await rm(planPath, { force: true });
		}
	}

	#assertOpen(): void {
		if (this.#disposeRequested || this.#disposed) {
			throw new Error('The image-sequence decode authority is disposed.');
		}
	}
}

async function regularFileIdentity(path: string): Promise<Readonly<HelperNativeFileIdentity>> {
	const value = await lstat(path);
	if (!value.isFile() || value.isSymbolicLink()) throw new Error('An image-sequence decode input changed file type.');
	return Object.freeze({ dev: value.dev, ino: value.ino });
}

async function directoryIdentity(path: string): Promise<Readonly<HelperNativeFileIdentity>> {
	const value = await lstat(path);
	if (!value.isDirectory() || value.isSymbolicLink()) throw new Error('The image-sequence decode scratch root changed type.');
	return Object.freeze({ dev: value.dev, ino: value.ino });
}

function assertJobCompletion(value: unknown, completion: Readonly<{ streamId: string; byteLength: number; sha256: string }>): void {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Native image-sequence decode returned no result.');
	const output = (value as Record<string, unknown>).output;
	if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error('Native image-sequence decode returned no output identity.');
	const row = output as Record<string, unknown>;
	if (row.streamId !== completion.streamId || row.byteLength !== completion.byteLength || row.sha256 !== completion.sha256) {
		throw new Error('Native image-sequence decode result disagrees with the authenticated output stream.');
	}
}

function profileId(extension: string) {
	if (extension === 'png') return 'decode-png-sequence' as const;
	if (extension === 'tif' || extension === 'tiff') return 'decode-tiff-sequence' as const;
	if (extension === 'exr') return 'decode-openexr-sequence' as const;
	throw new TypeError('The image-sequence decode extension is unsupported.');
}

function safeAdd(left: number, right: number): number {
	if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0
		|| left > Number.MAX_SAFE_INTEGER - right) throw new RangeError('Image-sequence byte accounting overflowed.');
	return left + right;
}
function safeSum(values: readonly number[]): number { return values.reduce(safeAdd, 0); }
function opaqueId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{40}$/u.test(value)) throw new TypeError('An image-sequence opaque ID is invalid.');
	return value;
}
function exactOwner(value: unknown): object {
	if (!value || typeof value !== 'object') throw new TypeError('Image-sequence decode requires a renderer owner.');
	return value;
}
function assertOptions(options: FramescaperNativeImageSequenceDecodeAuthorityOptions): void {
	if (!options || typeof options.root !== 'string' || typeof options.scratchRoot !== 'string'
		|| !options.project || typeof options.project.projectState !== 'function'
		|| typeof options.project.readProjectBundle !== 'function' || typeof options.executable !== 'function'
		|| typeof options.createMessageChannel !== 'function' || typeof options.mediaRuntime?.available !== 'function'
		|| typeof options.mediaRuntime.runJob !== 'function' || typeof options.mintOpaqueId !== 'function'
		|| typeof options.runtimeAvailable !== 'function') {
		throw new TypeError('Image-sequence decode authority options are incomplete.');
	}
}
