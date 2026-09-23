/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FreesoundPanelAuthState } from './FreesoundPanel.tsx';
import {
	isFreesoundAuthenticationError,
	type FreesoundApiClient,
} from './freesound-auth-upload-client.ts';
import {
	createFreesoundUploadQueue,
	type FreesoundClipUploadReference,
	type FreesoundPublishDraft,
	type FreesoundUploadQueue,
	type FreesoundUploadQueueRuntime,
	type FreesoundUploadQueueSnapshot,
} from './freesound-upload-queue.ts';

export interface FreesoundPanelSessionSnapshot {
	readonly auth: FreesoundPanelAuthState;
	readonly uploadQueue: FreesoundUploadQueueSnapshot;
	readonly uploadRevealRevision: number;
}

export interface FreesoundPanelSession {
	readonly getSnapshot: () => FreesoundPanelSessionSnapshot;
	readonly subscribe: (listener: () => void) => () => void;
	readonly initialize: () => Promise<void>;
	readonly connect: () => Promise<void>;
	readonly disconnect: () => Promise<void>;
	readonly expireAuthentication: (error?: unknown) => void;
	readonly enqueueFiles: (files: readonly File[]) => readonly string[];
	readonly enqueueClip: (reference: FreesoundClipUploadReference) => string;
	readonly revealUploads: () => void;
	readonly publish: (id: string, draft: FreesoundPublishDraft) => Promise<void>;
	readonly retry: (id: string) => void;
	readonly cancel: (id: string) => void;
	readonly remove: (id: string) => void;
}

export interface FreesoundPanelSessionRuntime extends Partial<Pick<
	FreesoundUploadQueueRuntime,
	'materializeClip' | 'prepareFile' | 'createId'
>> {
	readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
	readonly now?: () => number;
	readonly menuUploadRequestTimeoutMilliseconds?: number;
}

const controllerSessions = new WeakMap<object, FreesoundPanelSession>();
const pendingClipUploads = new WeakMap<object, Map<string, DeferredClipUpload>>();
const menuUploadRequestTimeouts = new WeakMap<FreesoundPanelSession, number>();
const MAXIMUM_DEFERRED_CLIP_UPLOADS = 100;
const DEFAULT_MENU_UPLOAD_REQUEST_TIMEOUT_MILLISECONDS = 15_000;

interface DeferredClipUpload {
	readonly reference: FreesoundClipUploadReference;
	readonly promise: Promise<void>;
	readonly resolve: () => void;
	readonly reject: (error: unknown) => void;
	bound: boolean;
	settled: boolean;
	timeout?: ReturnType<typeof setTimeout>;
	unsubscribe?: () => void;
}

/** Queue a menu-requested clip once this controller's Freesound account is connected. */
export function requestFreesoundClipUpload(
	owner: object,
	reference: FreesoundClipUploadReference,
): Promise<void> {
	if (!reference.projectId || !reference.clipId) {
		return Promise.reject(new TypeError('A valid project clip is required.'));
	}
	const session = controllerSessions.get(owner);
	const key = deferredClipUploadKey(reference);
	const pending = pendingClipUploads.get(owner) ?? new Map<string, DeferredClipUpload>();
	const duplicate = pending.get(key);
	if (duplicate) return duplicate.promise;
	if (pending.size >= MAXIMUM_DEFERRED_CLIP_UPLOADS) {
		return Promise.reject(new RangeError('The Freesound upload queue is full.'));
	}
	let resolveRequest!: () => void;
	let rejectRequest!: (error: unknown) => void;
	const promise = new Promise<void>((resolve, reject) => {
		resolveRequest = resolve;
		rejectRequest = reject;
	});
	const request: DeferredClipUpload = {
		reference: Object.freeze({ ...reference }), promise,
		resolve: resolveRequest, reject: rejectRequest,
		bound: false, settled: false,
	};
	pending.set(key, request);
	pendingClipUploads.set(owner, pending);
	request.timeout = setTimeout(
		() => settleDeferredClipUpload(owner, key, request,
			new Error('Open the Freesound panel and connect before uploading a clip.')),
		session ? menuUploadRequestTimeouts.get(session) : DEFAULT_MENU_UPLOAD_REQUEST_TIMEOUT_MILLISECONDS,
	);
	if (session) bindDeferredClipUpload(owner, session, key, request);
	return promise;
}

export function freesoundPanelSession(
	owner: object,
	client: FreesoundApiClient,
	runtime: FreesoundPanelSessionRuntime = {},
): FreesoundPanelSession {
	let session = controllerSessions.get(owner);
	if (!session) {
		session = createFreesoundPanelSession(client, runtime);
		controllerSessions.set(owner, session);
		menuUploadRequestTimeouts.set(session, menuUploadRequestTimeout(runtime));
		for (const [key, request] of pendingClipUploads.get(owner) ?? []) {
			bindDeferredClipUpload(owner, session, key, request);
		}
	}
	return session;
}

function bindDeferredClipUpload(
	owner: object,
	session: FreesoundPanelSession,
	key: string,
	request: DeferredClipUpload,
): void {
	if (request.bound || request.settled) return;
	request.bound = true;
	const advance = (): void => {
		if (request.settled) return;
		const status = session.getSnapshot().auth.status;
		if (status === 'loading' || status === 'connecting') return;
		if (status !== 'connected') {
			settleDeferredClipUpload(owner, key, request,
				new Error('Connect to Freesound before uploading a clip, then choose the command again.'));
			return;
		}
		request.unsubscribe?.();
		request.unsubscribe = undefined;
		try {
			session.enqueueClip(request.reference);
			session.revealUploads();
			settleDeferredClipUpload(owner, key, request);
		} catch (error) {
			settleDeferredClipUpload(owner, key, request, error);
		}
	};
	request.unsubscribe = session.subscribe(advance);
	advance();
}

function settleDeferredClipUpload(
	owner: object,
	key: string,
	request: DeferredClipUpload,
	error?: unknown,
): void {
	if (request.settled) return;
	request.settled = true;
	if (request.timeout) clearTimeout(request.timeout);
	request.unsubscribe?.();
	if (error === undefined) request.resolve();
	else request.reject(error);
	queueMicrotask(() => {
		const pending = pendingClipUploads.get(owner);
		if (pending?.get(key) !== request) return;
		pending.delete(key);
		if (!pending.size) pendingClipUploads.delete(owner);
	});
}

function deferredClipUploadKey(reference: FreesoundClipUploadReference): string {
	return `${reference.projectId}\u0000${reference.clipId}`;
}

function menuUploadRequestTimeout(runtime: FreesoundPanelSessionRuntime): number {
	const requested = runtime.menuUploadRequestTimeoutMilliseconds;
	return typeof requested === 'number' && Number.isFinite(requested) && requested > 0
		? requested
		: DEFAULT_MENU_UPLOAD_REQUEST_TIMEOUT_MILLISECONDS;
}

export function createFreesoundPanelSession(
	client: FreesoundApiClient,
	runtime: FreesoundPanelSessionRuntime = {},
): FreesoundPanelSession {
	const listeners = new Set<() => void>();
	let auth: FreesoundPanelAuthState = Object.freeze({ status: 'loading' });
	let uploadRevealRevision = 0;
	const queue = createFreesoundUploadQueue({
		upload: async (file, signal) => await authenticatedOperation(
			() => client.upload(file, signal),
		),
		describe: async (request, signal) => await authenticatedOperation(
			() => client.describe(request, signal),
		),
		...(runtime.materializeClip ? { materializeClip: runtime.materializeClip } : {}),
		...(runtime.prepareFile ? { prepareFile: runtime.prepareFile } : {}),
		...(runtime.createId ? { createId: runtime.createId } : {}),
	});
	const now = runtime.now ?? Date.now;
	const wait = runtime.wait ?? abortableWait;
	let snapshot = freezeSnapshot(auth, queue.getSnapshot(), uploadRevealRevision);
	let initialized: Promise<void> | null = null;
	let connecting: Promise<void> | null = null;
	let connectAbort: AbortController | null = null;

	queue.subscribe(publishSnapshot);

	const initialize = (): Promise<void> => {
		initialized ??= client.session().then(async (session) => {
			if (!session.connected) {
				setAuth({ status: 'disconnected' });
				return;
			}
			setAuth({ status: 'connected', user: session.user });
			await restorePending(() => authenticatedOperation(() => client.pending()), queue);
		}).catch((error: unknown) => {
			setAuth({ status: 'disconnected', errorMessage: errorMessage(error, 'Freesound sign-in is unavailable.') });
		});
		return initialized;
	};

	const connect = (): Promise<void> => {
		if (connecting) return connecting;
		connectAbort?.abort();
		const abort = new AbortController();
		connectAbort = abort;
		setAuth({ status: 'connecting' });
		let authorization: ReturnType<FreesoundApiClient['reserveAuthorization']>;
		try { authorization = client.reserveAuthorization(); }
		catch (error) {
			setAuth({ status: 'error', errorMessage: errorMessage(error, 'Freesound sign-in failed.') });
			return Promise.resolve();
		}
		let authorizationOpened = false;
		connecting = (async () => {
			try {
				const attempt = await client.startOAuth(client.platform, abort.signal);
				await authorization.open(attempt.authorizeUrl);
				authorizationOpened = true;
				const parsedExpiry = Date.parse(attempt.expiresAt);
				const expiresAt = Number.isFinite(parsedExpiry) ? parsedExpiry : now() + 10 * 60_000;
				while (now() < expiresAt) {
					abort.signal.throwIfAborted();
					const session = await client.pollOAuth(
						attempt.attemptId, attempt.handoffToken, abort.signal,
					);
					if (session?.connected) {
						setAuth({ status: 'connected', user: session.user });
						await restorePending(() => authenticatedOperation(() => client.pending()), queue);
						return;
					}
					await wait(1_000, abort.signal);
				}
				throw new Error('Freesound authorization expired.');
			} catch (error) {
				if (!authorizationOpened) authorization.close();
				if (!abort.signal.aborted) {
					setAuth({ status: 'error', errorMessage: errorMessage(error, 'Freesound sign-in failed.') });
				}
			} finally {
				if (connectAbort === abort) connectAbort = null;
				connecting = null;
			}
		})();
		return connecting;
	};

	function setAuth(value: FreesoundPanelAuthState): void {
		auth = Object.freeze(value);
		publishSnapshot();
	}

	async function authenticatedOperation<Value>(operation: () => Promise<Value>): Promise<Value> {
		try { return await operation(); }
		catch (error) {
			if (isFreesoundAuthenticationError(error)) expireAuthentication(error);
			throw error;
		}
	}

	function expireAuthentication(error?: unknown): void {
		connectAbort?.abort();
		setAuth({
			status: 'disconnected',
			errorMessage: errorMessage(error, 'Reconnect Freesound to continue.'),
		});
	}

	function publishSnapshot(): void {
		snapshot = freezeSnapshot(auth, queue.getSnapshot(), uploadRevealRevision);
		for (const listener of listeners) listener();
	}

	return Object.freeze({
		getSnapshot: () => snapshot,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		initialize,
		connect,
		expireAuthentication,
		disconnect: async () => {
			connectAbort?.abort();
			queue.clear();
			try {
				await client.disconnect();
				setAuth({ status: 'disconnected' });
			} catch (error) {
				setAuth({ status: 'error', errorMessage: errorMessage(error, 'Freesound sign-out failed.') });
			}
		},
		enqueueFiles: queue.enqueueFiles,
		enqueueClip: queue.enqueueClip,
		revealUploads: () => {
			uploadRevealRevision += 1;
			publishSnapshot();
		},
		publish: queue.publish,
		retry: queue.retry,
		cancel: queue.cancel,
		remove: queue.remove,
	});
}

async function restorePending(
	load: () => ReturnType<FreesoundApiClient['pending']>,
	queue: FreesoundUploadQueue,
): Promise<void> {
	try { queue.restorePending(await load()); }
	catch { /* Restoring remote status is best-effort and must not undo a valid sign-in. */ }
}

function freezeSnapshot(
	auth: FreesoundPanelAuthState,
	uploadQueue: FreesoundUploadQueueSnapshot,
	uploadRevealRevision: number,
): FreesoundPanelSessionSnapshot {
	return Object.freeze({ auth, uploadQueue, uploadRevealRevision });
}

function abortableWait(milliseconds: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(finish, milliseconds);
		signal.addEventListener('abort', abort, { once: true });
		function finish(): void {
			signal.removeEventListener('abort', abort);
			resolve();
		}
		function abort(): void {
			clearTimeout(timer);
			reject(signal.reason);
		}
	});
}

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}
