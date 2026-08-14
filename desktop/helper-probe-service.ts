/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The main-process owner of the native probe helper surface. The renderer
 * addresses media only by its opaque read-capability id; this service
 * resolves the id to a main-verified path, mints the narrow per-job grant,
 * runs the job under the supervised helper contract, and re-validates the
 * helper's result before anything reaches the renderer. The surface is off
 * by default: when disabled or quarantined, every probe fails with a typed
 * status the renderer treats as "use the wasm probe instead" — degradation
 * is visible and recorded, never silent.
 */

import { decodeVideoTimingAsset } from '../src/common/editor/video-timing-asset.ts';
import { normalizeVideoSourceCharacteristics } from '../src/common/editor/video-source-characteristics.ts';
import {
	type HelperProbeResultPayload,
	validateHelperProbeResult,
} from './helper-contract.ts';
import { HelperSupervisionError, type HelperJobRequest } from './helper-supervisor.ts';

export const MAXIMUM_PENDING_HELPER_PROBES = 4;

export type HelperProbeFailureCode =
	| 'helper-disabled'
	| 'helper-quarantined'
	| 'helper-busy'
	| 'unknown-capability'
	| 'helper-cancelled'
	| 'helper-failed';

export type HelperProbeCompletion =
	| Readonly<{ status: 'probed'; timingAsset: Uint8Array; nominalRate: Readonly<{ num: number; den: number }>; characteristics: unknown }>
	| Readonly<{ status: 'failed'; code: HelperProbeFailureCode; message: string }>;

export interface HelperProbeGrantSource {
	resolveHelperGrant(id: string, options: Readonly<{ owner: object }>): Promise<Readonly<{
		path: string;
		size: number;
		identity: Readonly<{ dev: number; ino: number }>;
	}> | null>;
}

export interface HelperProbeSupervisorPort {
	runJob(request: HelperJobRequest): Promise<unknown>;
	snapshot(): Readonly<{ state: string; quarantined: boolean }>;
	clearQuarantine(): void;
	dispose(): void;
}

export interface HelperProbeServiceOptions {
	supervisor: HelperProbeSupervisorPort;
	grants: HelperProbeGrantSource;
	isEnabled: () => boolean;
	mintProbeId: () => string;
}

interface PendingProbe {
	readonly owner: object;
	readonly controller: AbortController;
	readonly completion: Promise<HelperProbeCompletion>;
	awaited: boolean;
}

export class DesktopHelperProbeService {
	readonly #supervisor: HelperProbeSupervisorPort;
	readonly #grants: HelperProbeGrantSource;
	readonly #isEnabled: () => boolean;
	readonly #mintProbeId: () => string;
	readonly #pending = new Map<string, PendingProbe>();
	#queue: Promise<unknown> = Promise.resolve();
	#disposed = false;

	constructor(options: HelperProbeServiceOptions) {
		this.#supervisor = options.supervisor;
		this.#grants = options.grants;
		this.#isEnabled = options.isEnabled;
		this.#mintProbeId = options.mintProbeId;
	}

	/** True when the helper surface is enabled and not quarantined. */
	availability(): Readonly<{ enabled: boolean; quarantined: boolean }> {
		return Object.freeze({
			enabled: !this.#disposed && this.#isEnabled(),
			quarantined: this.#supervisor.snapshot().quarantined,
		});
	}

	clearQuarantine(): void {
		this.#supervisor.clearQuarantine();
	}

	async beginProbe({ owner, capabilityId }: Readonly<{ owner: object; capabilityId: string }>): Promise<Readonly<{ probeId: string }>> {
		if (this.#disposed || !this.#isEnabled()) {
			throw probeRefusal('helper-disabled', 'The native probe helper is disabled.');
		}
		if (this.#supervisor.snapshot().quarantined) {
			throw probeRefusal('helper-quarantined', 'The native probe helper is quarantined after repeated crashes.');
		}
		if (this.#pending.size >= MAXIMUM_PENDING_HELPER_PROBES) {
			throw probeRefusal('helper-busy', 'Too many native probes are already pending.');
		}
		const grant = await this.#grants.resolveHelperGrant(capabilityId, { owner });
		if (!grant) {
			throw probeRefusal('unknown-capability', 'The probe capability is not live for this renderer.');
		}
		const probeId = this.#mintProbeId();
		const controller = new AbortController();
		const completion = this.#enqueue(() => this.#supervisor.runJob({
			kind: 'probe-video-source',
			grant: {
				mediaPath: grant.path,
				mediaBytes: grant.size,
				identity: grant.identity,
			},
			signal: controller.signal,
			validateResult: (value) => this.#validateProbeResult(value),
		})).then(
			(result) => Object.freeze({ status: 'probed' as const, ...(result as HelperProbeResultPayload) }),
			(error: unknown) => Object.freeze({
				status: 'failed' as const,
				code: failureCode(error),
				message: error instanceof Error ? error.message : String(error),
			}),
		);
		this.#pending.set(probeId, { owner, controller, completion, awaited: false });
		return Object.freeze({ probeId });
	}

	async awaitProbe({ owner, probeId }: Readonly<{ owner: object; probeId: string }>): Promise<HelperProbeCompletion> {
		const pending = this.#pending.get(probeId);
		if (!pending || pending.owner !== owner || pending.awaited) {
			throw probeRefusal('unknown-capability', 'The probe id is not pending for this renderer.');
		}
		pending.awaited = true;
		try {
			return await pending.completion;
		} finally {
			this.#pending.delete(probeId);
		}
	}

	cancelProbe({ owner, probeId }: Readonly<{ owner: object; probeId: string }>): Readonly<{ cancelled: boolean }> {
		const pending = this.#pending.get(probeId);
		if (!pending || pending.owner !== owner) return Object.freeze({ cancelled: false });
		pending.controller.abort(probeRefusal('helper-cancelled', 'The probe was cancelled.'));
		return Object.freeze({ cancelled: true });
	}

	revokeOwner(owner: object): void {
		for (const [probeId, pending] of this.#pending) {
			if (pending.owner !== owner) continue;
			pending.controller.abort(probeRefusal('helper-cancelled', 'The probe owner went away.'));
			this.#pending.delete(probeId);
			pending.completion.catch(() => undefined);
		}
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const [probeId, pending] of this.#pending) {
			pending.controller.abort(probeRefusal('helper-cancelled', 'The helper service is shutting down.'));
			this.#pending.delete(probeId);
			pending.completion.catch(() => undefined);
		}
		this.#supervisor.dispose();
	}

	/** Serialize helper jobs: contract v1 admits one concurrent job. */
	#enqueue(operation: () => Promise<unknown>): Promise<unknown> {
		const next = this.#queue.then(operation, operation);
		this.#queue = next.catch(() => undefined);
		return next;
	}

	/**
	 * Never trust helper output: the payload shape, the encoded timing asset,
	 * and the characteristics record are each re-validated here in main before
	 * the renderer sees a byte — the renderer then validates them all again.
	 */
	#validateProbeResult(value: unknown): HelperProbeResultPayload {
		const payload = validateHelperProbeResult(value);
		decodeVideoTimingAsset(payload.timingAsset);
		normalizeVideoSourceCharacteristics(
			(payload.characteristics ?? null) as Parameters<typeof normalizeVideoSourceCharacteristics>[0],
			{ rate: payload.nominalRate },
		);
		return payload;
	}
}

class HelperProbeRefusalError extends Error {
	readonly code: HelperProbeFailureCode;

	constructor(code: HelperProbeFailureCode, message: string) {
		super(message);
		this.name = 'HelperProbeRefusalError';
		this.code = code;
	}
}

function probeRefusal(code: HelperProbeFailureCode, message: string): HelperProbeRefusalError {
	return new HelperProbeRefusalError(code, message);
}

function failureCode(error: unknown): HelperProbeFailureCode {
	if (error instanceof HelperProbeRefusalError) return error.code;
	if (error instanceof HelperSupervisionError) {
		if (error.cause_ === 'cancelled' || error.cause_ === 'cancellation-timeout') return 'helper-cancelled';
		if (error.cause_ === 'quarantined') return 'helper-quarantined';
		if (error.cause_ === 'disposed') return 'helper-disabled';
	}
	return 'helper-failed';
}
