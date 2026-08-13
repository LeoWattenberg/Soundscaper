/* SPDX-License-Identifier: AGPL-3.0-only */

import { checkedPublicationByteSum } from '../common/editor/publication-byte-estimates.ts';
import { estimateProjectRevisionPublication } from '../common/editor/project-publication-admission.ts';
import { MEDIA_CONTENT_DIGEST_CHUNK_BYTES } from '../common/editor/storage/media-content-digest.ts';
import type { VideoProxyRelationshipPreparationMaterial } from '../common/editor/video-proxy-relationship.ts';
import type { FramescaperProjectV18 } from './editor-project-v18.ts';

const REVISION_ENVELOPE_ALLOWANCE_BYTES = 64 * 1024;
const BODY_STAGING_ALLOWANCE_BYTES = 2 * MEDIA_CONTENT_DIGEST_CHUNK_BYTES;
const STORE_BUDGETS = new WeakMap<object, Promise<void>>();

export interface FramescaperVideoProxyCapacityStoreV18 {
	estimateStorage(): Promise<Readonly<{ usage: number | null; quota: number | null }>>;
	queryPersistentStorage(): Promise<boolean | null>;
}

export class FramescaperVideoProxyAttachmentCapacityErrorV18 extends Error {
	readonly code = 'FRAMESCAPER_V18_PROXY_CAPACITY_UNAVAILABLE';
	constructor(message = 'Durable persistent storage with a known sufficient quota is required for V18 proxy attachment.') {
		super(message);
		this.name = 'FramescaperVideoProxyAttachmentCapacityErrorV18';
	}
}

export async function assertFramescaperVideoProxyAttachmentCapacityV18(
	store: FramescaperVideoProxyCapacityStoreV18,
	base: FramescaperProjectV18,
	next: FramescaperProjectV18,
	material: VideoProxyRelationshipPreparationMaterial,
	signal?: AbortSignal,
): Promise<void> {
	throwIfAborted(signal);
	const persistent = await store.queryPersistentStorage();
	const estimate = await store.estimateStorage();
	throwIfAborted(signal);
	if (persistent !== true || !knownBytes(estimate.usage) || !knownBytes(estimate.quota)) {
		throw new FramescaperVideoProxyAttachmentCapacityErrorV18();
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
		throw new FramescaperVideoProxyAttachmentCapacityErrorV18(
			'The known V18 storage quota is insufficient for atomic proxy attachment.',
		);
	}
}

export async function acquireFramescaperVideoProxyAttachmentBudgetV18(store: object): Promise<() => void> {
	const prior = STORE_BUDGETS.get(store) ?? Promise.resolve();
	let release!: () => void;
	const current = new Promise<void>((resolve) => { release = resolve; });
	const tail = prior.then(() => current);
	STORE_BUDGETS.set(store, tail);
	await prior;
	return () => {
		release();
		if (STORE_BUDGETS.get(store) === tail) STORE_BUDGETS.delete(store);
	};
}

function knownBytes(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('V18 video proxy attachment was cancelled.', 'AbortError');
}
