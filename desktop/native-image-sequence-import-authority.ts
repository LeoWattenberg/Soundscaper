/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned durable publication and native admission for dormant V25/V26 image sequences. */
import { createHash, type Hash } from 'node:crypto';
import {
	link, mkdir, open, readFile, readdir, rename, rm, unlink, writeFile,
	type FileHandle,
} from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { validateHelperProbeResult } from './helper-contract.ts';
import {
	assertFramescaperNativeImageSequenceImportPortRequest,
	assertFramescaperNativeImageSequenceImportRequest,
	framescaperNativeImageSequenceAssetPath,
	framescaperNativeImageSequenceId,
	framescaperNativeImageSequenceInteger,
	normalizeFramescaperNativeImageSequenceAdmission,
	normalizeFramescaperNativeImageSequenceReference,
	parseFramescaperNativeImageSequenceManifest,
	type FramescaperNativeImageSequenceAssetKind as AssetKind,
	type FramescaperNativeImageSequenceCandidateGeneration as CandidateGeneration,
	type FramescaperNativeImageSequenceRecoveryManifest as Manifest,
	type FramescaperNativeImageSequenceReference as Reference,
} from './native-image-sequence-import-contract.ts';
import type { HelperDataPlaneBinding } from './helper-data-plane.ts';
import { validateHelperDataPlaneBinding } from './helper-data-plane.ts';
import {
	receiveHelperDataPlaneFile,
	type HelperDataPlaneIoPort,
} from './helper-data-plane-io.ts';
import type { FramescaperNativeMediaRuntime } from './native-media-runtime.ts';
import {
	assertNativeMediaCapabilitySnapshotV1,
	isNativeMediaCapabilityUsable,
	nativeMediaCapabilityEntry,
	NATIVE_MEDIA_CAPABILITY_IDS,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import {
	NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_INVENTORY_BYTES,
	NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_PACK_BYTES,
	validateNativeMediaImageSequenceInventoryBytesV25,
	type NativeMediaImageSequenceInventoryReferenceV25,
	type NativeMediaImageSequenceSourcePackReferenceV25,
} from '../src/common/editor/native-media-image-sequence-v25.ts';
import {
	NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_MAXIMUM_CHUNK_BYTES,
	validateNativeMediaImageSequenceSourcePackV25,
} from '../src/common/editor/native-media-image-sequence-pack-v25.ts';
import { evaluateNativeMediaProfileAdmission } from '../src/common/editor/native-media-professional-profiles.ts';
import {
	normalizeVideoSourceCharacteristicsV25,
	type VideoSourceCharacteristicsV25,
} from '../src/common/editor/video-source-professional-characteristics-v25.ts';
import {
	assertImageSequenceReferenceFile,
	assertImageSequenceReferenceHandle,
	assertImageSequenceRegularFile,
	digestImageSequencePath,
	imageSequenceFsErrorHasCode,
	imageSequenceStorageSha256,
	readImageSequenceRange,
	referenceFromImageSequenceStorageKey,
} from './native-image-sequence-import-storage.ts';

type Awaitable<Value> = Value | PromiseLike<Value>;

const POLICY_ROW = 'codec-image-sequence-still-formats';
const TRANSACTION_ID = /^[a-f0-9]{40}$/u;
const MANIFEST_VERSION = 1;
const MAXIMUM_ACTIVE_TRANSACTIONS = 64;
export interface FramescaperNativeImageSequenceProjectState {
	readonly open: boolean;
	readonly writable: boolean;
	readonly schemaVersion: CandidateGeneration;
	readonly revision: number;
}

export interface FramescaperNativeImageSequenceImportAuthorityOptions {
	readonly root: string;
	readonly mintOpaqueId: () => string;
	readonly capabilities: () => Awaitable<unknown>;
	readonly runtimeAvailable: () => boolean;
	readonly clearedPolicyRowIds: () => Awaitable<readonly string[]>;
	readonly projectState: (projectId: string) => Awaitable<FramescaperNativeImageSequenceProjectState | null>;
	readonly projectContainsImageSequence: (value: Readonly<{
		projectId: string;
		sourceId: string;
		inventoryStorageKey: string;
		sourcePackStorageKey: string;
	}>) => Awaitable<boolean>;
	readonly assetReferenced: (storageKey: string) => Awaitable<boolean>;
	readonly mediaRuntime: Pick<FramescaperNativeMediaRuntime, 'available' | 'runJob'>;
}

interface AssetState {
	readonly kind: AssetKind;
	readonly temporaryPath: string;
	handle: FileHandle | null;
	digest: Hash;
	length: number;
	reference: Reference | null;
}

interface Transaction {
	readonly id: string;
	readonly owner: object;
	readonly generation: CandidateGeneration;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly directory: string;
	readonly pack: AssetState;
	readonly inventory: AssetState;
	sourceId: string | null;
}

interface PendingTransfer {
	readonly owner: object;
	readonly transaction: Transaction;
	readonly asset: AssetKind;
	readonly offset: number;
	readonly binding: HelperDataPlaneBinding;
	readonly completion: Promise<unknown>;
	resolve(value: unknown): void;
	reject(error: unknown): void;
}

export type FramescaperNativeImageSequenceImportRequest =
	| Readonly<{ operation: 'begin'; candidateGeneration: CandidateGeneration; projectId: string; projectRevision: number }>
	| Readonly<{ operation: 'write'; transactionId: string; asset: AssetKind; offset: number; bytes: Uint8Array }>
	| Readonly<{ operation: 'prepare-write'; transactionId: string; asset: AssetKind; offset: number; binding: HelperDataPlaneBinding }>
	| Readonly<{ operation: 'await-write'; transactionId: string; asset: AssetKind; offset: number; streamId: string }>
	| Readonly<{ operation: 'commit'; transactionId: string; asset: AssetKind; reference: Reference }>
	| Readonly<{ operation: 'admit'; transactionId: string; admission: FramescaperImageSequenceNativeAdmissionRequestV25 }>
	| Readonly<{ operation: 'complete'; transactionId: string; sourceId: string; inventorySha256: string; sourcePackSha256: string }>
	| Readonly<{ operation: 'discard'; transactionId: string }>;

export class FramescaperNativeImageSequenceImportAuthority {
	readonly #options: FramescaperNativeImageSequenceImportAuthorityOptions;
	readonly #transactions = new Map<string, Transaction>();
	readonly #pendingTransfers = new Map<string, PendingTransfer>();
	constructor(options: FramescaperNativeImageSequenceImportAuthorityOptions) {
		if (!options.root || !isAbsolute(options.root)) {
			throw new TypeError('The image-sequence authority requires an absolute main-owned root.');
		}
		this.#options = options;
	}
	async request(owner: object, value: FramescaperNativeImageSequenceImportRequest): Promise<unknown> {
		if (!owner || typeof owner !== 'object') throw new TypeError('An image-sequence request requires an owner.');
		assertFramescaperNativeImageSequenceImportRequest(value, { allowDirectWrite: true });
		switch (value.operation) {
			case 'begin': return this.#begin(owner, value);
			case 'write': return this.#write(owner, value);
			case 'prepare-write': return this.#prepareWrite(owner, value);
			case 'await-write': return this.#awaitWrite(owner, value);
			case 'commit': return this.#commit(owner, value);
			case 'admit': return this.#admit(owner, value);
			case 'complete': return this.#complete(owner, value);
			case 'discard': return this.#discard(owner, value.transactionId);
			default: throw new TypeError('The image-sequence authority operation is unsupported.');
		}
	}

	/** Receive only a previously negotiated renderer-to-main byte stream. */
	async receiveChunk(owner: object, value: Readonly<{
		transactionId: string; asset: AssetKind; offset: number; binding: HelperDataPlaneBinding;
	}>, port: HelperDataPlaneIoPort): Promise<void> {
		assertFramescaperNativeImageSequenceImportPortRequest(value);
		const binding = validateHelperDataPlaneBinding(value.binding);
		const key = transferKey(value.transactionId, value.asset, value.offset, binding.streamId);
		const pending = this.#pendingTransfers.get(key);
		if (!pending || pending.owner !== owner || JSON.stringify(pending.binding) !== JSON.stringify(binding)) {
			port.close();
			throw new Error('The image-sequence data-plane stream was not negotiated by this owner.');
		}
		const ingress = join(pending.transaction.directory, `${binding.streamId}.ingress`);
		try {
			await receiveHelperDataPlaneFile({ binding, port, path: ingress, localCancelReason: 'host-abort' });
			const bytes = new Uint8Array(await readFile(ingress));
			const result = await this.#write(owner, {
				operation: 'write', transactionId: pending.transaction.id,
				asset: pending.asset, offset: pending.offset, bytes,
			});
			pending.resolve(result);
		} catch (error) {
			pending.reject(error);
			throw error;
		} finally { await rm(ingress, { force: true }); }
	}

	async recover(): Promise<Readonly<{ transactionsRemoved: number; assetsRemoved: number; assetsRetained: number }>> {
		let entries;
		try { entries = await readdir(this.#transactionRoot(), { withFileTypes: true }); }
		catch (error) {
			if (imageSequenceFsErrorHasCode(error, 'ENOENT')) return Object.freeze({ transactionsRemoved: 0, assetsRemoved: 0, assetsRetained: 0 });
			throw error;
		}
		let transactionsRemoved = 0;
		let assetsRemoved = 0;
		let assetsRetained = 0;
		for (const entry of entries) {
			if (!entry.isDirectory() || !TRANSACTION_ID.test(entry.name)) continue;
			const directory = join(this.#transactionRoot(), entry.name);
			let manifest: Manifest | null = null;
			try {
				manifest = parseFramescaperNativeImageSequenceManifest(
					await readFile(join(directory, 'manifest.json')), entry.name,
				);
			}
			catch { /* An unauthenticated transaction can own no trusted final object. */ }
			for (const reference of manifest ? [manifest.pack, manifest.inventory] : []) {
				if (!reference) continue;
				if (await this.#options.assetReferenced(reference.storageKey)) assetsRetained += 1;
				else if (await this.#removeAsset(reference)) assetsRemoved += 1;
			}
			await rm(directory, { recursive: true, force: true });
			transactionsRemoved += 1;
		}
		return Object.freeze({ transactionsRemoved, assetsRemoved, assetsRetained });
	}

	async readProjectBody(input: Readonly<{ storageKey: string; offset: number; length: number }>): Promise<Uint8Array> {
		const reference = referenceFromImageSequenceStorageKey(input.storageKey);
		const path = this.#assetPath(reference);
		await assertImageSequenceRegularFile(path);
		const actual = await digestImageSequencePath(path);
		if (actual.digest !== reference.sha256) throw new Error('The project body changed after publication.');
		if (!Number.isSafeInteger(input.offset) || !Number.isSafeInteger(input.length)
			|| input.offset < 0 || input.length < 1
			|| input.length > NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_MAXIMUM_CHUNK_BYTES
			|| input.offset + input.length > actual.length) {
			throw new RangeError('The project-body read is outside its bounded published asset.');
		}
		const handle = await open(path, 'r');
		try {
			const bytes = new Uint8Array(input.length);
			const result = await handle.read(bytes, 0, bytes.byteLength, input.offset);
			if (result.bytesRead !== bytes.byteLength) throw new Error('The project-body read was short.');
			return bytes;
		} finally { await handle.close(); }
	}

	async revokeOwner(owner: object): Promise<void> {
		for (const [key, pending] of this.#pendingTransfers) {
			if (pending.owner !== owner) continue;
			pending.reject(new Error('The image-sequence transfer owner was revoked.'));
			this.#pendingTransfers.delete(key);
		}
		for (const transaction of [...this.#transactions.values()]) {
			if (transaction.owner === owner) await this.#discard(owner, transaction.id);
		}
	}

	async #prepareWrite(owner: object, request: Extract<FramescaperNativeImageSequenceImportRequest, { operation: 'prepare-write' }>): Promise<unknown> {
		const transaction = this.#owned(owner, request.transactionId);
		const asset = assetFor(transaction, request.asset);
		const binding = validateHelperDataPlaneBinding(request.binding);
		if (binding.direction !== 'host-to-helper' || request.offset !== asset.length
			|| binding.byteLength < 1 || binding.byteLength > NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_MAXIMUM_CHUNK_BYTES) {
			throw new Error('The image-sequence data-plane binding is outside its sequential bound.');
		}
		const limit = asset.kind === 'pack'
			? NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_PACK_BYTES
			: NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_INVENTORY_BYTES;
		if (asset.length + binding.byteLength > limit || asset.reference) {
			throw new Error('The image-sequence data-plane binding exceeds its durable asset.');
		}
		const key = transferKey(transaction.id, asset.kind, request.offset, binding.streamId);
		if (this.#pendingTransfers.has(key)) throw new Error('The image-sequence data-plane binding was replayed.');
		if ([...this.#pendingTransfers.values()].some((pending) => (
			pending.transaction === transaction && pending.asset === asset.kind
		))) throw new Error('The image-sequence asset already has a pending data-plane transfer.');
		let resolve!: (value: unknown) => void;
		let reject!: (error: unknown) => void;
		const completion = new Promise<unknown>((resolveValue, rejectValue) => {
			resolve = resolveValue; reject = rejectValue;
		});
		this.#pendingTransfers.set(key, {
			owner, transaction, asset: asset.kind, offset: request.offset,
			binding, completion, resolve, reject,
		});
		return Object.freeze({ operation: 'write-prepared', transactionId: transaction.id, asset: asset.kind, offset: request.offset, binding });
	}

	async #awaitWrite(owner: object, request: Extract<FramescaperNativeImageSequenceImportRequest, { operation: 'await-write' }>): Promise<unknown> {
		const transaction = this.#owned(owner, request.transactionId);
		const key = transferKey(transaction.id, request.asset, request.offset, request.streamId);
		const pending = this.#pendingTransfers.get(key);
		if (!pending || pending.owner !== owner) throw new Error('The image-sequence data-plane transfer is not pending.');
		try { return await pending.completion; }
		finally { this.#pendingTransfers.delete(key); }
	}

	async #begin(owner: object, request: Extract<FramescaperNativeImageSequenceImportRequest, { operation: 'begin' }>): Promise<unknown> {
		await this.#assertEnabled();
		if (this.#transactions.size >= MAXIMUM_ACTIVE_TRANSACTIONS) {
			throw new Error('The image-sequence transaction capacity is exhausted.');
		}
		const generation = request.candidateGeneration;
		if (generation !== 25 && generation !== 26) throw new TypeError('The candidate generation is unsupported.');
		const projectId = framescaperNativeImageSequenceId(request.projectId, 'project ID');
		const projectRevision = framescaperNativeImageSequenceInteger(request.projectRevision, 'project revision');
		await this.#assertProject(projectId, generation, projectRevision);
		const id = this.#options.mintOpaqueId();
		if (!TRANSACTION_ID.test(id) || this.#transactions.has(id)) {
			throw new Error('The image-sequence transaction identity is invalid or repeated.');
		}
		await this.#prepareRoots();
		const directory = join(this.#transactionRoot(), id);
		await mkdir(directory, { mode: 0o700 });
		const transaction: Transaction = {
			id, owner, generation, projectId, projectRevision, directory, sourceId: null,
			pack: assetState('pack', directory), inventory: assetState('inventory', directory),
		};
		this.#transactions.set(id, transaction);
		await this.#persist(transaction);
		return Object.freeze({ operation: 'begun', transactionId: id });
	}

	async #write(owner: object, request: Extract<FramescaperNativeImageSequenceImportRequest, { operation: 'write' }>): Promise<unknown> {
		const transaction = this.#owned(owner, request.transactionId);
		const asset = assetFor(transaction, request.asset);
		if (asset.reference) throw new Error('A committed image-sequence asset cannot be written.');
		if (!(request.bytes instanceof Uint8Array) || request.bytes.byteLength < 1
			|| request.bytes.byteLength > NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_MAXIMUM_CHUNK_BYTES
			|| request.offset !== asset.length) {
			throw new TypeError('Image-sequence writes require bounded sequential bytes.');
		}
		const limit = asset.kind === 'pack'
			? NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_PACK_BYTES
			: NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_INVENTORY_BYTES;
		if (asset.length + request.bytes.byteLength > limit) throw new RangeError('The image-sequence asset exceeds its byte ceiling.');
		asset.handle ??= await open(asset.temporaryPath, 'wx', 0o600);
		const result = await asset.handle.write(request.bytes, 0, request.bytes.byteLength, asset.length);
		if (result.bytesWritten !== request.bytes.byteLength) throw new Error('The durable image-sequence write was short.');
		asset.digest.update(request.bytes);
		asset.length += request.bytes.byteLength;
		return Object.freeze({ operation: 'written', transactionId: transaction.id, asset: asset.kind, offset: asset.length });
	}

	async #commit(owner: object, request: Extract<FramescaperNativeImageSequenceImportRequest, { operation: 'commit' }>): Promise<unknown> {
		const transaction = this.#owned(owner, request.transactionId);
		const asset = assetFor(transaction, request.asset);
		if (asset.reference) throw new Error('The image-sequence asset is already committed.');
		const reference = normalizeFramescaperNativeImageSequenceReference(request.reference, asset.kind);
		await asset.handle?.sync();
		await asset.handle?.close();
		asset.handle = null;
		if (asset.length !== reference.byteLength || asset.digest.digest('hex') !== reference.sha256) {
			throw new Error('The image-sequence asset fails exact digest/length authentication.');
		}
		const destination = this.#assetPath(reference);
		await mkdir(join(this.#options.root, 'objects'), { recursive: true, mode: 0o700 });
		try { await link(asset.temporaryPath, destination); }
		catch (error) {
			if (!imageSequenceFsErrorHasCode(error, 'EEXIST')) throw error;
			await assertImageSequenceReferenceFile(destination, reference);
		}
		await unlink(asset.temporaryPath);
		asset.reference = reference;
		await this.#persist(transaction);
		return Object.freeze({ operation: 'committed', transactionId: transaction.id, asset: asset.kind, reference });
	}

	async #admit(owner: object, request: Extract<FramescaperNativeImageSequenceImportRequest, { operation: 'admit' }>): Promise<unknown> {
		const transaction = this.#owned(owner, request.transactionId);
		await this.#assertEnabled();
		const admission = normalizeFramescaperNativeImageSequenceAdmission(request.admission);
		if (admission.candidateGeneration !== transaction.generation
			|| admission.projectId !== transaction.projectId
			|| admission.projectRevision !== transaction.projectRevision) {
			throw new Error('Image-sequence admission has the wrong candidate project identity.');
		}
		await this.#assertProject(transaction.projectId, transaction.generation, transaction.projectRevision);
		const inventoryReference = committedInventory(transaction);
		const packReference = committedPack(transaction);
		if (!sameReference(admission.inventory, inventoryReference)
			|| !sameReference(admission.sourcePack, packReference)) {
			throw new Error('Image-sequence admission does not authenticate the committed assets.');
		}
		const inventoryBytes = new Uint8Array(await readFile(this.#assetPath(inventoryReference)));
		const entries = validateNativeMediaImageSequenceInventoryBytesV25(inventoryReference, inventoryBytes);
		if (entries.length !== admission.frameCount) throw new Error('Image-sequence admission has the wrong frame count.');
		const packPath = this.#assetPath(packReference);
		const packHandle = await open(packPath, 'r');
		try {
			const reader = await validateNativeMediaImageSequenceSourcePackV25({
				reference: packReference, inventory: inventoryReference, entries,
				frameRate: admission.frameRate,
				read: async (offset, length) => readImageSequenceRange(packHandle, offset, length),
				assertCurrent: async () => assertImageSequenceReferenceHandle(packHandle, packReference),
			});
			let characteristics: VideoSourceCharacteristicsV25 | null = null;
			for (let index = 0; index < entries.length; index += 1) {
				const probePath = join(transaction.directory, `probe-${String(index)}.frame`);
				const probe = await open(probePath, 'wx', 0o600);
				try {
					await reader.readFrame(index, async (chunk) => { await probe.write(chunk); });
					await probe.sync();
					const probeStat = await probe.stat();
					const value = validateHelperProbeResult(await this.#options.mediaRuntime.runJob({
						kind: 'probe-video-source',
						grant: { mediaPath: probePath, mediaBytes: probeStat.size, identity: { dev: probeStat.dev, ino: probeStat.ino } },
						resourcePolicy: { maximumInputBytes: probeStat.size },
						validateResult: validateHelperProbeResult,
					}));
					const current = normalizeVideoSourceCharacteristicsV25(value.characteristics, { rate: admission.frameRate });
					const verdict = evaluateNativeMediaProfileAdmission({
						profileId: admission.profileId, source: current,
						clearedPolicyRowIds: await this.#options.clearedPolicyRowIds(),
					});
					if (!verdict.admitted) throw new Error(`Native image-sequence admission is blocked: ${verdict.refusals.join(', ')}.`);
					if (characteristics && JSON.stringify(characteristics) !== JSON.stringify(current)) {
						throw new Error('Native image-sequence frames do not share exact professional characteristics.');
					}
					characteristics = current;
				} finally {
					await probe.close();
					await rm(probePath, { force: true });
				}
			}
			if (!characteristics) throw new Error('Native image-sequence admission requires at least one frame.');
			transaction.sourceId = admission.sourceId;
			await this.#persist(transaction);
			const result = Object.freeze({
				kind: admission.kind, admitted: true,
				projectId: admission.projectId, projectRevision: admission.projectRevision,
				sourceId: admission.sourceId,
				inventorySha256: inventoryReference.sha256,
				sourcePackSha256: packReference.sha256,
				characteristics,
			});
			return Object.freeze({ operation: 'admitted', transactionId: transaction.id, result });
		} finally { await packHandle.close(); }
	}

	async #complete(owner: object, request: Extract<FramescaperNativeImageSequenceImportRequest, { operation: 'complete' }>): Promise<unknown> {
		const transaction = this.#owned(owner, request.transactionId);
		const inventory = committedInventory(transaction);
		const pack = committedPack(transaction);
		if (request.sourceId !== transaction.sourceId || request.inventorySha256 !== inventory.sha256
			|| request.sourcePackSha256 !== pack.sha256) {
			throw new Error('Image-sequence completion does not match the admitted identity.');
		}
		if (!await this.#options.projectContainsImageSequence({
			projectId: transaction.projectId, sourceId: request.sourceId,
			inventoryStorageKey: inventory.storageKey, sourcePackStorageKey: pack.storageKey,
		})) throw new Error('The candidate project does not yet contain the admitted image sequence.');
		await rm(transaction.directory, { recursive: true, force: true });
		this.#transactions.delete(transaction.id);
		return Object.freeze({ operation: 'completed', transactionId: transaction.id });
	}

	async #discard(owner: object, id: string): Promise<unknown> {
		const transaction = this.#owned(owner, id);
		for (const [key, pending] of this.#pendingTransfers) {
			if (pending.transaction !== transaction) continue;
			pending.reject(new Error('The image-sequence transaction was discarded.'));
			this.#pendingTransfers.delete(key);
		}
		for (const asset of [transaction.pack, transaction.inventory]) {
			await asset.handle?.close().catch(() => undefined);
			asset.handle = null;
			if (asset.reference && !await this.#options.assetReferenced(asset.reference.storageKey)) {
				await this.#removeAsset(asset.reference);
			}
		}
		await rm(transaction.directory, { recursive: true, force: true });
		this.#transactions.delete(transaction.id);
		return Object.freeze({ operation: 'discarded', transactionId: transaction.id, discarded: true });
	}

	#owned(owner: object, id: string): Transaction {
		const transaction = this.#transactions.get(id);
		if (!transaction || transaction.owner !== owner) throw new Error('The image-sequence transaction has the wrong owner.');
		return transaction;
	}

	async #assertEnabled(): Promise<void> {
		const snapshot = await this.#options.capabilities();
		assertNativeMediaCapabilitySnapshotV1(snapshot);
		const ref = NATIVE_MEDIA_CAPABILITY_IDS.imageSequenceImport;
		if (!this.#options.runtimeAvailable() || !this.#options.mediaRuntime.available()
			|| !isNativeMediaCapabilityUsable(nativeMediaCapabilityEntry(snapshot, ref.domain, ref.id))) {
			throw new Error('Native image-sequence import is disabled or unavailable.');
		}
		const rows = await this.#options.clearedPolicyRowIds();
		if (!Array.isArray(rows) || !rows.includes(POLICY_ROW)) {
			throw new Error('Native image-sequence import is blocked by its fail-closed policy row.');
		}
	}

	async #assertProject(id: string, generation: CandidateGeneration, revision: number): Promise<void> {
		const project = await this.#options.projectState(id);
		if (!project?.open || !project.writable || project.schemaVersion !== generation
			|| project.revision !== revision) {
			throw new Error('Native image-sequence import requires the exact writable candidate project revision.');
		}
	}

	async #prepareRoots(): Promise<void> {
		await mkdir(this.#transactionRoot(), { recursive: true, mode: 0o700 });
		await mkdir(join(this.#options.root, 'objects'), { recursive: true, mode: 0o700 });
	}

	#transactionRoot(): string { return join(this.#options.root, 'transactions'); }

	#assetPath(reference: Pick<Reference, 'kind' | 'sha256'>): string {
		return framescaperNativeImageSequenceAssetPath(this.#options.root, reference);
	}

	async #removeAsset(reference: Reference): Promise<boolean> {
		try { await unlink(this.#assetPath(reference)); return true; }
		catch (error) { if (imageSequenceFsErrorHasCode(error, 'ENOENT')) return false; throw error; }
	}

	async #persist(transaction: Transaction): Promise<void> {
		const body = {
			version: MANIFEST_VERSION, transactionId: transaction.id,
			generation: transaction.generation, projectId: transaction.projectId,
			projectRevision: transaction.projectRevision, sourceId: transaction.sourceId,
			pack: transaction.pack.reference, inventory: transaction.inventory.reference,
		};
		const manifest = { ...body, authenticator: imageSequenceStorageSha256(JSON.stringify(body)) };
		const partial = join(transaction.directory, 'manifest.partial');
		await writeFile(partial, JSON.stringify(manifest), { encoding: 'utf8', mode: 0o600 });
		await rename(partial, join(transaction.directory, 'manifest.json'));
	}
}

function assetState(kind: AssetKind, directory: string): AssetState {
	return { kind, temporaryPath: join(directory, `${kind}.partial`), handle: null, digest: createHash('sha256'), length: 0, reference: null };
}

function assetFor(transaction: Transaction, kind: unknown): AssetState {
	if (kind === 'pack') return transaction.pack;
	if (kind === 'inventory') return transaction.inventory;
	throw new TypeError('The image-sequence asset kind is unsupported.');
}

function committedPack(transaction: Transaction): NativeMediaImageSequenceSourcePackReferenceV25 {
	if (transaction.pack.reference?.kind !== 'image-sequence-source-pack') throw new Error('The source pack is not committed.');
	return transaction.pack.reference;
}

function committedInventory(transaction: Transaction): NativeMediaImageSequenceInventoryReferenceV25 {
	if (transaction.inventory.reference?.kind !== 'image-sequence-inventory') throw new Error('The inventory is not committed.');
	return transaction.inventory.reference;
}

function sameReference(left: Reference, right: Reference): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function transferKey(transactionId: string, asset: AssetKind, offset: number, streamId: string): string { return `${transactionId}:${asset}:${String(offset)}:${streamId}`; }
