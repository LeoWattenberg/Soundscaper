/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Opening one original video source for the proxy authorities to work from.
 *
 * Both proxy authorities take an `observeOriginal` port and neither ships an
 * implementation: the relationship authority uses it to generate and time a
 * candidate against the source it names, and revalidation uses it to re-bind a
 * persisted attachment to the original as it stands *now*. This is that port,
 * bound to the project store the editor already loads pictures from, so an
 * owned source and a linked one both open the same way.
 *
 * **What identity means here.** The lease answers a fingerprint whose
 * `generationToken` changes whenever the bytes behind the source change: for an
 * owned source it is the storage key with the content digest the project
 * records, and for a linked one it is the binding token with its locator
 * revision, which is what relink moves. `assertCurrent` re-reads the live
 * project and refuses as soon as that token, the storage key, or the digest
 * stops matching what was opened — which is how a proxy generated across a
 * relink, a replace, or a trim fails to attach instead of attaching to the wrong
 * source.
 *
 * **What it deliberately does not do.** It does not re-digest the original. A
 * video source is routinely gigabytes, the editor treats `contentSha256` as the
 * source's identity everywhere else, and hashing it again on the way into every
 * proxy generation would cost a full read to re-learn something the project
 * already states. Integrity of the *proxy* body is a different question and is
 * proven where it belongs: the candidate observer digests what the generator
 * produced, and revalidation digests the persisted body before it is trusted.
 */

import type { VideoProxyOriginalObservationRequest } from '../video-proxy-relationship.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

export interface VideoProxyOriginalSource extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly kind?: string;
	readonly storageKey?: string;
	readonly contentSha256?: string;
	readonly mimeType?: string;
}

export interface VideoProxyOriginalStore {
	loadMediaAsset(
		sourceId: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Promise<Blob | null>;
	resolveLinkedVideoOriginal?(
		projectId: string,
		source: VideoProxyOriginalSource,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Promise<Readonly<{ readonly blob: Blob; readonly binding: unknown }> | null>;
}

export interface VideoProxyOriginalObserverDependencies {
	readonly store: VideoProxyOriginalStore;
	/** The live project, re-read on every currentness check rather than captured. */
	getProject(): unknown;
}

export interface VideoProxyOriginalFingerprint extends Readonly<Record<string, unknown>> {
	readonly authority: 'owned' | 'linked';
	readonly projectId: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly generationToken: string;
}

export interface VideoProxyOriginalObserverLease {
	readonly blob: Blob;
	readonly fingerprint: VideoProxyOriginalFingerprint;
	assertCurrent(): void;
	release(): Awaitable<void>;
}

interface LinkedBinding {
	readonly bindingToken?: unknown;
	readonly locatorRevision?: unknown;
	readonly locatorId?: unknown;
}

/** One `observeOriginal` port over the project store. */
export function createVideoProxyOriginalObserver(
	dependencies: VideoProxyOriginalObserverDependencies,
): (request: Readonly<VideoProxyOriginalObservationRequest>) => Promise<VideoProxyOriginalObserverLease> {
	const store = dependencies?.store;
	const getProject = dependencies?.getProject;
	if (!store || typeof store.loadMediaAsset !== 'function') {
		throw new TypeError('A video proxy original observer requires a media store.');
	}
	if (typeof getProject !== 'function') {
		throw new TypeError('A video proxy original observer requires the live project.');
	}

	return async function observeOriginal(request) {
		const projectId = nonEmpty(request?.projectId, 'project');
		const sourceId = nonEmpty(request?.sourceId, 'source');
		throwIfAborted(request?.signal);
		const source = requireVideoSource(getProject(), projectId, sourceId);
		assertRequestedIdentity(request, source);

		const storageKey = nonEmpty(source.storageKey ?? source.id, 'storage key');
		let blob = await store.loadMediaAsset(storageKey, signalOptions(request?.signal));
		throwIfAborted(request?.signal);
		let authority: 'owned' | 'linked' = 'owned';
		let generationToken = `owned:${storageKey}:${String(source.contentSha256)}`;
		if (!blob && typeof store.resolveLinkedVideoOriginal === 'function') {
			const linked = await store.resolveLinkedVideoOriginal(projectId, source, signalOptions(request?.signal));
			throwIfAborted(request?.signal);
			if (linked?.blob) {
				blob = linked.blob;
				authority = 'linked';
				generationToken = linkedGenerationToken(storageKey, source, linked.binding);
			}
		}
		if (!blob) {
			throw new Error(`The original video for source ${sourceId} is not available.`);
		}

		const fingerprint: VideoProxyOriginalFingerprint = Object.freeze({
			authority,
			projectId,
			sourceId,
			storageKey,
			mimeType: nonEmpty(request?.mimeType ?? source.mimeType ?? blob.type, 'MIME type'),
			byteLength: blob.size,
			sha256: nonEmpty(source.contentSha256, 'content digest'),
			generationToken,
		});
		let released = false;
		return Object.freeze({
			blob,
			fingerprint,
			assertCurrent() {
				if (released) throw abortError('The original video lease was released.');
				// Re-read rather than re-check what was captured: the point is to
				// notice that the project moved, not to agree with itself.
				const current = requireVideoSource(getProject(), projectId, sourceId);
				const key = String(current.storageKey ?? current.id);
				if (key !== fingerprint.storageKey || String(current.contentSha256) !== fingerprint.sha256) {
					throw abortError(`The original video for source ${sourceId} changed.`);
				}
			},
			release() {
				// Nothing is pinned open: the store answered a Blob, and dropping the
				// reference is all a caller can give back. Releasing twice is not an
				// error, because a failed adoption releases on its way out of a path
				// that may already have released.
				released = true;
			},
		});
	};
}

function linkedGenerationToken(
	storageKey: string,
	source: VideoProxyOriginalSource,
	binding: unknown,
): string {
	// A linked original's bytes live outside the project, so its digest alone
	// cannot say whether it is still the same file the user pointed at. The
	// binding token and locator revision are what relink moves, and they are
	// therefore what a proxy's currentness has to hang from.
	const record = (binding && typeof binding === 'object' ? binding : {}) as LinkedBinding;
	const token = typeof record.bindingToken === 'string' && record.bindingToken
		? record.bindingToken
		: String(source.contentSha256 ?? storageKey);
	const revision = typeof record.locatorRevision === 'string' && record.locatorRevision
		? record.locatorRevision
		: '0';
	return `linked:${token}:${revision}`;
}

function requireVideoSource(
	project: unknown,
	projectId: string,
	sourceId: string,
): VideoProxyOriginalSource {
	const record = (project && typeof project === 'object' ? project : null) as
		| Readonly<{ id?: unknown; sources?: readonly VideoProxyOriginalSource[] }>
		| null;
	if (!record || String(record.id) !== projectId) {
		throw abortError(`Project ${projectId} is no longer open.`);
	}
	const source = (record.sources ?? []).find((candidate) => candidate?.id === sourceId);
	if (!source) throw abortError(`Source ${sourceId} is no longer in project ${projectId}.`);
	if (source.kind !== 'video') {
		throw new TypeError(`Source ${sourceId} is not a video source.`);
	}
	return source;
}

function assertRequestedIdentity(
	request: Readonly<VideoProxyOriginalObservationRequest>,
	source: VideoProxyOriginalSource,
): void {
	// The caller derived its request from a source record; if the live one has
	// already moved, the observation is stale before it starts.
	const storageKey = String(source.storageKey ?? source.id);
	if (request.storageKey && request.storageKey !== storageKey) {
		throw abortError(`Source ${source.id} no longer stores its media at ${request.storageKey}.`);
	}
	if (request.contentSha256 && request.contentSha256 !== String(source.contentSha256)) {
		throw abortError(`Source ${source.id} no longer has content ${request.contentSha256}.`);
	}
}

function nonEmpty(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) {
		throw new TypeError(`A video proxy original ${name} is required.`);
	}
	return value;
}

function signalOptions(signal: AbortSignal | undefined) {
	return signal ? { signal } : undefined;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason ?? abortError('The operation was aborted.');
}

function abortError(message: string): Error {
	return typeof DOMException === 'function'
		? new DOMException(message, 'AbortError')
		: Object.assign(new Error(message), { name: 'AbortError' });
}
