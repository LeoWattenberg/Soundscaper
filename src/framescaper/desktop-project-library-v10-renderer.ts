/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeArchiveEntry } from '../common/editor/scape-archive-envelope.ts';
import { throwIfScapeAborted } from '../common/editor/scape-abort.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { serializeScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import { cloneFramescaperProjectV18, type FramescaperProjectV18 } from './editor-project-v18.ts';
import {
	FRAMESCAPER_DESKTOP_V10_MAXIMUM_CHUNK_BYTES,
	framescaperDesktopV10BodiesForProject,
	resolveFramescaperDesktopV10RendererBridge,
	snapshotFramescaperDesktopV10Project,
	validateFramescaperDesktopV10Abort,
	validateFramescaperDesktopV10Acknowledgement,
	validateFramescaperDesktopV10Admission,
	validateFramescaperDesktopV10BodyChunk,
	validateFramescaperDesktopV10Bundle,
	validateFramescaperDesktopV10ProjectId,
	validateFramescaperDesktopV10RendererHandshake,
	type FramescaperDesktopV10Body,
	type FramescaperDesktopV10BundleSnapshot,
	type FramescaperDesktopV10RendererBridge,
} from './desktop-project-library-v10-renderer-contract.ts';
import {
	FramescaperScapeArchiveV18,
	type FramescaperScapeArchiveBodyStoreV18,
} from './scape-project-preservation-v18.ts';

export interface FramescaperDesktopProjectLibraryV10RendererComposition {
	readonly store: FramescaperDesktopProjectLibraryV10ShadowStore;
	readonly archive: FramescaperScapeArchiveV18;
}

export interface FramescaperDesktopProjectLibraryV10ShadowStore extends FramescaperScapeArchiveBodyStoreV18 {
	loadProject(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown;
}

export interface FramescaperDesktopProjectLibraryV10ExpectedProject {
	readonly projectRevision: number;
	readonly projectSha256: string;
}

export interface FramescaperDesktopProjectLibraryV10Publication {
	readonly expectedMetadataRevision: number;
	readonly expectedProject: Readonly<FramescaperDesktopProjectLibraryV10ExpectedProject> | null;
	readonly project: unknown;
	readonly signal?: AbortSignal;
}

export interface FramescaperDesktopProjectLibraryV10Renderer {
	readProject(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<FramescaperProjectV18 | null>;
	publishProject(request: FramescaperDesktopProjectLibraryV10Publication): Promise<FramescaperProjectV18>;
}

export class FramescaperDesktopProjectLibraryV10CommittedError extends Error {
	readonly committed = true;

	constructor(cause: unknown) {
		super('The Framescaper desktop V10 publication committed, but renderer shadow reconciliation failed.', { cause });
		this.name = 'FramescaperDesktopProjectLibraryV10CommittedError';
	}
}

const COMPOSITION_FIELDS = ['store', 'archive'] as const;
const PUBLICATION_REQUIRED_FIELDS = ['expectedMetadataRevision', 'expectedProject', 'project'] as const;
const PUBLICATION_OPTIONAL_FIELDS = ['signal'] as const;
const EXPECTED_FIELDS = ['projectRevision', 'projectSha256'] as const;
const SIGNAL_FIELDS = ['signal'] as const;
const DIGEST = /^[a-f0-9]{64}$/u;

/** Connect the packaged V10 bridge only to one already-authenticated V18 shadow/archive pair. */
export async function connectFramescaperDesktopProjectLibraryV10Renderer(
	profileValue: EditorProjectRuntimeProfile | unknown,
	compositionValue: FramescaperDesktopProjectLibraryV10RendererComposition | unknown,
): Promise<FramescaperDesktopProjectLibraryV10Renderer | null> {
	assertFramescaperProjectV18Profile(profileValue);
	const profile = profileValue;
	const composition = allowedRecord(
		compositionValue, COMPOSITION_FIELDS, [], 'Framescaper desktop V10 renderer composition',
	);
	const store = composition.store as FramescaperDesktopProjectLibraryV10ShadowStore;
	const archive = composition.archive;
	if (!(archive instanceof FramescaperScapeArchiveV18)) {
		throw new TypeError('The exact Framescaper V18 archive is required for desktop reconciliation.');
	}
	archive.assertComposition(profile, store);
	if (typeof store.loadProject !== 'function') {
		throw new TypeError('The exact Framescaper V18 shadow project store is required.');
	}
	const bridge = resolveFramescaperDesktopV10RendererBridge();
	if (!bridge) return null;
	const handshake = await bridge.connect();
	const databaseName = ownData(store, 'databaseName', 'Framescaper V18 shadow store');
	if (typeof databaseName !== 'string') throw new TypeError('The exact V18 shadow database identity is required.');
	validateFramescaperDesktopV10RendererHandshake(handshake, databaseName);
	if (bridge.handshakeState() !== 'admitted') {
		throw new TypeError('The Framescaper desktop V10 bridge did not retain its admitted handshake.');
	}
	return Object.freeze(new Renderer(profile, store, archive, bridge));
}

class Renderer implements FramescaperDesktopProjectLibraryV10Renderer {
	readonly #profile: EditorProjectRuntimeProfile;
	readonly #store: FramescaperDesktopProjectLibraryV10ShadowStore;
	readonly #archive: FramescaperScapeArchiveV18;
	readonly #bridge: FramescaperDesktopV10RendererBridge;
	#tail: Promise<void> = Promise.resolve();

	constructor(
		profile: EditorProjectRuntimeProfile,
		store: FramescaperDesktopProjectLibraryV10ShadowStore,
		archive: FramescaperScapeArchiveV18,
		bridge: FramescaperDesktopV10RendererBridge,
	) {
		this.#profile = profile;
		this.#store = store;
		this.#archive = archive;
		this.#bridge = bridge;
	}

	readProject(projectIdValue: string, optionsValue: Readonly<{ signal?: AbortSignal }> = {}) {
		const projectId = validateFramescaperDesktopV10ProjectId(projectIdValue);
		const signal = signalOptions(optionsValue);
		return this.#exclusive(async () => {
			throwIfScapeAborted(signal);
			const raw = await this.#bridge.readProjectBundle(projectId);
			throwIfScapeAborted(signal);
			if (raw === null) return null;
			const snapshot = validateFramescaperDesktopV10Bundle(this.#profile, raw, projectId);
			return this.#reconcile(snapshot, signal);
		});
	}

	publishProject(requestValue: FramescaperDesktopProjectLibraryV10Publication) {
		const request = publicationRequest(this.#profile, requestValue);
		return this.#exclusive(() => this.#publish(request));
	}

	async #publish(request: NormalizedPublication): Promise<FramescaperProjectV18> {
		throwIfScapeAborted(request.signal);
		const projectId = validateFramescaperDesktopV10ProjectId(String(request.project.id));
		const currentValue = await this.#store.loadProject(
			projectId,
			request.signal ? { signal: request.signal } : {},
		);
		const current = currentValue === null || currentValue === undefined
			? null
			: cloneFramescaperProjectV18(this.#profile, currentValue);
		assertLocalCas(this.#profile, current, request);
		throwIfScapeAborted(request.signal);
		const exported = await this.#archive.exportProject(
			request.project,
			request.signal ? { signal: request.signal } : {},
		);
		const planned = framescaperDesktopV10BodiesForProject(request.project, request.documentSha256);
		if (exported.formatVersion !== (planned.assets.length === 0 ? 1 : 2)
			|| JSON.stringify(exported.assets.map(({ descriptor }) => descriptor)) !== JSON.stringify(planned.assets)) {
			throw new Error('The V18 shadow export changed its exact proxy/timing publication plan.');
		}
		let publicationId: string | null = null;
		let committed = false;
		try {
			const admission = validateFramescaperDesktopV10Admission(await this.#bridge.beginPublication({
				expectedMetadataRevision: request.expectedMetadataRevision,
				expectedProject: request.expectedProject,
				project: request.project,
				bodies: planned.bodies,
			}), planned.bodies.length);
			publicationId = admission.publicationId;
			for (const [bodyIndex, asset] of exported.assets.entries()) {
				await this.#uploadBody(publicationId, bodyIndex, planned.bodies[bodyIndex]!, asset.body, request.signal);
			}
			throwIfScapeAborted(request.signal);
			const raw = await this.#bridge.finishPublication({ publicationId });
			committed = true;
			const result = validateFramescaperDesktopV10Bundle(this.#profile, raw, projectId);
			assertPublicationResult(request, result);
			return await this.#reconcile(result, request.signal);
		} catch (error) {
			if (committed) throw new FramescaperDesktopProjectLibraryV10CommittedError(error);
			if (publicationId === null) throw error;
			try {
				validateFramescaperDesktopV10Abort(await this.#bridge.abortPublication({ publicationId }));
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					'Framescaper desktop V10 publication and abort both failed.',
					{ cause: error },
				);
			}
			throw error;
		}
	}

	async #uploadBody(
		publicationId: string,
		bodyIndex: number,
		descriptor: Readonly<FramescaperDesktopV10Body>,
		body: Blob,
		signal?: AbortSignal,
	): Promise<void> {
		if (!(body instanceof Blob) || body.size !== descriptor.byteLength) {
			throw new Error('The V18 shadow body changed before desktop upload.');
		}
		for (let offset = 0; offset < body.size; offset += FRAMESCAPER_DESKTOP_V10_MAXIMUM_CHUNK_BYTES) {
			throwIfScapeAborted(signal);
			const nextOffset = Math.min(body.size, offset + FRAMESCAPER_DESKTOP_V10_MAXIMUM_CHUNK_BYTES);
			const bytes = new Uint8Array(await body.slice(offset, nextOffset).arrayBuffer());
			throwIfScapeAborted(signal);
			const acknowledgement = await this.#bridge.writePublicationChunk({
				publicationId, bodyIndex, offset, bytes,
			});
			validateFramescaperDesktopV10Acknowledgement(
				acknowledgement, bodyIndex, nextOffset, nextOffset === body.size,
			);
		}
	}

	async #reconcile(
		snapshot: Readonly<FramescaperDesktopV10BundleSnapshot>,
		signal?: AbortSignal,
	): Promise<FramescaperProjectV18> {
		throwIfScapeAborted(signal);
		const currentValue = await this.#store.loadProject(
			snapshot.bundle.project.projectId,
			signal ? { signal } : {},
		);
		const current = currentValue === null || currentValue === undefined
			? null
			: cloneFramescaperProjectV18(this.#profile, currentValue);
		if (current && sameProject(current, snapshot.project)) {
			await this.#archive.exportProject(snapshot.project, signal ? { signal } : {});
			return cloneFramescaperProjectV18(this.#profile, snapshot.project);
		}
		const publication = shadowPublication(current, snapshot.project);
		const result = await this.#archive.importProject({
			manifest: manifest(snapshot),
			project: snapshot.project,
			decision: 'continue',
			entries: snapshotEntries(snapshot, this.#bridge, signal),
			operationId: operationId(),
			publication,
			...(signal ? { signal } : {}),
		});
		if (result.status !== 'published') {
			throw new Error('The V18 renderer shadow changed before desktop reconciliation.');
		}
		return cloneFramescaperProjectV18(this.#profile, result.project);
	}

	#exclusive<Result>(operation: () => Promise<Result>): Promise<Result> {
		const admitted = this.#tail.then(operation, operation);
		this.#tail = admitted.then(() => undefined, () => undefined);
		return admitted;
	}
}

interface NormalizedPublication {
	readonly expectedMetadataRevision: number;
	readonly expectedProject: Readonly<FramescaperDesktopProjectLibraryV10ExpectedProject> | null;
	readonly project: FramescaperProjectV18;
	readonly document: string;
	readonly documentSha256: string;
	readonly signal?: AbortSignal;
}

function publicationRequest(profile: EditorProjectRuntimeProfile, value: unknown): NormalizedPublication {
	const raw = allowedRecord(
		value, PUBLICATION_REQUIRED_FIELDS, PUBLICATION_OPTIONAL_FIELDS, 'Framescaper desktop V10 publication',
	);
	const snapshot = snapshotFramescaperDesktopV10Project(profile, raw.project);
	const signal = raw.signal === undefined ? undefined : abortSignal(raw.signal);
	return Object.freeze({
		expectedMetadataRevision: nonNegative(raw.expectedMetadataRevision, 'metadata revision'),
		expectedProject: expectedProject(raw.expectedProject),
		project: snapshot.project,
		document: snapshot.document,
		documentSha256: snapshot.sha256,
		...(signal ? { signal } : {}),
	});
}

function expectedProject(value: unknown): Readonly<FramescaperDesktopProjectLibraryV10ExpectedProject> | null {
	if (value === null) return null;
	const raw = allowedRecord(value, EXPECTED_FIELDS, [], 'Framescaper desktop V10 expected project');
	if (typeof raw.projectSha256 !== 'string' || !DIGEST.test(raw.projectSha256)) {
		throw new TypeError('The expected desktop project digest is invalid.');
	}
	return Object.freeze({
		projectRevision: nonNegative(raw.projectRevision, 'project revision'),
		projectSha256: raw.projectSha256,
	});
}

function assertLocalCas(
	profile: EditorProjectRuntimeProfile,
	current: FramescaperProjectV18 | null,
	request: NormalizedPublication,
): void {
	if (request.expectedProject === null) {
		if (current !== null || Number(request.project.revision) !== 0) {
			throw new Error('Desktop create requires an absent V18 shadow and fresh revision zero.');
		}
		return;
	}
	if (!current || String(current.id) !== String(request.project.id)) {
		throw new Error('Desktop publication requires its exact reconciled V18 shadow base.');
	}
	const snapshot = snapshotFramescaperDesktopV10Project(profile, current);
	if (Number(current.revision) !== request.expectedProject.projectRevision
		|| snapshot.sha256 !== request.expectedProject.projectSha256
		|| Number(request.project.revision) !== Number(current.revision) + 1) {
		throw new Error('The V18 shadow failed the desktop publication compare-and-swap.');
	}
}

function assertPublicationResult(
	request: NormalizedPublication,
	result: Readonly<FramescaperDesktopV10BundleSnapshot>,
): void {
	if (result.bundle.metadataRevision !== request.expectedMetadataRevision + 1
		|| result.bundle.document !== request.document
		|| result.bundle.project.sha256 !== request.documentSha256) {
		throw new Error('The committed desktop V10 publication changed its requested project.');
	}
}

function shadowPublication(current: FramescaperProjectV18 | null, project: FramescaperProjectV18) {
	if (current === null) return Object.freeze({ mode: 'create' as const });
	const revision = Number(current.revision);
	if (String(current.id) !== String(project.id) || !Number.isSafeInteger(revision)
		|| revision === Number.MAX_SAFE_INTEGER || Number(project.revision) !== revision + 1) {
		throw new Error('Desktop reconciliation requires the exact next V18 shadow revision.');
	}
	return Object.freeze({ mode: 'compare-and-swap' as const, expected: current, project });
}

function manifest(snapshot: Readonly<FramescaperDesktopV10BundleSnapshot>): Readonly<Record<string, unknown>> {
	return Object.freeze({
		format: 'scape-project',
		formatVersion: snapshot.assets.length === 0 ? 1 : 2,
		project: Object.freeze({
			entry: 'project.json', mimeType: 'application/json', schemaVersion: 18,
			size: snapshot.bundle.project.byteLength, sha256: snapshot.bundle.project.sha256,
		}),
		assets: snapshot.assets,
	});
}

function snapshotEntries(
	snapshot: Readonly<FramescaperDesktopV10BundleSnapshot>,
	bridge: FramescaperDesktopV10RendererBridge,
	signal?: AbortSignal,
): readonly ScapeArchiveEntry[] {
	return Object.freeze(snapshot.assets.map((asset, index) => {
		const body = snapshot.bundle.bodies[index]!;
		if (asset.sourceId !== body.storageKey || asset.size !== body.byteLength || asset.sha256 !== body.sha256) {
			throw new Error('The desktop V10 body no longer matches its V18 archive descriptor.');
		}
		return Object.freeze({
			filename: asset.entry,
			directory: false,
			encrypted: false,
			compressionMethod: 0,
			compressedSize: body.byteLength,
			uncompressedSize: body.byteLength,
			getData: (writable: WritableStream<Uint8Array>, options?: Readonly<{ signal?: AbortSignal }>) => (
				transferBody(snapshot, body, bridge, writable, options?.signal ?? signal)
			),
		});
	}));
}

async function transferBody(
	snapshot: Readonly<FramescaperDesktopV10BundleSnapshot>,
	body: Readonly<FramescaperDesktopV10Body>,
	bridge: FramescaperDesktopV10RendererBridge,
	writable: WritableStream<Uint8Array>,
	signal?: AbortSignal,
): Promise<void> {
	const writer = writable.getWriter();
	try {
		for (let offset = 0; offset < body.byteLength; offset += FRAMESCAPER_DESKTOP_V10_MAXIMUM_CHUNK_BYTES) {
			throwIfScapeAborted(signal);
			const length = Math.min(FRAMESCAPER_DESKTOP_V10_MAXIMUM_CHUNK_BYTES, body.byteLength - offset);
			const bytes = validateFramescaperDesktopV10BodyChunk(await bridge.readBodyChunk({
				projectId: snapshot.bundle.project.projectId,
				metadataRevision: snapshot.bundle.metadataRevision,
				projectRevision: snapshot.bundle.project.projectRevision,
				projectSha256: snapshot.bundle.project.sha256,
				body,
				offset,
				length,
			}), length);
			throwIfScapeAborted(signal);
			await writer.write(bytes);
		}
		await writer.close();
	} catch (error) {
		try { await writer.abort(error); } catch { /* the primary transfer error owns the refusal */ }
		throw error;
	} finally {
		writer.releaseLock();
	}
}

function operationId(): string {
	if (typeof globalThis.crypto?.randomUUID !== 'function') {
		throw new Error('A cryptographic renderer operation identity is required for V18 reconciliation.');
	}
	return `desktop-v10:${globalThis.crypto.randomUUID()}`;
}

function sameProject(left: FramescaperProjectV18, right: FramescaperProjectV18): boolean {
	return serializeScapeProjectDocument(left) === serializeScapeProjectDocument(right);
}

function signalOptions(value: unknown): AbortSignal | undefined {
	const raw = allowedRecord(value, [], SIGNAL_FIELDS, 'Framescaper desktop V10 read options');
	return raw.signal === undefined ? undefined : abortSignal(raw.signal);
}

function abortSignal(value: unknown): AbortSignal {
	if (!(value instanceof AbortSignal)) throw new TypeError('A Framescaper desktop V10 AbortSignal is required.');
	return value;
}

function allowedRecord<const Required extends string, const Optional extends string>(
	value: unknown,
	required: readonly Required[],
	optional: readonly Optional[],
	name: string,
): Record<Required | Optional, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const allowed = new Set<string>([...required, ...optional]);
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))) throw new TypeError(`${name} has unsupported fields.`);
	const result = Object.create(null) as Record<Required | Optional, unknown>;
	for (const field of required) result[field] = ownData(value, field, name);
	for (const field of optional) if (Object.hasOwn(value, field)) result[field] = ownData(value, field, name);
	return result;
}

function ownData(value: object, field: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${field} must be an own data property.`);
	}
	return descriptor.value;
}

function nonNegative(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`The desktop ${name} is invalid.`);
	return Number(value);
}
