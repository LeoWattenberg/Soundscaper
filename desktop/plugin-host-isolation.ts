/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Which host process owns which plug-in instance.
 *
 * Isolation is one host process per (renderer owner, plug-in binary digest).
 * Instances of that exact digest, opened by that exact owner, share one host —
 * loading the same limiter twelve times must not cost twelve processes — but two
 * different binaries never share, and two different renderer owners never share,
 * because a crash or a hostile binary must not reach past the pair that asked.
 *
 * Nothing here publishes authority: main owns process creation, the binary path
 * and revocation, and this registry hands out opaque ids and bounded status —
 * never a path, and never a main-side error message that contains one. It has no
 * restart path of its own, so a revoked digest stays dead until an explicit
 * restore rather than being revived by the next request.
 *
 * A lost host degrades, never corrupts. Canonical parameters and opaque state
 * live outside this module, the durable quarantine is consulted rather than
 * mirrored, and the continuity answer is either bypass or a freeze the project
 * already authored. This module cannot manufacture a freeze: it renders nothing.
 */

import { HELPER_PLUGIN_FORMATS, type HelperPluginFormat } from './helper-job-grant.ts';
import { HelperContractViolationError } from './helper-wire-admission.ts';
import {
	PLUGIN_HOST_BENIGN_STOP_REASONS,
	assertPluginInstanceId,
	choosePluginInstanceContinuity,
	type PluginContinuityDecision,
	type PluginContinuityRequest,
	type PluginHostStopReason,
	type PluginInstanceState,
} from './plugin-instance-state.ts';

export { PLUGIN_HOST_BENIGN_STOP_REASONS, PLUGIN_HOST_FAULT_REASONS, type PluginHostBenignStopReason,
	type PluginHostFaultReason, type PluginHostStopReason } from './plugin-instance-state.ts';
import { PLUGIN_HOST_FAULT_LIMIT, PLUGIN_HOST_FAULT_WINDOW_MS } from './plugin-quarantine.ts';

/**
 * The only vendor-UI surface 5A models. An embedded native child window is not
 * a fallback design, so there is no second member for one to be selected from.
 */
export const PLUGIN_VENDOR_UI_SURFACES = Object.freeze(['helper-owned-top-level'] as const);

/** What a vendor UI window is never handed, stated so a test can assert it. */
export const PLUGIN_VENDOR_UI_DENIED_CAPABILITIES = Object.freeze([
	'renderer-bridge', 'dom', 'node', 'file-system', 'network', 'child-process', 'embedded-child-window',
] as const);

export type PluginVendorUiSurface = (typeof PLUGIN_VENDOR_UI_SURFACES)[number];

export type PluginHostRefusalCode =
	| 'hosting-disabled' | 'disposed' | 'invalid-identity' | 'digest-revoked' | 'digest-quarantined'
	| 'state-ineligible' | 'instance-conflict' | 'instance-not-hosted' | 'unknown-instance'
	| 'owner-changed' | 'host-start-failed' | 'vendor-ui-unavailable';

export interface PluginHostLaunch {
	readonly hostId: string; readonly ownerId: string;
	readonly binarySha256: string; readonly format: HelperPluginFormat;
}

/**
 * The main-owned process handle. Vendor windows are opened and closed by the
 * helper that owns them; the registry only names the window and says when.
 */
export interface PluginHostProcess {
	readonly kill: () => void;
	readonly openVendorUi: (request: Readonly<{ instanceId: string; windowHandleId: string }>) => void;
	readonly closeVendorUi: (windowHandleId: string) => void;
}

export interface PluginHostIsolationOptions {
	readonly startHost: (launch: PluginHostLaunch) => Promise<PluginHostProcess>;
	/** Mints the opaque ids a renderer is allowed to see. Main-owned. */
	readonly mintId: () => string;
	readonly now?: () => number;
	/** Off by default: hosting runs only once a user turned the surface on. */
	readonly isEnabled?: () => boolean;
	/** An instance whose last opaque state was oversize may not be hosted. */
	readonly isStateEligible?: (instanceId: string) => boolean;
	/** The durable quarantine, consulted rather than mirrored by this registry. */
	readonly isDigestQuarantined?: (binarySha256: string) => boolean;
}

export interface PluginInstanceRequest {
	/** The renderer owner object; main maps it to an opaque owner id. */
	readonly owner: object;
	readonly binarySha256: string;
	readonly format: HelperPluginFormat;
	/** Present when the project restores an instance it already owns. */
	readonly instanceId?: string;
}

export interface PluginInstanceRecord {
	readonly instanceId: string; readonly ownerId: string; readonly ownerGeneration: number;
	readonly hostId: string | null; readonly binarySha256: string;
	readonly format: HelperPluginFormat; readonly state: PluginInstanceState;
}

/** One refusal shape for every gate, so no caller learns two vocabularies. */
export type PluginHostRefusal = Readonly<{
	status: 'refused'; code: PluginHostRefusalCode; message: string;
}>;

export type PluginInstanceAcquisition =
	| Readonly<{ status: 'hosted'; instance: PluginInstanceRecord }>
	| PluginHostRefusal;

export interface PluginVendorUiWindow {
	readonly windowHandleId: string; readonly instanceId: string; readonly hostId: string;
	readonly ownerGeneration: number; readonly surface: PluginVendorUiSurface;
}

export type PluginVendorUiOutcome =
	| Readonly<{ status: 'opened'; window: PluginVendorUiWindow }>
	| PluginHostRefusal;

export interface PluginHostStopOutcome {
	readonly hostId: string; readonly reason: PluginHostStopReason;
	readonly qualifyingFault: boolean; readonly quarantined: boolean;
	readonly instanceIds: readonly string[];
}

export interface PluginDigestSnapshot {
	readonly binarySha256: string; readonly revoked: boolean; readonly quarantined: boolean;
	readonly recentFaults: number; readonly hostCount: number;
}

export interface PluginHostIsolationSnapshot {
	readonly enabled: boolean; readonly disposed: boolean; readonly hostCount: number;
	readonly instanceCount: number; readonly vendorWindowCount: number;
}

interface OwnerEntry { readonly ownerId: string; generation: number }

interface HostEntry {
	readonly hostId: string; readonly hostKey: string; readonly ownerId: string;
	readonly ownerGeneration: number; readonly binarySha256: string;
	readonly format: HelperPluginFormat; readonly instanceIds: Set<string>;
	/** Null until the process is up: the entry exists before the process does. */
	process: PluginHostProcess | null;
	stopped: boolean;
}

interface StartingHost { readonly entry: HostEntry; readonly promise: Promise<HostEntry> }

interface InstanceEntry {
	readonly instanceId: string; readonly ownerId: string;
	readonly binarySha256: string; readonly format: HelperPluginFormat;
	ownerGeneration: number; hostId: string | null; state: PluginInstanceState;
}

const SHA256 = /^[a-f0-9]{64}$/u;

const WITHHOLD_MESSAGES = Object.freeze({
	'digest-revoked': 'That plug-in binary was revoked and will not be hosted again.',
	'digest-quarantined': 'That plug-in binary is quarantined after repeated host faults.',
});

/** The isolation unit, spelled once so no caller can invent a looser one. */
export function pluginHostIsolationKey(ownerId: string, binarySha256: string): string {
	return `${ownerId}:${binarySha256}`;
}

export class PluginHostIsolationRegistry {
	readonly #startHost: (launch: PluginHostLaunch) => Promise<PluginHostProcess>;
	readonly #mintId: () => string;
	readonly #isEnabled: () => boolean;
	readonly #isStateEligible: (instanceId: string) => boolean;
	readonly #isDigestQuarantined: (binarySha256: string) => boolean;
	readonly #now: () => number;
	readonly #owners = new WeakMap<object, OwnerEntry>();
	readonly #hosts = new Map<string, HostEntry>();
	readonly #hostsById = new Map<string, HostEntry>();
	readonly #starting = new Map<string, StartingHost>();
	readonly #instances = new Map<string, InstanceEntry>();
	readonly #vendorWindows = new Map<string, PluginVendorUiWindow>();
	readonly #revoked = new Set<string>();
	readonly #quarantined = new Set<string>();
	readonly #faults = new Map<string, number[]>();
	#disposed = false;

	constructor(options: PluginHostIsolationOptions) {
		this.#startHost = options.startHost;
		this.#mintId = options.mintId;
		// Off by default. A build that forgets to wire the preference gets the
		// disabled surface rather than an enabled one.
		this.#isEnabled = options.isEnabled ?? (() => false);
		this.#isStateEligible = options.isStateEligible ?? (() => true);
		this.#isDigestQuarantined = options.isDigestQuarantined ?? (() => false);
		this.#now = options.now ?? (() => Date.now());
	}

	snapshot(): PluginHostIsolationSnapshot {
		return Object.freeze({
			enabled: !this.#disposed && this.#isEnabled(), disposed: this.#disposed, hostCount: this.#hosts.size,
			instanceCount: this.#instances.size, vendorWindowCount: this.#vendorWindows.size,
		});
	}

	async acquireInstance(request: PluginInstanceRequest): Promise<PluginInstanceAcquisition> {
		if (this.#disposed) return refused('disposed', 'Plug-in hosting is shut down.');
		if (!this.#isEnabled()) return refused('hosting-disabled', 'Plug-in hosting is disabled.');
		let digest: string;
		let format: HelperPluginFormat;
		let requestedId: string | null;
		try {
			digest = assertBinaryDigest(request.binarySha256);
			format = assertPluginFormat(request.format);
			requestedId = request.instanceId === undefined ? null : assertPluginInstanceId(request.instanceId);
		} catch (error) {
			return refused('invalid-identity', describeError(error));
		}
		const withheld = this.#withholdCode(digest);
		if (withheld) return refused(withheld, WITHHOLD_MESSAGES[withheld]);
		if (requestedId !== null && !this.#isStateEligible(requestedId)) {
			return refused('state-ineligible',
				'That plug-in instance is ineligible until its opaque state fits the per-instance ceiling.');
		}
		const owner = this.#ownerEntry(request.owner);
		const claimed = requestedId === null ? undefined : this.#instances.get(requestedId);
		if (claimed && (claimed.ownerId !== owner.ownerId || claimed.binarySha256 !== digest)) {
			return refused('instance-conflict', 'That instance id already belongs to another owner or binary.');
		}
		const generation = owner.generation;
		let host: HostEntry;
		try {
			host = await this.#ensureHost(pluginHostIsolationKey(owner.ownerId, digest), owner, generation, digest, format);
		} catch (_error) {
			// The cause is main's to log. Its message names the binary path main
			// resolved, and no renderer-facing refusal may carry a raw path.
			return refused('host-start-failed', 'The plug-in host process could not be started.');
		}
		// Re-checked after the await: a revocation, quarantine, owner loss or shutdown
		// that landed while the process was starting must not be handed a live host.
		const stale = this.#staleAfterStart(host, digest, owner, generation);
		if (stale) {
			// Whatever withdrew this host withdrew it for every request sharing
			// it, so it comes down rather than staying up for a luckier one.
			this.#stopHost(host, null);
			return refused(stale, 'The plug-in host was withdrawn while it was starting.');
		}
		return Object.freeze({ status: 'hosted' as const, instance: this.#attach(host, requestedId) });
	}

	describeInstance(instanceId: string): PluginInstanceRecord | null {
		const entry = this.#instances.get(instanceId);
		return entry ? instanceRecord(entry) : null;
	}

	describeDigest(binarySha256: string): PluginDigestSnapshot {
		let hostCount = 0;
		for (const host of this.#hosts.values()) if (host.binarySha256 === binarySha256) hostCount += 1;
		return Object.freeze({
			binarySha256, revoked: this.#revoked.has(binarySha256), hostCount,
			quarantined: this.#isQuarantined(binarySha256), recentFaults: this.#recentFaults(binarySha256).length,
		});
	}

	/**
	 * Kills every host for this digest and keeps it dead. There is no restart path
	 * here and `acquireInstance` refuses the digest from now on, so no later request
	 * can undo the revocation by accident.
	 */
	revokeDigest(binarySha256: string): readonly string[] {
		const digest = assertBinaryDigest(binarySha256);
		this.#revoked.add(digest);
		const affected = this.#stopHostsWhere((host) => host.binarySha256 === digest, 'revoked');
		for (const entry of this.#instances.values()) if (entry.binarySha256 === digest) entry.state = 'revoked';
		return Object.freeze(affected);
	}

	/**
	 * The one way back: an explicit user re-enable of that exact digest. Both holds
	 * are released, because a digest that was quarantined and then revoked would
	 * otherwise report a successful restore and stay dead.
	 */
	restoreDigest(binarySha256: string): boolean {
		const digest = assertBinaryDigest(binarySha256);
		const wasRevoked = this.#revoked.delete(digest);
		const wasQuarantined = this.#quarantined.delete(digest);
		this.#faults.delete(digest);
		return wasRevoked || wasQuarantined;
	}

	/**
	 * The renderer that owned these instances is gone. Its hosts — including any
	 * still starting — and its vendor windows close immediately and its owner
	 * generation advances, so nothing in flight joins the next generation.
	 */
	revokeOwner(owner: object): readonly string[] {
		const entry = this.#owners.get(owner);
		if (!entry) return Object.freeze([]);
		entry.generation += 1;
		const affected = this.#stopHostsWhere((host) => host.ownerId === entry.ownerId, null);
		// Everything the owner owned, not only what a live host still held: an
		// instance whose host already faulted is attached to nothing, and one that
		// outlives its owner refuses its own id to every later session.
		for (const [instanceId, instance] of [...this.#instances]) {
			if (instance.ownerId !== entry.ownerId) continue;
			this.#instances.delete(instanceId);
			if (!affected.includes(instanceId)) affected.push(instanceId);
		}
		return Object.freeze(affected);
	}

	/**
	 * One host process stopped. A qualifying fault is charged to its digest and
	 * quarantines it on the second within the window; only a benign stop — user
	 * cancellation, device loss, shutdown — is charged to nothing.
	 */
	reportHostStopped(report: Readonly<{ hostId: string; reason: PluginHostStopReason }>): PluginHostStopOutcome {
		const host = this.#hostsById.get(report.hostId);
		// Fail closed: only a reason spelled in the benign list is not a fault, so
		// an unrecognised one cannot launder a crash into an ordinary stop.
		const qualifying = !(PLUGIN_HOST_BENIGN_STOP_REASONS as readonly string[]).includes(report.reason);
		// An unknown host must not be able to poison a digest's fault ledger.
		if (!host) return stopOutcome(report.hostId, report.reason, false, false, []);
		const digest = host.binarySha256;
		const instanceIds = this.#stopHost(host, qualifying ? 'faulted' : 'stopped');
		if (!qualifying) return stopOutcome(host.hostId, report.reason, false, false, instanceIds);
		const faults = [...this.#recentFaults(digest), this.#now()];
		this.#faults.set(digest, faults);
		const quarantined = faults.length >= PLUGIN_HOST_FAULT_LIMIT;
		if (quarantined) {
			this.#quarantined.add(digest);
			// A quarantined digest is quarantined everywhere, not only for the
			// owner that happened to be holding the process when it died.
			for (const id of this.#stopHostsWhere((other) => other.binarySha256 === digest, 'faulted')) {
				if (!instanceIds.includes(id)) instanceIds.push(id);
			}
		}
		return stopOutcome(host.hostId, report.reason, true, quarantined, instanceIds);
	}

	/** The registered instance's own lifecycle, answered by the state model. */
	continuityFor(request: Omit<PluginContinuityRequest, 'state'>): PluginContinuityDecision {
		const entry = this.#instances.get(request.instanceId);
		if (!entry) throw new RangeError('No such plug-in instance is registered.');
		return choosePluginInstanceContinuity({ ...request, state: entry.state });
	}

	openVendorUi(instanceId: string): PluginVendorUiOutcome {
		if (this.#disposed) return refused('disposed', 'Plug-in hosting is shut down.');
		if (!this.#isEnabled()) return refused('hosting-disabled', 'Plug-in hosting is disabled.');
		const entry = this.#instances.get(instanceId);
		if (!entry) return refused('unknown-instance', 'No such plug-in instance is registered.');
		const host = entry.hostId === null ? undefined : this.#hostsById.get(entry.hostId);
		const process = host?.process;
		if (entry.state !== 'hosted' || !host || !process) {
			return refused('instance-not-hosted', 'That plug-in instance has no live host to own a window.');
		}
		// One instance owns one window. Asking twice hands back the handle that
		// is already open, or a renderer could mint native windows without end.
		const already = this.#windowFor(entry.instanceId);
		if (already) return Object.freeze({ status: 'opened' as const, window: already });
		const opened: PluginVendorUiWindow = Object.freeze({
			windowHandleId: this.#mintId(), instanceId: entry.instanceId, hostId: host.hostId,
			ownerGeneration: entry.ownerGeneration, surface: PLUGIN_VENDOR_UI_SURFACES[0],
		});
		try {
			// Two opaque ids and nothing else: the helper owns the window, and
			// the registry hands it no bridge, no path and no handle to one.
			process.openVendorUi(Object.freeze({ instanceId: entry.instanceId, windowHandleId: opened.windowHandleId }));
		} catch (_error) {
			// A window the helper never opened must not be published as open,
			// and the helper's own message is not renderer-facing text.
			return refused('vendor-ui-unavailable', 'The plug-in host could not open its vendor window.');
		}
		this.#vendorWindows.set(opened.windowHandleId, opened);
		return Object.freeze({ status: 'opened' as const, window: opened });
	}

	vendorUiWindows(): readonly PluginVendorUiWindow[] {
		return Object.freeze([...this.#vendorWindows.values()]);
	}

	/** Closing the window closes the window. The effect keeps running. */
	closeVendorUi(windowHandleId: string): boolean {
		const open = this.#vendorWindows.get(windowHandleId);
		if (!open) return false;
		this.#vendorWindows.delete(windowHandleId);
		const process = this.#hostsById.get(open.hostId)?.process;
		if (process) safely(() => process.closeVendorUi(windowHandleId));
		return true;
	}

	/**
	 * The project closed this instance. Its window goes, its host loses it, and a
	 * host with nothing left to serve is a process nobody owns, so it stops. The
	 * retained opaque state belongs to the state store, not here.
	 */
	releaseInstance(instanceId: string): boolean {
		const entry = this.#instances.get(instanceId);
		if (!entry) return false;
		this.#instances.delete(instanceId);
		const host = entry.hostId === null ? undefined : this.#hostsById.get(entry.hostId);
		if (!host) return true;
		this.#closeWindows(host, (open) => open.instanceId === instanceId);
		host.instanceIds.delete(instanceId);
		if (host.instanceIds.size === 0) this.#stopHost(host, null);
		return true;
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#stopHostsWhere(() => true, 'stopped');
		this.#instances.clear();
		this.#starting.clear();
	}

	#withholdCode(digest: string): keyof typeof WITHHOLD_MESSAGES | null {
		if (this.#revoked.has(digest)) return 'digest-revoked';
		return this.#isQuarantined(digest) ? 'digest-quarantined' : null;
	}

	/** Either ledger holding the digest withholds it, so they cannot disagree. */
	#isQuarantined(digest: string): boolean {
		return this.#quarantined.has(digest) || this.#isDigestQuarantined(digest);
	}

	#ownerEntry(owner: object): OwnerEntry {
		const existing = this.#owners.get(owner);
		if (existing) return existing;
		const entry: OwnerEntry = { ownerId: this.#mintId(), generation: 1 };
		this.#owners.set(owner, entry);
		return entry;
	}

	#ensureHost(
		hostKey: string, owner: OwnerEntry, ownerGeneration: number,
		binarySha256: string, format: HelperPluginFormat,
	): Promise<HostEntry> {
		// Concurrent requests for one isolation unit share the one start, or
		// the second request would spawn a second process for the same pair.
		const pending = this.#starting.get(hostKey);
		if (pending) return pending.promise;
		const existing = this.#hosts.get(hostKey);
		if (existing) return Promise.resolve(existing);
		const hostId = this.#mintId();
		const entry: HostEntry = {
			hostId, hostKey, ownerId: owner.ownerId, ownerGeneration, binarySha256, format,
			process: null, instanceIds: new Set<string>(), stopped: false,
		};
		// Registered before the first await, never after it. A revocation, an owner
		// loss or a shutdown landing while the process starts has to find this host
		// and stop it; a host that appears only once its process is up outlives the
		// authority that asked for it, and the next request attaches to it anyway.
		this.#hosts.set(hostKey, entry);
		this.#hostsById.set(hostId, entry);
		const started = (async (): Promise<HostEntry> => {
			const launch = Object.freeze({ hostId, ownerId: owner.ownerId, binarySha256, format });
			let process: PluginHostProcess;
			try {
				process = await this.#startHost(launch);
			} catch (error) {
				this.#stopHost(entry, null);
				throw error;
			}
			entry.process = process;
			// Stopped while starting: the kill had no process to reach, so it
			// lands here the moment there is one.
			if (entry.stopped) safely(() => process.kill());
			return entry;
		})();
		this.#starting.set(hostKey, { entry, promise: started });
		return started.finally(() => {
			if (this.#starting.get(hostKey)?.promise === started) this.#starting.delete(hostKey);
		});
	}

	#staleAfterStart(host: HostEntry, digest: string, owner: OwnerEntry, generation: number)
		: PluginHostRefusalCode | null {
		if (this.#disposed) return 'disposed';
		const withheld = this.#withholdCode(digest);
		if (withheld) return withheld;
		// Both ends of the generation are checked: the owner must still be the one
		// that asked, and the host must be the one started for that same owner.
		if (owner.generation !== generation || host.ownerGeneration !== generation) return 'owner-changed';
		return host.stopped ? 'host-start-failed' : null;
	}

	#attach(host: HostEntry, requestedId: string | null): PluginInstanceRecord {
		const instanceId = requestedId ?? this.#mintId();
		const entry: InstanceEntry = this.#instances.get(instanceId) ?? {
			instanceId, ownerId: host.ownerId, binarySha256: host.binarySha256, format: host.format,
			ownerGeneration: host.ownerGeneration, hostId: host.hostId, state: 'hosted',
		};
		entry.ownerGeneration = host.ownerGeneration;
		entry.hostId = host.hostId;
		entry.state = 'hosted';
		this.#instances.set(instanceId, entry);
		host.instanceIds.add(instanceId);
		return instanceRecord(entry);
	}

	#stopHostsWhere(matches: (host: HostEntry) => boolean, instanceState: PluginInstanceState | null): string[] {
		const affected: string[] = [];
		for (const host of [...this.#hosts.values()]) {
			if (!matches(host)) continue;
			for (const id of this.#stopHost(host, instanceState)) if (!affected.includes(id)) affected.push(id);
		}
		return affected;
	}

	#stopHost(host: HostEntry, instanceState: PluginInstanceState | null): string[] {
		const instanceIds = [...host.instanceIds];
		if (host.stopped) return instanceIds;
		host.stopped = true;
		if (this.#hosts.get(host.hostKey) === host) this.#hosts.delete(host.hostKey);
		// A start whose host is gone is not a start the next request may join.
		if (this.#starting.get(host.hostKey)?.entry === host) this.#starting.delete(host.hostKey);
		// Helper loss closes the vendor window immediately; a window outliving
		// its host would be a native window that nothing owns.
		this.#closeWindows(host, () => true);
		this.#hostsById.delete(host.hostId);
		host.instanceIds.clear();
		for (const instanceId of instanceIds) {
			const entry = this.#instances.get(instanceId);
			if (!entry) continue;
			entry.hostId = null;
			if (instanceState) entry.state = instanceState;
		}
		// A process that has not arrived yet is killed on arrival instead.
		const process = host.process;
		if (process) safely(() => process.kill());
		return instanceIds;
	}

	#closeWindows(host: HostEntry, matches: (open: PluginVendorUiWindow) => boolean): void {
		const process = host.process;
		for (const open of [...this.#vendorWindows.values()]) {
			if (open.hostId !== host.hostId || !matches(open)) continue;
			this.#vendorWindows.delete(open.windowHandleId);
			if (process) safely(() => process.closeVendorUi(open.windowHandleId));
		}
	}

	#windowFor(instanceId: string): PluginVendorUiWindow | null {
		for (const open of this.#vendorWindows.values()) if (open.instanceId === instanceId) return open;
		return null;
	}

	/** The durable store's window, applied here so the two never disagree. */
	#recentFaults(digest: string): number[] {
		const cutoff = this.#now() - PLUGIN_HOST_FAULT_WINDOW_MS;
		return (this.#faults.get(digest) ?? []).filter((timestamp) => timestamp > cutoff);
	}
}

/** Field by field: no internal bookkeeping reaches a renderer by accident. */
function instanceRecord(entry: InstanceEntry): PluginInstanceRecord {
	return Object.freeze({
		instanceId: entry.instanceId, ownerId: entry.ownerId, ownerGeneration: entry.ownerGeneration,
		hostId: entry.hostId, binarySha256: entry.binarySha256, format: entry.format, state: entry.state,
	});
}

function stopOutcome(
	hostId: string, reason: PluginHostStopReason, qualifyingFault: boolean,
	quarantined: boolean, instanceIds: readonly string[],
): PluginHostStopOutcome {
	return Object.freeze({
		hostId, reason, qualifyingFault, quarantined, instanceIds: Object.freeze([...instanceIds]),
	});
}

function refused(code: PluginHostRefusalCode, message: string): PluginHostRefusal {
	return Object.freeze({ status: 'refused' as const, code, message });
}

function assertBinaryDigest(value: unknown): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new HelperContractViolationError('unsafe-grant',
			'A plug-in host request must name its binary by lowercase SHA-256 digest.');
	}
	return value;
}

function assertPluginFormat(value: unknown): HelperPluginFormat {
	if (typeof value !== 'string' || !(HELPER_PLUGIN_FORMATS as readonly string[]).includes(value)) {
		throw new HelperContractViolationError('unsafe-grant', 'A plug-in host request must name a supported format.');
	}
	return value as HelperPluginFormat;
}

function safely(operation: () => void): void {
	// A host that is already gone cannot fail harder for being told again: the
	// teardown was the point, and there is no reply left to act on.
	try {
		operation();
	} catch (_error) { /* deliberately not surfaced */ }
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
