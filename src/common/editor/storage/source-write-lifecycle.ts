/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	OwnedAudioSourceWriter,
} from './source-write-repository.ts';

export interface SourceWriteMaintenance {
	abortActive(): Promise<void>;
	release(): void;
}

interface ActiveSourceOperation {
	settleForMaintenance(): Promise<void>;
}

/** Fences destructive maintenance against PCM writer admission and publication. */
export class SourceWriteLifecycleCoordinator {
	readonly #active = new Map<symbol, ActiveSourceOperation>();
	#maintenanceCount = 0;

	begin(
		operation: () => PromiseLike<OwnedAudioSourceWriter> | OwnedAudioSourceWriter,
	): Promise<OwnedAudioSourceWriter> {
		this.#assertAccepting();
		const key = Symbol('active-source-writer');
		let writer: OwnedAudioSourceWriter | null = null;
		let settleBegin!: (value: OwnedAudioSourceWriter | null) => void;
		const beginSettled = new Promise<OwnedAudioSourceWriter | null>((resolve) => {
			settleBegin = resolve;
		});
		let released = false;
		let maintenanceReason: Error | null = null;
		let commitOperation: Promise<unknown> | null = null;
		let abortOperation: Promise<void> | null = null;
		const release = (): void => {
			if (released) return;
			released = true;
			this.#active.delete(key);
		};
		const abortWriter = (): Promise<void> => {
			if (!writer) return Promise.resolve();
			abortOperation ??= Promise.resolve(writer.abort()).finally(release);
			return abortOperation;
		};
		const abortForMaintenance = async (): Promise<void> => {
			maintenanceReason ??= sourceMaintenanceReason();
			writer ??= await beginSettled;
			if (!writer) return;
			const committing = commitOperation;
			if (committing) {
				const [result] = await Promise.allSettled([committing]);
				if (result?.status === 'fulfilled') return;
			}
			await abortWriter();
		};
		this.#active.set(key, { settleForMaintenance: abortForMaintenance });

		return Promise.resolve().then(operation).then(async (opened) => {
			writer = opened;
			settleBegin(opened);
			if (maintenanceReason) {
				try { await abortForMaintenance(); }
				catch (cleanupError) {
					throw new AggregateError(
						[maintenanceReason, cleanupError],
						'Source writer admission and maintenance cleanup both failed.',
						{ cause: maintenanceReason },
					);
				}
				throw maintenanceReason;
			}
			const managed: OwnedAudioSourceWriter = {
				stageReceipt: opened.stageReceipt,
				get framesWritten() { return opened.framesWritten; },
				async write(input, options) {
					if (maintenanceReason) throw maintenanceReason;
					await opened.write(input, options);
				},
				async commit(metadata, options) {
					if (maintenanceReason) throw maintenanceReason;
					const committing = opened.commit(metadata, options);
					commitOperation = committing;
					try {
						const result = await committing;
						release();
						return result;
					} finally {
						if (commitOperation === committing) commitOperation = null;
					}
				},
				abort: abortWriter,
			};
			return managed;
		}, (error: unknown) => {
			settleBegin(null);
			release();
			throw error;
		});
	}

	runPublication<Value>(operation: () => PromiseLike<Value> | Value): Promise<Value> {
		this.#assertAccepting();
		const key = Symbol('active-source-publication');
		const publication = Promise.resolve().then(operation);
		const tracked = publication.finally(() => { this.#active.delete(key); });
		const settlement = tracked.then(() => undefined, () => undefined);
		this.#active.set(key, { settleForMaintenance: () => settlement });
		return tracked;
	}

	beginMaintenance(): SourceWriteMaintenance {
		this.#maintenanceCount += 1;
		const active = [...this.#active.values()];
		let released = false;
		let settlementPromise: Promise<void> | null = null;
		return Object.freeze({
			abortActive: () => {
				settlementPromise ??= settleSourceOperations(active);
				return settlementPromise;
			},
			release: () => {
				if (released) return;
				released = true;
				this.#maintenanceCount = Math.max(0, this.#maintenanceCount - 1);
			},
		});
	}

	#assertAccepting(): void {
		if (this.#maintenanceCount) throw new Error('PCM source storage is under maintenance.');
	}
}

async function settleSourceOperations(active: readonly ActiveSourceOperation[]): Promise<void> {
	const results = await Promise.allSettled(active.map(({ settleForMaintenance }) => settleForMaintenance()));
	const errors = results
		.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
		.map(({ reason }) => reason);
	if (errors.length === 1) throw errors[0];
	if (errors.length > 1) throw new AggregateError(errors, 'One or more active PCM source operations could not be settled.');
}

function sourceMaintenanceReason(): Error {
	if (typeof DOMException === 'function') {
		return new DOMException('PCM source storage maintenance cancelled the writer.', 'AbortError');
	}
	const error = new Error('PCM source storage maintenance cancelled the writer.');
	error.name = 'AbortError';
	return error;
}
