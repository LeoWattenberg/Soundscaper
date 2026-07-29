/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	type ActiveMediaAssetIdentity,
	MediaAssetLifecycleCoordinator,
	type MediaAssetLifecycleRegistration,
} from './media-asset-lifecycle-coordinator.ts';

type MediaAssetWriteSettlement =
	| Readonly<{ ok: true }>
	| Readonly<{ error: unknown; ok: false }>;

/** Tracks a streamed-writer begin before its staging identity and writer exist. */
export class MediaAssetWriteAdmission {
	readonly #registration: MediaAssetLifecycleRegistration;
	readonly #controller = new AbortController();
	readonly #settled: Promise<MediaAssetWriteSettlement>;
	readonly #settle: (settlement: MediaAssetWriteSettlement) => void;
	readonly #externalSignal?: AbortSignal;
	readonly #abortFromExternal: () => void;
	#externalListening = false;
	#writerAbort: (() => Promise<void>) | null = null;
	#maintenanceReason: Error | null = null;
	#completed = false;

	constructor(coordinator: MediaAssetLifecycleCoordinator, externalSignal?: AbortSignal) {
		this.#registration = coordinator.register();
		this.#externalSignal = externalSignal;
		this.#abortFromExternal = () => { this.#controller.abort(externalSignal?.reason); };
		if (externalSignal?.aborted) this.#abortFromExternal();
		else if (externalSignal) {
			externalSignal.addEventListener('abort', this.#abortFromExternal, { once: true });
			this.#externalListening = true;
		}
		let settle!: (settlement: MediaAssetWriteSettlement) => void;
		this.#settled = new Promise<MediaAssetWriteSettlement>((resolve) => { settle = resolve; });
		this.#settle = settle;
		this.#registration.attachAbort(async () => {
			this.#maintenanceReason ??= maintenanceAbortReason();
			this.#controller.abort(this.#maintenanceReason);
			const settlement = await this.#settled;
			if (!settlement.ok) throw settlement.error;
			await this.#writerAbort?.();
		});
	}

	get signal(): AbortSignal { return this.#controller.signal; }

	setIdentity(identity: ActiveMediaAssetIdentity): void {
		this.#registration.setIdentity(identity);
	}

	bindWriterAbort(abort: () => Promise<void>): void {
		if (this.#writerAbort) throw new Error('The media writer admission already has a terminal abort.');
		this.#writerAbort = abort;
	}

	throwIfCancelled(): void {
		if (!this.signal.aborted) return;
		if (this.signal.reason !== undefined) throw this.signal.reason;
		throw this.#maintenanceReason ?? maintenanceAbortReason();
	}

	complete(): void { this.#finish({ ok: true }); }

	failCleanup(error: unknown): void { this.#finish({ error, ok: false }); }

	#finish(settlement: MediaAssetWriteSettlement): void {
		if (this.#completed) return;
		this.#completed = true;
		if (this.#externalListening) {
			this.#externalListening = false;
			this.#externalSignal?.removeEventListener('abort', this.#abortFromExternal);
		}
		this.#settle(settlement);
	}

	release(): void { this.#registration.release(); }
}

function maintenanceAbortReason(): Error {
	if (typeof DOMException === 'function') {
		return new DOMException('Media storage maintenance cancelled writer admission.', 'AbortError');
	}
	const error = new Error('Media storage maintenance cancelled writer admission.');
	error.name = 'AbortError';
	return error;
}
