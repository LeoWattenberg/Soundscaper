/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Content-addressed storage for optional local assistance models.
 *
 * Models live in a user-settable directory on the real filesystem as plain,
 * individually deletable files: `blobs/sha256-<hex>` holds each artifact
 * exactly once, and `manifests/<modelId>.json` names the artifacts a model
 * needs. Blobs are shared, so removing a model reclaims only the blobs no
 * remaining manifest references.
 *
 * The store never downloads. It publishes bytes that already exist on disk
 * and verifies their digest before doing so, which keeps the network stage
 * separable and keeps a corrupt artifact from ever being named by a manifest.
 */

import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	rename,
	rm,
	stat,
} from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

export const LOCAL_MODEL_MANIFEST_SCHEMA_VERSION = 1;

/** A single model may not exceed this many artifacts or bytes. */
export const MAX_LOCAL_MODEL_ARTIFACTS = 64;
export const MAX_LOCAL_MODEL_ARTIFACT_BYTES = 8 * 1024 ** 3;
export const MAX_LOCAL_MODEL_MANIFEST_BYTES = 256 * 1024;

const MODEL_ID_PATTERN = /^[a-z\d][a-z\d.-]{0,62}[a-z\d]$/u;
const ARTIFACT_NAME_PATTERN = /^[A-Za-z\d](?:[A-Za-z\d._-]{0,158}[A-Za-z\d])?$/u;
const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const BLOB_NAME_PATTERN = /^sha256-([a-f\d]{64})$/u;

const MANIFESTS_DIRECTORY = 'manifests';
const BLOBS_DIRECTORY = 'blobs';
const STAGING_DIRECTORY = 'staging';

export interface LocalModelArtifact {
	readonly fileName: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface LocalModelInstallation {
	readonly modelId: string;
	readonly version: string;
	readonly artifacts: readonly LocalModelArtifact[];
}

export interface InstalledLocalModel extends LocalModelInstallation {
	readonly totalBytes: number;
}

export interface LocalModelStoreOptions {
	readonly randomBytes?: (size: number) => Uint8Array;
}

function errorCode(error: unknown): string | undefined {
	return typeof error === 'object' && error !== null && 'code' in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

function assertModelId(value: unknown): string {
	if (typeof value !== 'string' || !MODEL_ID_PATTERN.test(value)) {
		throw new TypeError('A local model id must be lowercase, dot or dash separated.');
	}
	return value;
}

function assertVersion(value: unknown): string {
	if (typeof value !== 'string' || value.trim() === '' || value.length > 64) {
		throw new TypeError('A local model version must be a short non-empty string.');
	}
	return value;
}

function assertDigest(value: unknown): string {
	if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
		throw new TypeError('A local model artifact digest must be a lowercase SHA-256 hex string.');
	}
	return value;
}

/** The content-addressed file name a digest resolves to. */
export function localModelBlobName(sha256: string): string {
	return `sha256-${assertDigest(sha256)}`;
}

/** The product-owned default directory name inside userData. */
export const DEFAULT_LOCAL_MODEL_DIRECTORY_NAME = 'models';

/**
 * The models directory in effect: the user's chosen absolute path when they
 * set one, and a product-owned default under userData otherwise. Keeping the
 * default derived rather than persisted means an unset setting follows the
 * product's own data directory instead of pinning a stale path.
 */
export function resolveLocalModelRoot(options: {
	readonly userDataPath: string;
	readonly settingsDirectory?: string | null;
}): string {
	const { userDataPath, settingsDirectory = null } = options;
	if (typeof userDataPath !== 'string' || !isAbsolute(userDataPath)) {
		throw new TypeError('The user data path must be absolute.');
	}
	if (settingsDirectory === null || settingsDirectory === undefined) {
		return resolve(join(userDataPath, DEFAULT_LOCAL_MODEL_DIRECTORY_NAME));
	}
	if (typeof settingsDirectory !== 'string' || !isAbsolute(settingsDirectory)) {
		throw new TypeError('A chosen models directory must be an absolute path.');
	}
	return resolve(settingsDirectory);
}

function normalizeArtifact(value: unknown): LocalModelArtifact {
	if (typeof value !== 'object' || value === null) {
		throw new TypeError('A local model artifact must be an object.');
	}
	const candidate = value as Partial<LocalModelArtifact>;
	if (typeof candidate.fileName !== 'string' || !ARTIFACT_NAME_PATTERN.test(candidate.fileName)) {
		throw new TypeError('A local model artifact needs a plain relative file name.');
	}
	if (!Number.isSafeInteger(candidate.byteLength)
		|| (candidate.byteLength as number) <= 0
		|| (candidate.byteLength as number) > MAX_LOCAL_MODEL_ARTIFACT_BYTES) {
		throw new RangeError('A local model artifact byte length is out of range.');
	}
	return Object.freeze({
		fileName: candidate.fileName,
		byteLength: candidate.byteLength as number,
		sha256: assertDigest(candidate.sha256),
	});
}

function normalizeInstallation(value: unknown): InstalledLocalModel {
	if (typeof value !== 'object' || value === null) {
		throw new TypeError('A local model manifest must be an object.');
	}
	const candidate = value as Partial<LocalModelInstallation> & { schemaVersion?: unknown };
	if (candidate.schemaVersion !== LOCAL_MODEL_MANIFEST_SCHEMA_VERSION) {
		throw new Error('The local model manifest schema version is unsupported.');
	}
	const artifacts = candidate.artifacts;
	if (!Array.isArray(artifacts) || artifacts.length === 0
		|| artifacts.length > MAX_LOCAL_MODEL_ARTIFACTS) {
		throw new RangeError('A local model manifest needs between one and 64 artifacts.');
	}
	const normalized = artifacts.map(normalizeArtifact);
	const names = new Set(normalized.map(({ fileName }) => fileName));
	if (names.size !== normalized.length) {
		throw new Error('A local model manifest repeats an artifact file name.');
	}
	return Object.freeze({
		modelId: assertModelId(candidate.modelId),
		version: assertVersion(candidate.version),
		artifacts: Object.freeze(normalized),
		totalBytes: normalized.reduce((total, artifact) => total + artifact.byteLength, 0),
	});
}

async function syncDirectory(path: string): Promise<void> {
	let handle = null;
	try {
		handle = await open(path, 'r');
		await handle.sync();
	} catch (error) {
		if (errorCode(error) !== 'EISDIR' && errorCode(error) !== 'EPERM') throw error;
	} finally {
		await handle?.close().catch(() => undefined);
	}
}

async function digestOf(path: string): Promise<string> {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk as Uint8Array);
	return hash.digest('hex');
}

/**
 * A models directory on the real filesystem. Every path it touches is derived
 * from a validated id or digest, so a manifest can never name a location
 * outside the store.
 */
export class FileLocalModelStore {
	readonly #root: string;
	readonly #randomBytes: (size: number) => Uint8Array;

	constructor(rootPath: string, options: LocalModelStoreOptions = {}) {
		if (typeof rootPath !== 'string' || !isAbsolute(rootPath)) {
			throw new TypeError('The local model store root must be an absolute path.');
		}
		this.#root = resolve(rootPath);
		this.#randomBytes = options.randomBytes ?? nodeRandomBytes;
	}

	get rootPath(): string {
		return this.#root;
	}

	blobPath(sha256: string): string {
		return join(this.#root, BLOBS_DIRECTORY, localModelBlobName(sha256));
	}

	manifestPath(modelId: string): string {
		return join(this.#root, MANIFESTS_DIRECTORY, `${assertModelId(modelId)}.json`);
	}

	/** Creates the directory skeleton with owner-only permissions. */
	async initialize(): Promise<void> {
		for (const directory of [MANIFESTS_DIRECTORY, BLOBS_DIRECTORY, STAGING_DIRECTORY]) {
			await mkdir(join(this.#root, directory), { recursive: true, mode: 0o700 });
		}
	}

	/**
	 * The deterministic partial-download path for an artifact. It is derived
	 * from the digest so an interrupted download resumes into the same file
	 * instead of restarting or accumulating orphans.
	 */
	async partialPath(sha256: string): Promise<string> {
		await mkdir(join(this.#root, STAGING_DIRECTORY), { recursive: true, mode: 0o700 });
		return join(this.#root, STAGING_DIRECTORY, `${localModelBlobName(sha256)}.part`);
	}

	/** An absolute path a downloader may write to before publishing it. */
	async stagingPath(): Promise<string> {
		await mkdir(join(this.#root, STAGING_DIRECTORY), { recursive: true, mode: 0o700 });
		const token = this.#randomBytes(16);
		if (!(token instanceof Uint8Array) || token.byteLength !== 16) {
			throw new Error('Secure local model staging token generation failed.');
		}
		return join(this.#root, STAGING_DIRECTORY, `${Buffer.from(token).toString('hex')}.part`);
	}

	/**
	 * Verifies a staged file against its expected digest and length, then moves
	 * it into the blob store. A mismatch removes the staged file and throws;
	 * it never publishes and never repairs.
	 */
	async publishBlob(stagedPath: string, artifact: LocalModelArtifact): Promise<string> {
		const expected = normalizeArtifact(artifact);
		const metadata = await lstat(stagedPath);
		if (!metadata.isFile() || metadata.isSymbolicLink()) {
			await rm(stagedPath, { force: true }).catch(() => undefined);
			throw new Error('A staged local model artifact must be a regular non-symbolic file.');
		}
		if (metadata.size !== expected.byteLength) {
			await rm(stagedPath, { force: true }).catch(() => undefined);
			throw new RangeError('A staged local model artifact does not match its recorded byte length.');
		}
		const observed = await digestOf(stagedPath);
		if (observed !== expected.sha256) {
			await rm(stagedPath, { force: true }).catch(() => undefined);
			throw new Error('A staged local model artifact does not match its recorded digest.');
		}
		const target = this.blobPath(expected.sha256);
		await mkdir(join(this.#root, BLOBS_DIRECTORY), { recursive: true, mode: 0o700 });
		await rename(stagedPath, target);
		await syncDirectory(join(this.#root, BLOBS_DIRECTORY));
		return target;
	}

	async hasBlob(sha256: string): Promise<boolean> {
		try {
			const metadata = await lstat(this.blobPath(sha256));
			return metadata.isFile() && !metadata.isSymbolicLink();
		} catch (error) {
			if (errorCode(error) === 'ENOENT') return false;
			throw error;
		}
	}

	/** Re-authenticates a published artifact before a runtime may execute it. */
	async verifyArtifact(artifact: LocalModelArtifact): Promise<boolean> {
		const expected = normalizeArtifact(artifact);
		try {
			const path = this.blobPath(expected.sha256);
			const metadata = await lstat(path);
			return metadata.isFile()
				&& !metadata.isSymbolicLink()
				&& metadata.size === expected.byteLength
				&& await digestOf(path) === expected.sha256;
		} catch (error) {
			if (errorCode(error) === 'ENOENT') return false;
			throw error;
		}
	}

	async #hasArtifact(artifact: LocalModelArtifact): Promise<boolean> {
		try {
			const metadata = await lstat(this.blobPath(artifact.sha256));
			return metadata.isFile()
				&& !metadata.isSymbolicLink()
				&& metadata.size === artifact.byteLength;
		} catch (error) {
			if (errorCode(error) === 'ENOENT') return false;
			throw error;
		}
	}

	/**
	 * Records an installation. Every artifact must already be published, so a
	 * manifest can never name bytes the store does not hold.
	 */
	async commitInstall(installation: LocalModelInstallation): Promise<InstalledLocalModel> {
		const normalized = normalizeInstallation({
			...installation,
			schemaVersion: LOCAL_MODEL_MANIFEST_SCHEMA_VERSION,
		});
		for (const artifact of normalized.artifacts) {
			if (!await this.#hasArtifact(artifact)) {
				throw new Error(`Local model ${normalized.modelId} is missing a published artifact.`);
			}
		}
		const document = {
			schemaVersion: LOCAL_MODEL_MANIFEST_SCHEMA_VERSION,
			modelId: normalized.modelId,
			version: normalized.version,
			artifacts: normalized.artifacts,
		};
		const bytes = Buffer.from(`${JSON.stringify(document)}\n`, 'utf8');
		if (bytes.byteLength > MAX_LOCAL_MODEL_MANIFEST_BYTES) {
			throw new RangeError('A local model manifest exceeds its byte limit.');
		}
		const parent = join(this.#root, MANIFESTS_DIRECTORY);
		await mkdir(parent, { recursive: true, mode: 0o700 });
		const target = this.manifestPath(normalized.modelId);
		const temporaryPath = `${target}.${Buffer.from(this.#randomBytes(16)).toString('hex')}.tmp`;
		let published = false;
		let handle = null;
		try {
			handle = await open(temporaryPath, 'wx', 0o600);
			await handle.writeFile(bytes);
			await handle.sync();
			await handle.close();
			handle = null;
			await rename(temporaryPath, target);
			published = true;
			await syncDirectory(parent);
		} finally {
			await handle?.close().catch(() => undefined);
			if (!published) await rm(temporaryPath, { force: true }).catch(() => undefined);
		}
		return normalized;
	}

	async readManifest(modelId: string): Promise<InstalledLocalModel | null> {
		let bytes;
		try {
			bytes = await readFile(this.manifestPath(modelId));
		} catch (error) {
			if (errorCode(error) === 'ENOENT') return null;
			throw error;
		}
		if (bytes.byteLength > MAX_LOCAL_MODEL_MANIFEST_BYTES) {
			throw new RangeError('A local model manifest exceeds its byte limit.');
		}
		return normalizeInstallation(JSON.parse(String(bytes)));
	}

	/**
	 * Every readable installation, sorted by id. A manifest the store cannot
	 * parse is skipped rather than thrown: the user may have deleted or edited
	 * files directly, and one damaged model must not hide the others.
	 */
	async listInstalled(): Promise<readonly InstalledLocalModel[]> {
		let entries: string[];
		try {
			entries = await readdir(join(this.#root, MANIFESTS_DIRECTORY));
		} catch (error) {
			if (errorCode(error) === 'ENOENT') return Object.freeze([]);
			throw error;
		}
		const installed: InstalledLocalModel[] = [];
		for (const entry of entries.sort()) {
			if (!entry.endsWith('.json')) continue;
			const modelId = entry.slice(0, -'.json'.length);
			if (!MODEL_ID_PATTERN.test(modelId)) continue;
			try {
				const manifest = await this.readManifest(modelId);
				if (!manifest || manifest.modelId !== modelId) continue;
				let complete = true;
				for (const artifact of manifest.artifacts) {
					if (!await this.#hasArtifact(artifact)) {
						complete = false;
						break;
					}
				}
				if (complete) installed.push(manifest);
			} catch {
				continue;
			}
		}
		return Object.freeze(installed);
	}

	/**
	 * Forgets a model and reclaims the blobs no remaining manifest references.
	 * Returns the reclaimed byte total so the caller can report it.
	 */
	async removeModel(modelId: string): Promise<number> {
		const target = this.manifestPath(modelId);
		await rm(target, { force: true });
		await syncDirectory(join(this.#root, MANIFESTS_DIRECTORY)).catch(() => undefined);
		return this.reclaimUnreferencedBlobs();
	}

	/** Deletes every blob no manifest references. Returns the bytes reclaimed. */
	async reclaimUnreferencedBlobs(): Promise<number> {
		const referenced = new Set<string>();
		for (const installation of await this.listInstalled()) {
			for (const artifact of installation.artifacts) referenced.add(artifact.sha256);
		}
		let entries: string[];
		try {
			entries = await readdir(join(this.#root, BLOBS_DIRECTORY));
		} catch (error) {
			if (errorCode(error) === 'ENOENT') return 0;
			throw error;
		}
		let reclaimed = 0;
		for (const entry of entries) {
			const match = BLOB_NAME_PATTERN.exec(entry);
			if (!match || referenced.has(match[1] as string)) continue;
			const path = join(this.#root, BLOBS_DIRECTORY, entry);
			try {
				const metadata = await stat(path);
				await rm(path, { force: true });
				reclaimed += metadata.size;
			} catch {
				continue;
			}
		}
		return reclaimed;
	}

	/** Total bytes held by published blobs, whether referenced or not. */
	async usedBytes(): Promise<number> {
		let entries: string[];
		try {
			entries = await readdir(join(this.#root, BLOBS_DIRECTORY));
		} catch (error) {
			if (errorCode(error) === 'ENOENT') return 0;
			throw error;
		}
		let total = 0;
		for (const entry of entries) {
			if (!BLOB_NAME_PATTERN.test(entry)) continue;
			try {
				total += (await stat(join(this.#root, BLOBS_DIRECTORY, entry))).size;
			} catch {
				continue;
			}
		}
		return total;
	}
}
