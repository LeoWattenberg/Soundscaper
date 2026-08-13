/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperDesktopProjectLibraryV10Handshake } from './project-library-v10-contract.ts';
import type {
	FramescaperDesktopProjectLibraryV10CatalogSnapshot,
	FramescaperDesktopProjectLibraryV10DeleteResult,
} from './project-library-v10-lifecycle-contract.ts';
import type {
	FramescaperDesktopProjectLibraryV10LifecycleHost,
} from './project-library-v10-lifecycle-host.ts';
import type { FramescaperDesktopProjectLibraryV10PublicationHost } from './project-library-v10-publication-host.ts';
import type { FramescaperDesktopProjectLibraryV10Lease } from './project-library-v10-persistence-codecs.ts';
import {
	validateFramescaperDesktopProjectLibraryV10PublicationAdmission,
	validateFramescaperDesktopProjectLibraryV10PublicationBeginRequest,
	validateFramescaperDesktopProjectLibraryV10PublicationChunkAcknowledgement,
	validateFramescaperDesktopProjectLibraryV10PublicationChunkRequest,
	validateFramescaperDesktopProjectLibraryV10PublicationCompletionRequest,
	validateFramescaperDesktopProjectLibraryV10PublicationResult,
	type FramescaperDesktopProjectLibraryV10PublicationAdmission,
	type FramescaperDesktopProjectLibraryV10PublicationChunkAcknowledgement,
} from './project-library-v10-publication-transport.ts';
import {
	MAXIMUM_FRAMESCAPER_V10_TRANSFER_CHUNK_BYTES,
	validateFramescaperDesktopProjectLibraryV10BodyReadRequest,
	type FramescaperDesktopProjectLibraryV10TransferBundle,
} from './project-library-v10-transfer-contract.ts';
import {
	type FramescaperDesktopProjectLibraryV10TransferService,
	type FramescaperDesktopProjectLibraryV10TransferSession,
} from './project-library-v10-transfer-service.ts';

const MAXIMUM_ACTIVE_SESSIONS = 16;

export interface FramescaperDesktopProjectLibraryV10MainSession {
	listProjects(): Promise<Readonly<FramescaperDesktopProjectLibraryV10CatalogSnapshot>>;
	readProjectBundle(projectId: string): Promise<Readonly<FramescaperDesktopProjectLibraryV10TransferBundle> | null>;
	readBodyChunk(value: unknown): Promise<Uint8Array>;
	beginPublication(value: unknown): Promise<Readonly<FramescaperDesktopProjectLibraryV10PublicationAdmission>>;
	writePublicationChunk(
		value: unknown,
	): Promise<Readonly<FramescaperDesktopProjectLibraryV10PublicationChunkAcknowledgement>>;
	finishPublication(value: unknown): Promise<Readonly<FramescaperDesktopProjectLibraryV10TransferBundle>>;
	abortPublication(value: unknown): Promise<boolean>;
	deleteProject(value: unknown): Promise<Readonly<FramescaperDesktopProjectLibraryV10DeleteResult>>;
	duplicateProject(value: unknown): Promise<Readonly<FramescaperDesktopProjectLibraryV10TransferBundle>>;
	close(): Promise<void>;
}

/** Main-owned session authority. Renderer data can never provide its lease or owner. */
export class FramescaperDesktopProjectLibraryV10MainSessionService {
	readonly localHandshake: Readonly<FramescaperDesktopProjectLibraryV10Handshake>;
	readonly #host: FramescaperDesktopProjectLibraryV10PublicationHost;
	readonly #lifecycle: FramescaperDesktopProjectLibraryV10LifecycleHost;
	#lease: FramescaperDesktopProjectLibraryV10Lease;
	readonly #transfer: FramescaperDesktopProjectLibraryV10TransferService;
	readonly #sessions = new Set<MainSession>();
	#active: PublicationUpload | null = null;
	#lifecycleActive = false;
	#closed = false;
	#fenced: unknown = null;

	constructor(
		host: FramescaperDesktopProjectLibraryV10PublicationHost,
		lifecycle: FramescaperDesktopProjectLibraryV10LifecycleHost,
		lease: FramescaperDesktopProjectLibraryV10Lease,
		transfer: FramescaperDesktopProjectLibraryV10TransferService,
	) {
		this.#host = host;
		this.#lifecycle = lifecycle;
		this.#lease = lease;
		this.#transfer = transfer;
		this.localHandshake = transfer.localHandshake;
		Object.freeze(this);
	}

	updateLease(lease: FramescaperDesktopProjectLibraryV10Lease): void {
		this.#lease = lease;
	}

	get activeSessions(): number {
		return this.#sessions.size;
	}

	get activePublication(): boolean {
		return this.#active !== null;
	}

	openSession(value: unknown): FramescaperDesktopProjectLibraryV10MainSession {
		const transfer = this.#transfer.openSession(value);
		this.#assertAccepting();
		if (this.#sessions.size >= MAXIMUM_ACTIVE_SESSIONS) {
			throw new RangeError('Framescaper V10 main session capacity is exhausted');
		}
		const session = new MainSession(this, transfer);
		this.#sessions.add(session);
		return Object.freeze(session) as FramescaperDesktopProjectLibraryV10MainSession;
	}

	async close(reason: unknown = new Error('Framescaper V10 main service is closed')): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		await Promise.all([...this.#sessions].map((session) => session.closeFromService(reason)));
	}

	async fence(reason: unknown): Promise<void> {
		if (this.#fenced !== null) return;
		this.#fenced = reason;
		await Promise.all([...this.#sessions].map((session) => session.closeFromService(reason)));
	}

	async begin(session: MainSession, value: unknown) {
		this.#assertSession(session);
		const request = validateFramescaperDesktopProjectLibraryV10PublicationBeginRequest(value);
		if (this.#active || this.#lifecycleActive) {
			throw new RangeError('Framescaper V10 publication capacity is exhausted');
		}
		const upload = new PublicationUpload(
			request.publicationId,
			session,
			this.#host,
			this.#lease,
			request,
		);
		this.#active = upload;
		try {
			await upload.start();
			return validateFramescaperDesktopProjectLibraryV10PublicationAdmission({
				publicationId: upload.id,
				maximumChunkBytes: MAXIMUM_FRAMESCAPER_V10_TRANSFER_CHUNK_BYTES,
				bodyCount: request.bodies.length,
			}, request.bodies.length);
		} catch (error) {
			try { await upload.abort(error); }
			finally { if (this.#active === upload) this.#active = null; }
			throw error;
		}
	}

	async write(session: MainSession, value: unknown) {
		this.#assertSession(session);
		const request = validateFramescaperDesktopProjectLibraryV10PublicationChunkRequest(value);
		const upload = this.#ownedUpload(session, request.publicationId);
		const result = await upload.write(request.bodyIndex, request.offset, request.bytes);
		return validateFramescaperDesktopProjectLibraryV10PublicationChunkAcknowledgement(result, request);
	}

	async finish(session: MainSession, value: unknown) {
		this.#assertSession(session);
		const request = validateFramescaperDesktopProjectLibraryV10PublicationCompletionRequest(value);
		const upload = this.#ownedUpload(session, request.publicationId);
		if (!upload.readyToFinish) return upload.finish();
		try { return await upload.finish(); }
		finally { if (this.#active === upload) this.#active = null; }
	}

	async abort(session: MainSession, value: unknown): Promise<boolean> {
		this.#assertSession(session);
		const request = validateFramescaperDesktopProjectLibraryV10PublicationCompletionRequest(value);
		const upload = this.#active;
		if (!upload || upload.id !== request.publicationId || !upload.belongsTo(session)) return false;
		try {
			await upload.abort(new Error('Framescaper V10 renderer publication was aborted'));
			return true;
		} finally {
			if (this.#active === upload) this.#active = null;
		}
	}

	list(session: MainSession) {
		this.#assertSession(session);
		return Promise.resolve(this.#lifecycle.listProjects());
	}

	delete(session: MainSession, value: unknown) {
		this.#assertSession(session);
		this.#admitLifecycle();
		return Promise.resolve().then(() => this.#lifecycle.deleteProject(value)).finally(() => {
			this.#lifecycleActive = false;
		});
	}

	duplicate(session: MainSession, value: unknown, signal: AbortSignal) {
		this.#assertSession(session);
		this.#admitLifecycle();
		return this.#lifecycle.duplicateProject(value, signal).finally(() => {
			this.#lifecycleActive = false;
		});
	}

	async detach(session: MainSession, reason: unknown): Promise<void> {
		this.#sessions.delete(session);
		const upload = this.#active;
		if (!upload || !upload.belongsTo(session)) return;
		try { await upload.abort(reason); }
		finally { if (this.#active === upload) this.#active = null; }
	}

	#ownedUpload(session: MainSession, publicationId: string): PublicationUpload {
		const upload = this.#active;
		if (!upload || upload.id !== publicationId || !upload.belongsTo(session)) {
			throw new Error('Framescaper V10 publication does not belong to this main session');
		}
		return upload;
	}

	#admitLifecycle(): void {
		if (this.#active || this.#lifecycleActive) {
			throw new RangeError('Framescaper V10 publication capacity is exhausted');
		}
		this.#lifecycleActive = true;
	}

	#assertSession(session: MainSession): void {
		this.#assertAccepting();
		if (!this.#sessions.has(session)) throw new Error('Framescaper V10 main session is closed');
	}

	#assertAccepting(): void {
		if (this.#closed) throw new Error('Framescaper V10 main service is closed');
		if (this.#fenced !== null) {
			throw new Error('Framescaper V10 main service lost its writer fence', { cause: this.#fenced });
		}
	}
}

class MainSession implements FramescaperDesktopProjectLibraryV10MainSession {
	readonly #controller = new AbortController();
	readonly #operations = new Set<Promise<unknown>>();
	readonly #service: FramescaperDesktopProjectLibraryV10MainSessionService;
	readonly #transfer: FramescaperDesktopProjectLibraryV10TransferSession;
	#closePromise: Promise<void> | null = null;
	#closed = false;

	constructor(
		service: FramescaperDesktopProjectLibraryV10MainSessionService,
		transfer: FramescaperDesktopProjectLibraryV10TransferSession,
	) {
		this.#service = service;
		this.#transfer = transfer;
	}

	readProjectBundle(projectId: string) {
		return this.#admit(() => this.#transfer.readProjectBundle(projectId, this.#controller.signal));
	}

	listProjects() {
		return this.#admit(() => this.#service.list(this));
	}

	readBodyChunk(value: unknown): Promise<Uint8Array> {
		return this.#admit(() => {
			const request = validateFramescaperDesktopProjectLibraryV10BodyReadRequest(value);
			return this.#transfer.readBodyChunk({ ...request, signal: this.#controller.signal });
		});
	}

	beginPublication(value: unknown) {
		return this.#admit(() => this.#service.begin(this, value));
	}

	writePublicationChunk(value: unknown) {
		return this.#admit(() => this.#service.write(this, value));
	}

	finishPublication(value: unknown) {
		return this.#admit(() => this.#service.finish(this, value));
	}

	abortPublication(value: unknown) {
		return this.#admit(() => this.#service.abort(this, value));
	}

	deleteProject(value: unknown) {
		return this.#admit(() => this.#service.delete(this, value));
	}

	duplicateProject(value: unknown) {
		return this.#admit(() => this.#service.duplicate(this, value, this.#controller.signal));
	}

	close(): Promise<void> {
		return this.closeFromService(new Error('Framescaper V10 main session is closed'));
	}

	closeFromService(reason: unknown): Promise<void> {
		if (this.#closePromise) return this.#closePromise;
		this.#closed = true;
		this.#controller.abort(reason);
		this.#closePromise = (async () => {
			await this.#service.detach(this, reason);
			await Promise.allSettled([...this.#operations]);
		})();
		return this.#closePromise;
	}

	#admit<Result>(operation: () => Promise<Result>): Promise<Result> {
		if (this.#closed) return Promise.reject(new Error('Framescaper V10 main session is closed'));
		let admitted: Promise<Result>;
		try { admitted = operation(); }
		catch (error) { return Promise.reject(error); }
		this.#operations.add(admitted);
		void admitted.then(
			() => { this.#operations.delete(admitted); },
			() => { this.#operations.delete(admitted); },
		);
		return admitted;
	}
}

class PublicationUpload {
	readonly #controller = new AbortController();
	readonly id: string;
	readonly #host: FramescaperDesktopProjectLibraryV10PublicationHost;
	readonly #lease: FramescaperDesktopProjectLibraryV10Lease;
	readonly #owner: MainSession;
	readonly #projectId: string;
	readonly #request: ReturnType<typeof validateFramescaperDesktopProjectLibraryV10PublicationBeginRequest>;
	readonly #streams: PublicationByteStream[];
	#bodyIndex = 0;
	#offset = 0;
	#result: Promise<Readonly<FramescaperDesktopProjectLibraryV10TransferBundle>> | null = null;

	constructor(
		id: string,
		owner: MainSession,
		host: FramescaperDesktopProjectLibraryV10PublicationHost,
		lease: FramescaperDesktopProjectLibraryV10Lease,
		request: ReturnType<typeof validateFramescaperDesktopProjectLibraryV10PublicationBeginRequest>,
	) {
		this.id = id;
		this.#owner = owner;
		this.#host = host;
		this.#lease = lease;
		this.#request = request;
		this.#projectId = String((request.project as { readonly id: unknown }).id);
		this.#streams = request.bodies.map(() => new PublicationByteStream());
	}

	belongsTo(session: MainSession): boolean {
		return this.#owner === session;
	}

	get readyToFinish(): boolean {
		return this.#bodyIndex === this.#request.bodies.length && this.#offset === 0;
	}

	async start(): Promise<void> {
		this.#result = this.#host.publish({
			lease: this.#lease,
			expectedMetadataRevision: this.#request.expectedMetadataRevision,
			expectedProject: this.#request.expectedProject,
			project: this.#request.project,
			bodies: this.#request.bodies.map((descriptor, index) => ({
				descriptor,
				chunks: this.#streams[index]!,
			})),
		}, this.#controller.signal);
		void this.#result.catch((error: unknown) => {
			for (const stream of this.#streams) stream.fail(error);
		});
		const first = this.#streams[0];
		if (!first) { await this.#result; return; }
		await Promise.race([
			first.waitUntilRead(),
			this.#result.then(() => undefined),
		]);
	}

	async write(bodyIndex: number, offset: number, bytes: Uint8Array) {
		const descriptor = this.#request.bodies[this.#bodyIndex];
		if (!descriptor || bodyIndex !== this.#bodyIndex || offset !== this.#offset) {
			throw new Error('Framescaper V10 publication chunks must be sequential by body and offset');
		}
		if (bytes.byteLength > descriptor.byteLength - this.#offset) {
			throw new RangeError('Framescaper V10 publication chunk exceeds its declared body');
		}
		await this.#streams[this.#bodyIndex]!.offer(bytes);
		this.#offset += bytes.byteLength;
		const complete = this.#offset === descriptor.byteLength;
		const nextOffset = this.#offset;
		if (complete) {
			this.#streams[this.#bodyIndex]!.complete();
			this.#bodyIndex += 1;
			this.#offset = 0;
		}
		return Object.freeze({ bodyIndex, nextOffset, complete });
	}

	async finish() {
		if (!this.readyToFinish) {
			throw new Error('Framescaper V10 publication bodies are incomplete');
		}
		if (!this.#result) throw new Error('Framescaper V10 publication did not start');
		return validateFramescaperDesktopProjectLibraryV10PublicationResult(
			await this.#result,
			this.#projectId,
		);
	}

	async abort(reason: unknown): Promise<void> {
		this.#controller.abort(reason);
		for (const stream of this.#streams) stream.fail(reason);
		await this.#result?.catch(() => undefined);
	}
}

class PublicationByteStream implements AsyncIterable<Uint8Array>, AsyncIterator<Uint8Array> {
	readonly #ready = deferred<void>();
	#complete = false;
	#failure: unknown = null;
	#pending: { bytes: Uint8Array; consumed: ReturnType<typeof deferred<void>> } | null = null;
	#waiting: ReturnType<typeof deferred<void>> | null = null;
	#read = false;

	[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
		return this;
	}

	waitUntilRead(): Promise<void> {
		return this.#ready.promise;
	}

	async next(): Promise<IteratorResult<Uint8Array>> {
		if (!this.#read) { this.#read = true; this.#ready.resolve(); }
		while (!this.#pending) {
			if (this.#failure !== null) throw this.#failure;
			if (this.#complete) return { done: true, value: undefined };
			this.#waiting = deferred<void>();
			await this.#waiting.promise;
			this.#waiting = null;
		}
		const pending = this.#pending;
		this.#pending = null;
		pending.consumed.resolve();
		return { done: false, value: pending.bytes };
	}

	offer(bytes: Uint8Array): Promise<void> {
		if (this.#failure !== null) return Promise.reject(this.#failure);
		if (this.#complete) return Promise.reject(new Error('Framescaper V10 publication body is complete'));
		if (this.#pending) return Promise.reject(new Error('Framescaper V10 publication stream capacity is exhausted'));
		const consumed = deferred<void>();
		this.#pending = { bytes: Uint8Array.from(bytes), consumed };
		this.#wake();
		return consumed.promise;
	}

	complete(): void {
		this.#complete = true;
		this.#wake();
	}

	fail(reason: unknown): void {
		if (this.#failure !== null || this.#complete) return;
		this.#failure = reason;
		this.#pending?.consumed.reject(reason);
		this.#pending = null;
		this.#wake();
	}

	#wake(): void {
		this.#waiting?.resolve();
	}
}

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}
