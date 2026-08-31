/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Handing a persisted proxy body to the authority that revalidates it.
 *
 * Revalidation takes an `acquireBody` port and no implementation shipped, so
 * the one authority that can decide a persisted attachment is safe to show had
 * no way to read what it was deciding about. This is that port over the project
 * store, for both bodies an attachment names: the proxy picture and the timing
 * index that proves it lines up.
 *
 * Both are content-addressed — a body lives at `video-proxy-sha256:<digest>` or
 * `video-timing-sha256:<digest>` — which is what makes the identity answer here
 * honest and cheap. The digest *is* the generation, so a body that changed is
 * not the same body at a new generation but a different key entirely, and this
 * port never has to guess whether the bytes moved underneath it.
 *
 * It deliberately does not decide anything. Length is checked because a body of
 * the wrong size cannot be the one the attachment names and reading further
 * wastes a load, but the digest, the timing validation, and the conformance
 * rerun all belong to the revalidation authority, which is the only thing
 * allowed to conclude that a proxy may be shown. A body that is missing,
 * unreadable, or the wrong length fails here, and a failure there means
 * original-or-unavailable — never a proxy shown on trust.
 */

import { canonicalMediaContentBlob } from '../common/editor/storage/media-content-digest.ts';
import type {
	FramescaperVideoProxyBodyLeaseSequence,
	FramescaperVideoProxyBodyRequestSequence,
	FramescaperVideoProxyExpectedBodySequence,
} from './editor-video-proxy-revalidation-contract-sequence.ts';

export interface FramescaperVideoProxyBodyStoreSequence {
	loadMediaAsset(
		storageKey: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Promise<unknown>;
}

export interface FramescaperVideoProxyBodySourceDependenciesSequence {
	readonly store: FramescaperVideoProxyBodyStoreSequence;
	/** The live project, re-read on every currentness check. */
	getProject(): unknown;
}

/** One `acquireBody` port over the store the attachment's bodies were published to. */
export function createFramescaperVideoProxyBodySourceSequence(
	dependencies: FramescaperVideoProxyBodySourceDependenciesSequence,
): (request: Readonly<FramescaperVideoProxyBodyRequestSequence>) => Promise<FramescaperVideoProxyBodyLeaseSequence> {
	const store = dependencies?.store;
	const getProject = dependencies?.getProject;
	if (!store || typeof store.loadMediaAsset !== 'function') {
		throw new TypeError('A Framescaper sequence proxy body source requires a media store.');
	}
	if (typeof getProject !== 'function') {
		throw new TypeError('A Framescaper sequence proxy body source requires the live project.');
	}

	return async function acquireBody(request) {
		const projectId = nonEmpty(request?.projectId, 'project');
		const sourceId = nonEmpty(request?.sourceId, 'source');
		const expected = request?.expected;
		if (!expected || typeof expected !== 'object') {
			throw new TypeError('A Framescaper sequence proxy body request states what it expects.');
		}
		const storageKey = nonEmpty(expected.storageKey, 'storage key');
		throwIfAborted(request?.signal);
		assertAttachmentNames(getProject(), projectId, sourceId, expected);

		const loaded = await store.loadMediaAsset(storageKey, signalOptions(request?.signal));
		throwIfAborted(request?.signal);
		if (loaded == null) {
			throw new Error(`The ${expected.role} body ${storageKey} is missing.`);
		}
		const body = canonicalMediaContentBlob(loaded);
		if (body.size !== expected.byteLength) {
			// Not the body this attachment names. Reading further would only
			// rediscover that more expensively.
			throw new Error(
				`The ${expected.role} body ${storageKey} is ${String(body.size)} bytes, not ${
					String(expected.byteLength)
				}.`,
			);
		}

		let released = false;
		return Object.freeze({
			// The digest is the address, so it is also the generation: a changed
			// body is a different key, never this key at a later moment.
			identity: Object.freeze({ ...expected, generationToken: `${expected.kind}:${expected.sha256}` }),
			body,
			assertCurrent() {
				if (released) throw abortError(`The ${expected.role} body lease was released.`);
				assertAttachmentNames(getProject(), projectId, sourceId, expected);
			},
			release() {
				released = true;
			},
		} as FramescaperVideoProxyBodyLeaseSequence);
	};
}

function assertAttachmentNames(
	project: unknown,
	projectId: string,
	sourceId: string,
	expected: FramescaperVideoProxyExpectedBodySequence,
): void {
	const record = (project && typeof project === 'object' ? project : null) as
		| Readonly<{ id?: unknown; sources?: readonly Readonly<Record<string, unknown>>[] }>
		| null;
	if (!record || String(record.id) !== projectId) {
		throw abortError(`Project ${projectId} is no longer open.`);
	}
	const source = record.sources?.find((candidate) => candidate?.id === sourceId);
	const attachment = source?.proxyAttachment as
		| Readonly<{ storageKey?: unknown; timingAsset?: Readonly<{ storageKey?: unknown }> }>
		| null
		| undefined;
	if (!attachment) {
		throw abortError(`Source ${sourceId} no longer has a proxy attachment.`);
	}
	const named = expected.role === 'timing'
		? String(attachment.timingAsset?.storageKey)
		: String(attachment.storageKey);
	if (named !== expected.storageKey) {
		// The attachment was replaced while this body was being read, so the bytes
		// on the way back belong to a proxy the project no longer has.
		throw abortError(`Source ${sourceId} no longer names ${expected.role} body ${expected.storageKey}.`);
	}
}

function nonEmpty(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) {
		throw new TypeError(`A Framescaper sequence proxy body ${name} is required.`);
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
