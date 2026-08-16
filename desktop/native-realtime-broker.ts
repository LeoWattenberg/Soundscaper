/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The main-process broker for the 5A-0c real-time data plane.
 *
 * The helper creates a MessageChannel and posts one end to main; main hands
 * that end to exactly one renderer owner and keeps only the authority to take
 * it away again. Main is deliberately not a relay: it never reads a packet, and
 * the port type below names `close()` and nothing else so no later edit can
 * quietly put this process back in the per-block path the milestone stops on.
 *
 * Everything a renderer learns is the bounded handshake the helper declared and
 * main re-validated. No path, no device name, and no helper identity crosses
 * the bridge, and the surface answers a typed refusal rather than parking a
 * port it cannot place — a parked port is a helper writing into a stream that
 * nothing will ever drain.
 *
 * Both Electron seams are injected. In the application `acceptHelperPort` is
 * fed from `event.ports[0]` of the helper's `parentPort.postMessage`, and an
 * owner is a `WebContents` whose `postMessage(channel, message, [port])` moves
 * the port across; in tests they are in-process doubles, so every admission,
 * supersession and revocation rule is exercised without platform authority.
 */

import {
	type NativeRealtimeFormat,
	type NativeRealtimeFormatRequest,
	type NativeRealtimeHandshake,
	type NativeRealtimeTransferredPort,
	describeNativeRealtimeFormatMismatch,
	isNativeRealtimeTransferredPort,
	normalizeNativeRealtimeFormat,
	validateNativeRealtimeHandshake,
} from '../src/common/editor/native-realtime-client.ts';
import { NATIVE_REALTIME_MAX_GENERATION } from '../src/common/editor/native-realtime-protocol.ts';

/** The one channel a brokered port travels on into a renderer. */
export const NATIVE_REALTIME_PORT_CHANNEL = 'soundscaper:native-realtime-port';

export const NATIVE_REALTIME_BROKER_CLOSE_REASONS = Object.freeze([
	'owner-revoked', 'helper-exit', 'superseded', 'disposed', 'refused',
] as const);

export const NATIVE_REALTIME_BROKER_REFUSALS = Object.freeze([
	'surface-disabled', 'foreign-owner', 'malformed-offer', 'unknown-generation',
	'stale-generation', 'generation-occupied', 'format-mismatch', 'delivery-failed',
] as const);

export type NativeRealtimeBrokerCloseReason = (typeof NATIVE_REALTIME_BROKER_CLOSE_REASONS)[number];
export type NativeRealtimeBrokerRefusal = (typeof NATIVE_REALTIME_BROKER_REFUSALS)[number];

export type NativeRealtimeBrokerCloseEvent = Readonly<{
	generation: number | null;
	reason: NativeRealtimeBrokerCloseReason;
	refusal: NativeRealtimeBrokerRefusal | null;
}>;

/** The `WebContents` shape, narrowed to the one call that moves a port. */
export interface NativeRealtimeOwnerTarget {
	postMessage(
		channel: string,
		message: NativeRealtimeHandshake,
		transfer: readonly NativeRealtimeTransferredPort[],
	): void;
}

export type NativeRealtimeAuthorizationRequest = NativeRealtimeFormatRequest & Readonly<{
	owner: NativeRealtimeOwnerTarget;
}>;

export type NativeRealtimeAuthorization =
	| Readonly<{ status: 'authorized'; generation: number; format: NativeRealtimeFormat }>
	| Readonly<{ status: 'refused'; refusal: NativeRealtimeBrokerRefusal; message: string }>;

export type NativeRealtimeBrokerOutcome =
	| Readonly<{ status: 'delivered'; generation: number }>
	| Readonly<{ status: 'refused'; refusal: NativeRealtimeBrokerRefusal; message: string }>;

export interface NativeRealtimeBrokerSnapshot {
	readonly enabled: boolean;
	readonly owned: boolean;
	readonly liveGeneration: number | null;
	readonly pendingGeneration: number | null;
	readonly issuedGenerations: number;
}

export interface DesktopNativeRealtimeBrokerOptions {
	readonly isEnabled: () => boolean;
	/** Injected so revocation is observable; production closes the port handle. */
	readonly closePort?: (port: NativeRealtimeTransferredPort) => void;
	readonly onClose?: (event: NativeRealtimeBrokerCloseEvent) => void;
	readonly channel?: string;
}

interface BrokeredGeneration {
	readonly generation: number;
	readonly owner: NativeRealtimeOwnerTarget;
	readonly format: NativeRealtimeFormat;
	port: NativeRealtimeTransferredPort | null;
}

type RefusedOutcome = Readonly<{ status: 'refused'; refusal: NativeRealtimeBrokerRefusal; message: string }>;

type Admission =
	| Readonly<{ admitted: BrokeredGeneration; refused: null }>
	| Readonly<{ admitted: null; refused: RefusedOutcome }>;

export class DesktopNativeRealtimeBroker {
	readonly #isEnabled: () => boolean;
	readonly #closePort: (port: NativeRealtimeTransferredPort) => void;
	readonly #onClose: ((event: NativeRealtimeBrokerCloseEvent) => void) | null;
	readonly #channel: string;
	// The ledger of ports this broker has already closed. A port that arrives
	// twice, or a live port torn down by two signals at once, is closed on the
	// first cause only: the reason a generation ended is not overwritten by the
	// symptom that followed it.
	readonly #closedPorts = new WeakSet<NativeRealtimeTransferredPort>();
	#owner: NativeRealtimeOwnerTarget | null = null;
	#live: BrokeredGeneration | null = null;
	#pending: BrokeredGeneration | null = null;
	#issued = 0;
	#disposed = false;

	constructor(options: DesktopNativeRealtimeBrokerOptions) {
		this.#isEnabled = options.isEnabled;
		this.#closePort = options.closePort ?? ((port) => port.close());
		this.#onClose = options.onClose ?? null;
		this.#channel = options.channel ?? NATIVE_REALTIME_PORT_CHANNEL;
	}

	snapshot(): NativeRealtimeBrokerSnapshot {
		return Object.freeze({
			enabled: this.#available(),
			owned: this.#owner !== null,
			liveGeneration: this.#live?.generation ?? null,
			pendingGeneration: this.#pending?.generation ?? null,
			issuedGenerations: this.#issued,
		});
	}

	/**
	 * Mints the one generation a helper may offer a port for. Main owns the
	 * number, not the helper: a peer that could pick its own could burn the
	 * monotonic ledger far ahead of main and lock every later stream out.
	 */
	authorize(request: NativeRealtimeAuthorizationRequest): NativeRealtimeAuthorization {
		if (!this.#available()) return refusedAuthorization('surface-disabled', 'The native real-time surface is disabled.');
		if (this.#owner !== null && this.#owner !== request.owner) {
			return refusedAuthorization('foreign-owner', 'Another renderer already owns the native real-time surface.');
		}
		if (this.#issued >= NATIVE_REALTIME_MAX_GENERATION) {
			return refusedAuthorization('stale-generation', 'The native real-time generation ledger is exhausted.');
		}
		let format: NativeRealtimeFormat;
		try {
			format = normalizeNativeRealtimeFormat(request);
		} catch (error) {
			return refusedAuthorization('format-mismatch', error instanceof Error ? error.message : String(error));
		}
		// An authorization still waiting for its port is replaced here, so the
		// helper cannot satisfy a request main has already withdrawn. The live
		// generation keeps playing until a port for the new one actually lands.
		this.#owner = request.owner;
		this.#issued += 1;
		this.#pending = { generation: this.#issued, owner: request.owner, format, port: null };
		return Object.freeze({ status: 'authorized' as const, generation: this.#issued, format });
	}

	/**
	 * Takes the port the helper posted to main and forwards it to the one owner
	 * that authorized it. Main validates the handshake before the port moves and
	 * never subscribes to it: the only property this process ever names on a
	 * transferred port is `close`.
	 */
	acceptHelperPort(offer: unknown, ports: readonly NativeRealtimeTransferredPort[] = []): NativeRealtimeBrokerOutcome {
		const port: unknown = ports.length === 1 ? ports[0] : null;
		if (!isNativeRealtimeTransferredPort(port)) {
			for (const offered of ports) this.#closeOffered(offered, null, 'malformed-offer');
			return refusedOutcome('malformed-offer', 'A native real-time offer must carry exactly one MessagePort.');
		}
		if (!this.#available()) {
			this.#closeOffered(port, null, 'surface-disabled');
			return refusedOutcome('surface-disabled', 'The native real-time surface is disabled.');
		}
		let handshake: NativeRealtimeHandshake;
		try {
			handshake = validateNativeRealtimeHandshake(offer);
		} catch (error) {
			this.#closeOffered(port, null, 'malformed-offer');
			return refusedOutcome('malformed-offer', error instanceof Error ? error.message : String(error));
		}
		const { admitted, refused } = this.#admit(handshake);
		if (!admitted) {
			this.#closeOffered(port, handshake.generation, refused.refusal);
			return refused;
		}
		try {
			admitted.owner.postMessage(this.#channel, handshake, Object.freeze([port]));
		} catch (error) {
			this.#retire(admitted);
			this.#closeOffered(port, handshake.generation, 'delivery-failed');
			return refusedOutcome('delivery-failed', error instanceof Error ? error.message : String(error));
		}
		// The hand-off ran the renderer's own code, so the ledger read before it
		// may already be history. Re-reading it here is what keeps a revoked owner
		// from proceeding: recording this port as live would leave it held by a
		// renderer nothing can revoke any more, open for the life of the process.
		const drift = this.#driftedDuringHandover(admitted);
		if (drift) {
			this.#retire(admitted);
			this.#closeOffered(port, handshake.generation, drift.refusal);
			return drift;
		}
		// The port is the renderer's from here. Superseding after the handover,
		// not at authorization, is what keeps the running stream audible until
		// its replacement is genuinely in the worklet's hands.
		this.#closeGeneration(this.#live, 'superseded');
		admitted.port = port;
		this.#live = admitted;
		this.#pending = null;
		return Object.freeze({ status: 'delivered' as const, generation: admitted.generation });
	}

	/**
	 * The renderer went away: its stream ends and the surface is free again. The
	 * outstanding authorization is deliberately left on the ledger rather than
	 * erased, so a port the helper was already preparing arrives to a refusal
	 * that names the departed owner instead of a generic stale generation.
	 */
	revokeOwner(owner: NativeRealtimeOwnerTarget): void {
		if (this.#owner !== owner) return;
		this.#owner = null;
		this.#closeGeneration(this.#live, 'owner-revoked');
		this.#live = null;
	}

	/**
	 * Main supervises the helper, so it learns of a crash the renderer's port may
	 * only notice later. The owner keeps the surface: a helper that is restarted
	 * authorizes a fresh generation rather than resurrecting a heard one.
	 */
	notifyHelperExit(): void {
		this.#pending = null;
		this.#closeGeneration(this.#live, 'helper-exit');
		this.#live = null;
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#owner = null;
		this.#pending = null;
		this.#closeGeneration(this.#live, 'disposed');
		this.#live = null;
	}

	#available(): boolean {
		return !this.#disposed && this.#isEnabled();
	}

	/** The authorization this offer satisfies, or the reason it satisfies none. */
	#admit(handshake: NativeRealtimeHandshake): Admission {
		const generation = handshake.generation;
		if (this.#live?.generation === generation) {
			return refusedAdmission('generation-occupied', `Generation ${generation} already holds a live port.`);
		}
		const pending = this.#pending;
		if (pending?.generation !== generation) {
			return generation > this.#issued
				? refusedAdmission('unknown-generation', `Generation ${generation} was never authorized.`)
				: refusedAdmission('stale-generation', `Generation ${generation} was retired before its port arrived.`);
		}
		if (pending.owner !== this.#owner) {
			return refusedAdmission('foreign-owner', `Generation ${generation} no longer belongs to the owning renderer.`);
		}
		const mismatch = describeNativeRealtimeFormatMismatch(pending.format, handshake);
		return mismatch === null
			? Object.freeze({ admitted: pending, refused: null })
			: refusedAdmission('format-mismatch', `The helper declared a stream that was not authorized: ${mismatch}.`);
	}

	/**
	 * Names what moved under an admitted offer while the hand-off was running, or
	 * null if the ledger still says what it said when the offer was admitted.
	 */
	#driftedDuringHandover(admitted: BrokeredGeneration): RefusedOutcome | null {
		const generation = admitted.generation;
		if (!this.#available()) {
			return refusedOutcome('surface-disabled', `The native real-time surface closed while generation ${generation} was handed over.`);
		}
		if (this.#owner !== admitted.owner) {
			return refusedOutcome('foreign-owner', `Generation ${generation} lost its owning renderer during the hand-over.`);
		}
		if (this.#pending !== admitted) {
			return refusedOutcome('stale-generation', `Generation ${generation} was retired during the hand-over.`);
		}
		return null;
	}

	/** Clears an authorization only if it is still the one this offer answered. */
	#retire(admitted: BrokeredGeneration): void {
		if (this.#pending === admitted) this.#pending = null;
	}

	#closeGeneration(record: BrokeredGeneration | null, reason: NativeRealtimeBrokerCloseReason): void {
		if (!record) return;
		const port = record.port;
		record.port = null;
		if (port) this.#close(port, record.generation, reason, null);
	}

	#closeOffered(port: unknown, generation: number | null, refusal: NativeRealtimeBrokerRefusal): void {
		this.#close(port, generation, 'refused', refusal);
	}

	#close(
		port: unknown,
		generation: number | null,
		reason: NativeRealtimeBrokerCloseReason,
		refusal: NativeRealtimeBrokerRefusal | null,
	): void {
		// A transfer list entry that is not a port never held a stream: it cannot
		// be closed, and reporting a close for it would invent a generation that
		// ended. Guarding here also keeps the catch below about a real port whose
		// close throws, rather than about a type error this process caused.
		if (!isNativeRealtimeTransferredPort(port) || this.#closedPorts.has(port)) return;
		this.#closedPorts.add(port);
		try {
			this.#closePort(port);
		} catch {
			/* A port entangled with a dead helper is closed enough. */
		}
		this.#onClose?.(Object.freeze({ generation, reason, refusal }));
	}
}

function refusedAuthorization(refusal: NativeRealtimeBrokerRefusal, message: string): NativeRealtimeAuthorization {
	return Object.freeze({ status: 'refused' as const, refusal, message });
}

function refusedOutcome(refusal: NativeRealtimeBrokerRefusal, message: string): RefusedOutcome {
	return Object.freeze({ status: 'refused' as const, refusal, message });
}

function refusedAdmission(refusal: NativeRealtimeBrokerRefusal, message: string): Admission {
	return Object.freeze({ admitted: null, refused: refusedOutcome(refusal, message) });
}
