/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The durable, digest-keyed plug-in quarantine.
 *
 * Quarantine is keyed by binary digest rather than by identity or path,
 * because the bytes are what misbehaved: moving, renaming, or re-declaring a
 * plug-in must not launder a crash. It is durable for the same reason a crash
 * matters at all — a scanner that takes the editor down and comes back to scan
 * the same binary again is a loop, not a retry — so every state change is
 * written through an injected filesystem seam before it is reported.
 *
 * Scanner faults quarantine immediately: nothing is loaded for playback during
 * a scan, so there is no cost to being decisive. Host faults are accrued
 * instead, because a single host fault may be a one-off, and two within ten
 * minutes is the point at which continuing to restart the binary is the worse
 * failure. Only the faults are counted: a user cancelling, a device
 * disappearing, and the editor shutting down are ordinary events and are
 * recorded nowhere.
 *
 * The only way out is explicit: a rescan or a re-enable of that exact digest.
 * A fault ageing out of the window never clears an existing quarantine.
 */

export const PLUGIN_QUARANTINE_SCHEMA_VERSION = 1;

/** Two qualifying host faults inside this window quarantine the digest. */
export const PLUGIN_HOST_FAULT_WINDOW_MS = 10 * 60_000;
export const PLUGIN_HOST_FAULT_LIMIT = 2;

export const MAXIMUM_QUARANTINED_DIGESTS = 4_096;
export const MAXIMUM_QUARANTINE_FILE_BYTES = 4 * 1024 * 1024;
/** Retained per digest; the window prunes long before this matters. */
const MAXIMUM_RETAINED_FAULTS = 8;

export const PLUGIN_FAULT_SCOPES = Object.freeze(['scanner', 'host'] as const);
export type PluginFaultScope = (typeof PLUGIN_FAULT_SCOPES)[number];

export const PLUGIN_FAULT_KINDS = Object.freeze([
	'crash', 'hang', 'malformed-answer', 'oversized-answer', 'identity-change',
] as const);
export type PluginFaultKind = (typeof PLUGIN_FAULT_KINDS)[number];

/** Named so a caller reports them rather than silently filtering them out. */
export const PLUGIN_NON_FAULT_KINDS = Object.freeze([
	'user-cancelled', 'device-lost', 'editor-shutdown',
] as const);
export type PluginNonFaultKind = (typeof PLUGIN_NON_FAULT_KINDS)[number];

export type PluginFaultEventKind = PluginFaultKind | PluginNonFaultKind;

export type PluginQuarantineClearance = 'rescan' | 're-enable';

export interface PluginFaultEvent {
	readonly digest: string;
	readonly scope: PluginFaultScope;
	readonly kind: PluginFaultEventKind;
}

export interface PluginQuarantineRecord {
	readonly digest: string;
	readonly scope: PluginFaultScope;
	readonly kind: PluginFaultKind;
	readonly quarantinedAt: number;
}

export type PluginFaultOutcome =
	| Readonly<{ status: 'ignored'; reason: 'not-a-fault' }>
	| Readonly<{ status: 'accrued'; faults: number }>
	| Readonly<{
		status: 'quarantined';
		record: PluginQuarantineRecord;
		alreadyQuarantined: boolean;
		/** The digest the ceiling made room by releasing, named rather than dropped in silence. */
		evicted: string | null;
	}>;

export type PluginQuarantineLoadStatus = 'empty' | 'loaded' | 'reset';

export interface PluginQuarantineLoad {
	readonly status: PluginQuarantineLoadStatus;
	readonly digests: number;
	readonly dropped: number;
	readonly detail: string;
}

export interface PluginQuarantineSnapshot {
	readonly loaded: boolean;
	/** True when the persisted file could not be trusted and was reset. */
	readonly degraded: boolean;
	readonly records: readonly PluginQuarantineRecord[];
	/** Digests with host faults still being counted; pruned as events arrive. */
	readonly pendingFaults: number;
}

/**
 * The persistence seam. Main wires an atomic writer (temporary file plus
 * rename); tests wire an in-memory pair and reuse it across instances to prove
 * the state survives a restart.
 */
export interface PluginQuarantineFileSystem {
	readFile(path: string): Promise<string>;
	writeFile(path: string, contents: string): Promise<void>;
}

export type PluginQuarantineErrorCode = 'not-loaded' | 'malformed-digest' | 'unknown-event';

export class PluginQuarantineError extends Error {
	readonly code: PluginQuarantineErrorCode;

	constructor(code: PluginQuarantineErrorCode, message: string) {
		super(message);
		this.name = 'PluginQuarantineError';
		this.code = code;
	}
}

export interface DesktopPluginQuarantineOptions {
	readonly filePath: string;
	readonly fileSystem: PluginQuarantineFileSystem;
	readonly now?: () => number;
}

const SHA256 = /^[a-f\d]{64}$/u;

export class DesktopPluginQuarantine {
	readonly #filePath: string;
	readonly #fileSystem: PluginQuarantineFileSystem;
	readonly #now: () => number;
	readonly #records = new Map<string, PluginQuarantineRecord>();
	readonly #faults = new Map<string, number[]>();
	#loaded = false;
	#degraded = false;
	#writes: Promise<unknown> = Promise.resolve();

	constructor(options: DesktopPluginQuarantineOptions) {
		this.#filePath = options.filePath;
		this.#fileSystem = options.fileSystem;
		this.#now = options.now ?? (() => Date.now());
	}

	/**
	 * Reads the durable state. A missing file is an ordinary empty start; an
	 * unreadable or malformed one is reported as a reset rather than thrown,
	 * because refusing to start is worse than starting degraded — but it is
	 * never reported as a normal load.
	 */
	async load(): Promise<PluginQuarantineLoad> {
		this.#records.clear();
		this.#faults.clear();
		this.#degraded = false;
		// A store part-way through its read is not loaded: answering from the
		// cleared map would report a quarantined digest as clean, and a fault
		// recorded meanwhile would persist over the file still being read.
		this.#loaded = false;
		const outcome = await this.#read();
		this.#loaded = true;
		return outcome;
	}

	async #read(): Promise<PluginQuarantineLoad> {
		let contents: string;
		try {
			contents = await this.#fileSystem.readFile(this.#filePath);
		} catch (error) {
			if (errorCode(error) === 'ENOENT') {
				return frozenLoad('empty', 0, 0, '');
			}
			this.#degraded = true;
			return frozenLoad('reset', 0, 0, `The plug-in quarantine could not be read: ${describeError(error)}`);
		}
		if (contents.length > MAXIMUM_QUARANTINE_FILE_BYTES) {
			this.#degraded = true;
			return frozenLoad('reset', 0, 0, 'The plug-in quarantine file exceeds its admitted size.');
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(contents);
		} catch (error) {
			this.#degraded = true;
			return frozenLoad('reset', 0, 0, `The plug-in quarantine file is not JSON: ${describeError(error)}`);
		}
		const document = plainRecord(parsed);
		if (!document || document.schemaVersion !== PLUGIN_QUARANTINE_SCHEMA_VERSION) {
			this.#degraded = true;
			return frozenLoad('reset', 0, 0, 'The plug-in quarantine file is not a supported schema version.');
		}
		const dropped = this.#restore(document);
		return frozenLoad('loaded', this.#records.size, dropped, '');
	}

	snapshot(): PluginQuarantineSnapshot {
		return Object.freeze({
			loaded: this.#loaded,
			degraded: this.#degraded,
			records: Object.freeze([...this.#records.values()]),
			pendingFaults: this.#faults.size,
		});
	}

	isQuarantined(digest: string): boolean {
		this.#assertLoaded();
		return this.#records.has(assertDigest(digest));
	}

	describe(digest: string): PluginQuarantineRecord | null {
		this.#assertLoaded();
		return this.#records.get(assertDigest(digest)) ?? null;
	}

	/**
	 * Records one event. Non-faults are ignored by name rather than by the
	 * caller's discretion, so a shutdown can never be mistaken for a crash.
	 */
	async record(event: PluginFaultEvent): Promise<PluginFaultOutcome> {
		this.#assertLoaded();
		this.#pruneFaults();
		const digest = assertDigest(event.digest);
		const scope = assertScope(event.scope);
		if ((PLUGIN_NON_FAULT_KINDS as readonly string[]).includes(event.kind)) {
			return Object.freeze({ status: 'ignored' as const, reason: 'not-a-fault' as const });
		}
		if (!(PLUGIN_FAULT_KINDS as readonly string[]).includes(event.kind)) {
			throw new PluginQuarantineError('unknown-event', 'That plug-in fault kind is not part of the closed set.');
		}
		const kind = event.kind as PluginFaultKind;
		const existing = this.#records.get(digest);
		if (existing) {
			return Object.freeze({
				status: 'quarantined' as const,
				record: existing,
				alreadyQuarantined: true,
				evicted: null,
			});
		}
		// An identity change means the bytes lied about what they are; that is
		// immediate whichever process noticed it.
		if (scope === 'scanner' || kind === 'identity-change') {
			return this.#quarantine(digest, scope, kind);
		}
		const faults = [...(this.#faults.get(digest) ?? []), this.#now()].slice(-MAXIMUM_RETAINED_FAULTS);
		this.#faults.set(digest, faults);
		if (faults.length >= PLUGIN_HOST_FAULT_LIMIT) return this.#quarantine(digest, scope, kind);
		await this.#persist();
		return Object.freeze({ status: 'accrued' as const, faults: faults.length });
	}

	/** The only exit: an explicit rescan or re-enable of that exact digest. */
	async clear(digest: string, clearance: PluginQuarantineClearance): Promise<boolean> {
		this.#assertLoaded();
		this.#pruneFaults();
		if (clearance !== 'rescan' && clearance !== 're-enable') {
			throw new PluginQuarantineError('unknown-event', 'A quarantine is cleared only by rescan or re-enable.');
		}
		const key = assertDigest(digest);
		const removed = this.#records.delete(key);
		// The accrued host faults go with it, or a re-enabled digest would be
		// one fault away from a quarantine the user thought they had cleared.
		const hadFaults = this.#faults.delete(key);
		if (removed || hadFaults) await this.#persist();
		return removed;
	}

	#restore(document: Record<string, unknown>): number {
		let dropped = 0;
		const now = this.#now();
		const records = Array.isArray(document.quarantined) ? document.quarantined : [];
		const admitted: PluginQuarantineRecord[] = [];
		for (const value of records) {
			const record = admitRecord(value);
			if (record) admitted.push(record);
			else dropped += 1;
		}
		// A file that carries more than the ceiling keeps its most recent
		// quarantines: whichever happened to be written first is an accident of
		// file order, and forgetting the digest that misbehaved most recently is
		// the worse of the two ways to come back under the bound.
		if (admitted.length > MAXIMUM_QUARANTINED_DIGESTS) {
			admitted.sort((left, right) => right.quarantinedAt - left.quarantinedAt);
			dropped += admitted.length - MAXIMUM_QUARANTINED_DIGESTS;
			admitted.length = MAXIMUM_QUARANTINED_DIGESTS;
		}
		for (const record of admitted) this.#records.set(record.digest, record);
		const faults = Array.isArray(document.faults) ? document.faults : [];
		for (const value of faults) {
			const entry = plainRecord(value);
			const digest = typeof entry?.digest === 'string' && SHA256.test(entry.digest) ? entry.digest : null;
			const at = Number.isSafeInteger(entry?.at) && (entry?.at as number) >= 0 ? entry?.at as number : null;
			if (digest === null || at === null) {
				dropped += 1;
				continue;
			}
			if (at <= now - PLUGIN_HOST_FAULT_WINDOW_MS) continue;
			this.#faults.set(digest, [...(this.#faults.get(digest) ?? []), at].slice(-MAXIMUM_RETAINED_FAULTS));
		}
		return dropped;
	}

	/**
	 * The window is half-open: a fault exactly `PLUGIN_HOST_FAULT_WINDOW_MS`
	 * old has aged out, matching the helper supervisor's crash window so the
	 * two surfaces never disagree about what "recent" means.
	 *
	 * Pruning here rather than only filtering on read is what keeps the fault
	 * table bounded by the window instead of by the number of digests that have
	 * ever faulted in this process.
	 */
	#pruneFaults(): void {
		const cutoff = this.#faultCutoff();
		for (const [digest, timestamps] of this.#faults) {
			const kept = timestamps.filter((timestamp) => timestamp > cutoff);
			if (kept.length === 0) this.#faults.delete(digest);
			else if (kept.length !== timestamps.length) this.#faults.set(digest, kept);
		}
	}

	#faultCutoff(): number {
		return this.#now() - PLUGIN_HOST_FAULT_WINDOW_MS;
	}

	async #quarantine(
		digest: string,
		scope: PluginFaultScope,
		kind: PluginFaultKind,
	): Promise<PluginFaultOutcome> {
		const evicted = this.#releaseForCapacity();
		const record = Object.freeze({ digest, scope, kind, quarantinedAt: this.#now() });
		this.#records.set(digest, record);
		this.#faults.delete(digest);
		await this.#persist();
		return Object.freeze({ status: 'quarantined' as const, record, alreadyQuarantined: false, evicted });
	}

	/**
	 * At the ceiling the oldest quarantine gives way, and the outcome names it.
	 * Both alternatives are worse: refusing to quarantine the digest that just
	 * misbehaved is fail-open, and letting the set grow unbounded walks the file
	 * past `MAXIMUM_QUARANTINE_FILE_BYTES`, where the next start rejects the
	 * whole file and loses every quarantine at once. A released digest is
	 * quarantined again by its next fault.
	 */
	#releaseForCapacity(): string | null {
		if (this.#records.size < MAXIMUM_QUARANTINED_DIGESTS) return null;
		let oldest: PluginQuarantineRecord | null = null;
		for (const record of this.#records.values()) {
			if (!oldest || record.quarantinedAt < oldest.quarantinedAt) oldest = record;
		}
		if (!oldest) return null;
		this.#records.delete(oldest.digest);
		return oldest.digest;
	}

	/**
	 * Serialized so two concurrent faults cannot interleave their writes. The
	 * chain carries the ordering and not the outcome: the caller that asked for
	 * this write is handed its own rejection, and it is dropped from the chain
	 * only so that one failed write does not fail every later one behind it.
	 */
	#persist(): Promise<void> {
		const next = this.#writes.then(
			() => this.#fileSystem.writeFile(this.#filePath, this.#serialize()),
			() => this.#fileSystem.writeFile(this.#filePath, this.#serialize()),
		);
		this.#writes = next.catch(() => undefined);
		return next;
	}

	#serialize(): string {
		const cutoff = this.#faultCutoff();
		const faults: { digest: string; at: number }[] = [];
		for (const [digest, timestamps] of this.#faults) {
			for (const at of timestamps) {
				if (at > cutoff) faults.push({ digest, at });
			}
		}
		return JSON.stringify({
			schemaVersion: PLUGIN_QUARANTINE_SCHEMA_VERSION,
			quarantined: [...this.#records.values()],
			faults,
		});
	}

	#assertLoaded(): void {
		if (!this.#loaded) {
			throw new PluginQuarantineError('not-loaded',
				'The durable plug-in quarantine must be loaded before it is consulted.');
		}
	}
}

function admitRecord(value: unknown): PluginQuarantineRecord | null {
	const record = plainRecord(value);
	if (!record
		|| typeof record.digest !== 'string' || !SHA256.test(record.digest)
		|| typeof record.scope !== 'string' || !(PLUGIN_FAULT_SCOPES as readonly string[]).includes(record.scope)
		|| typeof record.kind !== 'string' || !(PLUGIN_FAULT_KINDS as readonly string[]).includes(record.kind)
		|| !Number.isSafeInteger(record.quarantinedAt) || (record.quarantinedAt as number) < 0) {
		return null;
	}
	return Object.freeze({
		digest: record.digest,
		scope: record.scope as PluginFaultScope,
		kind: record.kind as PluginFaultKind,
		quarantinedAt: record.quarantinedAt as number,
	});
}

function assertDigest(value: unknown): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new PluginQuarantineError('malformed-digest',
			'A plug-in quarantine key must be a lowercase SHA-256 binary digest.');
	}
	return value;
}

function assertScope(value: unknown): PluginFaultScope {
	if (typeof value !== 'string' || !(PLUGIN_FAULT_SCOPES as readonly string[]).includes(value)) {
		throw new PluginQuarantineError('unknown-event', 'A plug-in fault must name the scanner or host scope.');
	}
	return value as PluginFaultScope;
}

function plainRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function frozenLoad(
	status: PluginQuarantineLoadStatus,
	digests: number,
	dropped: number,
	detail: string,
): PluginQuarantineLoad {
	return Object.freeze({ status, digests, dropped, detail });
}

function errorCode(error: unknown): string | undefined {
	return typeof error === 'object' && error !== null && 'code' in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
