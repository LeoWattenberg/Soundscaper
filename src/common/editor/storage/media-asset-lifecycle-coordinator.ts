/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ActiveMediaAssetIdentity {
	readonly mediaChunkToken?: string;
	readonly path?: string;
}

export interface MediaAssetLifecycleRegistration {
	attachAbort(abort: () => Promise<void>): void;
	setIdentity(identity: ActiveMediaAssetIdentity): void;
	release(): void;
}

export interface MediaAssetMaintenance {
	abortActive(): Promise<void>;
	release(): void;
}

interface ActiveMediaAssetOperation {
	identity: ActiveMediaAssetIdentity;
	abort: (() => Promise<void>) | null;
}

/** Serializes destructive maintenance with admitted media reads and writes. */
export class MediaAssetLifecycleCoordinator {
	readonly #active = new Map<symbol, ActiveMediaAssetOperation>();
	#maintenanceCount = 0;
	#permanentlyClosed = false;

	assertAccepting(): void {
		if (this.#permanentlyClosed) throw new Error('Media asset storage is closed.');
		if (this.#maintenanceCount) throw new Error('Media asset storage is under maintenance.');
	}

	register(identity: ActiveMediaAssetIdentity = {}): MediaAssetLifecycleRegistration {
		this.assertAccepting();
		const key = Symbol('active-media-operation');
		const active: ActiveMediaAssetOperation = { identity: Object.freeze({ ...identity }), abort: null };
		this.#active.set(key, active);
		let released = false;
		return {
			attachAbort: (abort) => {
				if (released || active.abort) throw new Error('The media operation registration is not attachable.');
				active.abort = abort;
			},
			setIdentity: (nextIdentity) => {
				if (released) throw new Error('The media operation registration is released.');
				active.identity = Object.freeze({ ...nextIdentity });
			},
			release: () => {
				if (released) return;
				released = true;
				this.#active.delete(key);
			},
		};
	}

	beginMaintenance({ permanent = false }: Readonly<{ permanent?: boolean }> = {}): MediaAssetMaintenance {
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

async function abortAll(active: readonly ActiveMediaAssetOperation[]): Promise<void> {
	const results = await Promise.allSettled(active.map(({ abort }) => {
		if (!abort) return Promise.reject(new Error('An active media operation has no abort handler.'));
		return abort();
	}));
	const errors = results
		.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
		.map(({ reason }) => reason);
	if (errors.length) throw new AggregateError(errors, 'One or more active media operations could not be aborted.');
}

function identityValues(
	active: Iterable<ActiveMediaAssetOperation>,
	field: keyof ActiveMediaAssetIdentity,
): ReadonlySet<string> {
	const values = new Set<string>();
	for (const { identity } of active) {
		const value = identity[field];
		if (typeof value === 'string' && value) values.add(value);
	}
	return values;
}
