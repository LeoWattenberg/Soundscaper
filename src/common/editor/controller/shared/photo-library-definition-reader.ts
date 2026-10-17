/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDefinitionReadRequestV1, PhotoLibraryDefinitionSnapshotV1 } from '../../photo-library-organization-port-v1.ts';

type ReadDefinition = (request: PhotoLibraryDefinitionReadRequestV1) => Promise<PhotoLibraryDefinitionSnapshotV1>;
interface BorrowedRead {
	readonly request: PhotoLibraryDefinitionReadRequestV1 & Readonly<{ signal: AbortSignal }>;
	readonly read: ReadDefinition;
	readonly resolve: (snapshot: PhotoLibraryDefinitionSnapshotV1) => void;
	readonly reject: (error: unknown) => void;
	readonly abort: () => void;
}

/** App-owned across modal/factory generations: one active borrow and one pending demand. */
export class PhotoLibraryDefinitionReader {
	#active: BorrowedRead | null = null;
	#pending: BorrowedRead | null = null;

	read(read: ReadDefinition, request: BorrowedRead['request']): Promise<PhotoLibraryDefinitionSnapshotV1> {
		request.signal.throwIfAborted();
		return new Promise((resolve, reject) => {
			const job: BorrowedRead = { request, read, resolve, reject, abort: () => {
				if (this.#pending !== job) return;
				this.#pending = null; request.signal.removeEventListener('abort', job.abort); reject(request.signal.reason);
			} };
			if (this.#active && this.#pending) { reject(new Error('A definition name demand is already pending.')); return; }
			request.signal.addEventListener('abort', job.abort, { once: true });
			if (this.#active) this.#pending = job; else void this.#start(job);
		});
	}

	async #start(job: BorrowedRead): Promise<void> {
		this.#active = job;
		try {
			job.request.signal.throwIfAborted();
			const snapshot = await job.read(job.request);
			job.request.signal.throwIfAborted(); job.resolve(snapshot);
		} catch (error) { job.reject(error); }
		finally {
			job.request.signal.removeEventListener('abort', job.abort); this.#active = null;
			const next = this.#pending; this.#pending = null;
			if (next) void this.#start(next);
		}
	}
}
