/* SPDX-License-Identifier: AGPL-3.0-only */

import { checkedPublicationByteSum } from '../common/editor/publication-byte-estimates.ts';
import { estimateProjectRevisionPublication } from '../common/editor/project-publication-admission.ts';
import { MEDIA_CONTENT_DIGEST_CHUNK_BYTES } from '../common/editor/storage/media-content-digest.ts';
import type { VideoProxyRelationshipPreparationMaterial } from '../common/editor/video-proxy-relationship.ts';
import type { FramescaperProjectSequence } from './editor-project-sequence.ts';

const REVISION_ENVELOPE_ALLOWANCE_BYTES = 64 * 1024;
const BODY_STAGING_ALLOWANCE_BYTES = 2 * MEDIA_CONTENT_DIGEST_CHUNK_BYTES;
const STORE_BUDGETS = new WeakMap<object, BudgetState>();

interface BudgetWaiter {
	readonly signal?: AbortSignal;
	readonly resolve: (release: () => void) => void;
	readonly reject: (error: unknown) => void;
	aborted: boolean;
	abortListener: (() => void) | null;
}

interface BudgetState {
	active: boolean;
	readonly waiters: BudgetWaiter[];
}

export interface FramescaperVideoProxyCapacityStoreSequence {
	estimateStorage(): Promise<Readonly<{ usage: number | null; quota: number | null }>>;
	queryPersistentStorage(): Promise<boolean | null>;
}

export class FramescaperVideoProxyAttachmentCapacityErrorSequence extends Error {
	readonly code = 'FRAMESCAPER_SEQUENCE_PROXY_CAPACITY_UNAVAILABLE';
	constructor(message = 'Durable persistent storage with a known sufficient quota is required for sequence proxy attachment.') {
		super(message);
		this.name = 'FramescaperVideoProxyAttachmentCapacityErrorSequence';
	}
}

export async function assertFramescaperVideoProxyAttachmentCapacitySequence(
	store: FramescaperVideoProxyCapacityStoreSequence,
	base: FramescaperProjectSequence,
	next: FramescaperProjectSequence,
	material: VideoProxyRelationshipPreparationMaterial,
	signal?: AbortSignal,
): Promise<void> {
	throwIfAborted(signal);
	const persistent = await store.queryPersistentStorage();
	const estimate = await store.estimateStorage();
	throwIfAborted(signal);
	if (persistent !== true || !knownBytes(estimate.usage) || !knownBytes(estimate.quota)) {
		throw new FramescaperVideoProxyAttachmentCapacityErrorSequence();
	}
	const documents = checkedPublicationByteSum(
		estimateProjectRevisionPublication(base).document.bytes,
		estimateProjectRevisionPublication(next).document.bytes,
	);
	const publicationBytes = checkedPublicationByteSum(
		material.info.candidateByteLength,
		material.timingPublication.bytes.byteLength,
		documents,
		REVISION_ENVELOPE_ALLOWANCE_BYTES,
		BODY_STAGING_ALLOWANCE_BYTES,
	);
	const required = checkedPublicationByteSum(publicationBytes, Math.ceil(publicationBytes / 10));
	if (Math.max(0, estimate.quota - estimate.usage) < required) {
		throw new FramescaperVideoProxyAttachmentCapacityErrorSequence(
			'The known sequence storage quota is insufficient for atomic proxy attachment.',
		);
	}
}

export function acquireFramescaperVideoProxyAttachmentBudgetSequence(
	store: object,
	signal?: AbortSignal,
): Promise<() => void> {
	try { throwIfAborted(signal); }
	catch (error) { return Promise.reject(error); }
	const state = STORE_BUDGETS.get(store) ?? { active: false, waiters: [] };
	STORE_BUDGETS.set(store, state);
	return new Promise<() => void>((resolve, reject) => {
		const waiter: BudgetWaiter = {
			...(signal ? { signal } : {}), resolve, reject, aborted: false, abortListener: null,
		};
		if (signal) {
			waiter.abortListener = () => {
				waiter.aborted = true;
				waiter.reject(abortReason(signal));
				settleBudgetQueue(store, state);
			};
			signal.addEventListener('abort', waiter.abortListener, { once: true });
		}
		state.waiters.push(waiter);
		settleBudgetQueue(store, state);
	});
}

function settleBudgetQueue(store: object, state: BudgetState): void {
	if (state.active) return;
	let waiter = state.waiters.shift();
	while (waiter?.aborted) {
		removeAbortListener(waiter);
		waiter = state.waiters.shift();
	}
	if (!waiter) {
		if (STORE_BUDGETS.get(store) === state) STORE_BUDGETS.delete(store);
		return;
	}
	removeAbortListener(waiter);
	state.active = true;
	let released = false;
	waiter.resolve(() => {
		if (released) return;
		released = true;
		state.active = false;
		settleBudgetQueue(store, state);
	});
}

function removeAbortListener(waiter: BudgetWaiter): void {
	if (waiter.signal && waiter.abortListener) {
		waiter.signal.removeEventListener('abort', waiter.abortListener);
	}
	waiter.abortListener = null;
}

function abortReason(signal: AbortSignal): unknown {
	return signal.reason === undefined
		? new DOMException('sequence video proxy attachment was cancelled.', 'AbortError')
		: signal.reason;
}

function knownBytes(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('sequence video proxy attachment was cancelled.', 'AbortError');
}
