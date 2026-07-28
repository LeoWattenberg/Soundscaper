/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ActiveMediaAssetIdentity {
	readonly mediaChunkToken?: string;
	readonly path?: string;
}

export interface MediaAssetWriteRegistration {
	attachAbort(abort: () => Promise<void>): void;
	release(): void;
}

export interface MediaAssetWriteMaintenance {
	abortActive(): Promise<void>;
	release(): void;
}

interface ActiveMediaAssetWrite {
	readonly identity: ActiveMediaAssetIdentity;
	abort: (() => Promise<void>) | null;
}

/** Serializes destructive maintenance with unpublished media payloads. */
export class MediaAssetWriteCoordinator {
	readonly #active = new Map<symbol, ActiveMediaAssetWrite>();
	#maintenanceCount = 0;
	#permanentlyClosed = false;

	assertAccepting(): void {
		if (this.#permanentlyClosed) throw new Error('Streamed media storage is closed.');
		if (this.#maintenanceCount) throw new Error('Streamed media storage is under maintenance.');
	}

	register(identity: ActiveMediaAssetIdentity): MediaAssetWriteRegistration {
		this.assertAccepting();
		const key = Symbol('active-media-write');
		const active: ActiveMediaAssetWrite = { identity: Object.freeze({ ...identity }), abort: null };
		this.#active.set(key, active);
		let released = false;
		return {
			attachAbort: (abort) => {
				if (released || active.abort) throw new Error('The media writer registration is not attachable.');
				active.abort = abort;
			},
			release: () => {
				if (released) return;
				released = true;
				this.#active.delete(key);
			},
		};
	}

	beginMaintenance({ permanent = false }: Readonly<{ permanent?: boolean }> = {}): MediaAssetWriteMaintenance {
		if (permanent) this.#permanentlyClosed = true;
		this.#maintenanceCount += 1;
		const active = [...this.#active.values()];
		let released = false;
		let abortPromise: Promise<void> | null = null;
		return {
			abortActive: () => {
				abortPromise ??= abortAll(active);
				return abortPromise;
			},
			release: () => {
				if (released || permanent) return;
				released = true;
				this.#maintenanceCount = Math.max(0, this.#maintenanceCount - 1);
			},
		};
	}

	activeMediaChunkTokens(): ReadonlySet<string> {
		return identityValues(this.#active.values(), 'mediaChunkToken');
	}

	activePaths(): ReadonlySet<string> {
		return identityValues(this.#active.values(), 'path');
	}
}

async function abortAll(active: readonly ActiveMediaAssetWrite[]): Promise<void> {
	const results = await Promise.allSettled(active.map(({ abort }) => {
		if (!abort) return Promise.reject(new Error('An active media writer has no abort handler.'));
		return abort();
	}));
	const errors = results
		.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
		.map(({ reason }) => reason);
	if (errors.length) throw new AggregateError(errors, 'One or more active media writers could not be aborted.');
}

function identityValues(
	active: Iterable<ActiveMediaAssetWrite>,
	field: keyof ActiveMediaAssetIdentity,
): ReadonlySet<string> {
	const values = new Set<string>();
	for (const { identity } of active) {
		const value = identity[field];
		if (typeof value === 'string' && value) values.add(value);
	}
	return values;
}
