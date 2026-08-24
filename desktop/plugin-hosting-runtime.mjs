/* SPDX-License-Identifier: AGPL-3.0-only */

/** The isolated plug-in hosting runtime: realtime sessions, faults, and durable quarantine. */

import { randomBytes } from 'node:crypto';

import { MessageChannelMain } from 'electron/main';

import { DesktopPluginHostService } from './project-library-runtime/desktop/plugin-host-service.js';
import { PluginHostIsolationRegistry } from './project-library-runtime/desktop/plugin-host-isolation.js';
import {
	createNativePluginOfflineRunner,
	openNativePersistentPluginSession,
} from './project-library-runtime/desktop/native-plugin-helper-adapter.js';
import { registerPluginVendorWindowHost } from './plugin-vendor-window-authority.mjs';

/** Host stop reasons translated into the durable store's closed fault kinds. */
const HOST_FAULT_KINDS = new Map([
	['crash', 'crash'],
	['hang', 'hang'],
	['malformed-answer', 'malformed-answer'],
	['resource-violation', 'crash'],
	['oversize-state', 'oversized-answer'],
	['identity-changed', 'identity-change'],
]);

/** One supervised helper role per renderer owner and binary digest. */
export function createDesktopPluginHostingRuntime({
	registry, quarantine, settings, stateBodies, isFormatActivated, createHostHelper,
	openPersistentPluginSession = openNativePersistentPluginSession,
}) {
	const hosts = new Map();
	const realtime = new Map();
	let isolation;
	const offline = createNativePluginOfflineRunner(({ instanceId }) => {
		const hostId = isolation.describeInstance(instanceId)?.hostId;
		const host = hostId === null || hostId === undefined ? null : hosts.get(hostId);
		if (!host) throw new Error('The isolated plug-in host is unavailable.');
		return host.supervisor;
	});
	// Deferred into a chain rather than awaited in the fault path: the report
	// that noticed the crash must not be replaced by a failure to record it.
	let quarantineWrites = Promise.resolve();
	isolation = new PluginHostIsolationRegistry({
		mintId: () => randomBytes(20).toString('hex'),
		isEnabled: () => settings.snapshot().nativePluginDiscoveryEnabled === true,
		isDigestQuarantined: (digest) => quarantine.isQuarantined(digest),
		onQualifyingFault: (digest, reason) => {
			const kind = HOST_FAULT_KINDS.get(reason) ?? 'crash';
			quarantineWrites = quarantineWrites
				.then(() => quarantine.record({ digest, scope: 'host', kind }))
				.catch(() => undefined);
		},
		startHost: async (launch) => {
			if (isFormatActivated(launch.format) !== true) {
				throw new Error('That plug-in format remains behind its production activation gate.');
			}
			const helper = createHostHelper(launch);
			const availability = await helper.describePayload();
			if (isFormatActivated(launch.format) !== true) {
				throw new Error('That plug-in format activation changed while its payload was verified.');
			}
			if (availability.status !== 'available') {
				throw new Error('The authenticated native plug-in host payload is unavailable.');
			}
			return registerPluginVendorWindowHost({ launch, helper, hosts, realtime });
		},
	});
	const service = new DesktopPluginHostService({
		registry,
		isolation,
		stateBodies,
		offline,
		isFormatActivated,
		onLatencyChanged: () => undefined,
	});
	const closeRealtime = async (instanceId) => {
		const entry = realtime.get(instanceId);
		if (!entry) return;
		realtime.delete(instanceId);
		await entry.session.close();
	};
	const openRealtime = async (owner, instanceId, destination, sampleRate) => {
		if (!Number.isSafeInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 768_000) {
			throw new RangeError('A native plug-in real-time host requires the AudioContext sample rate.');
		}
		const hosted = isolation.describeInstance(instanceId);
		const host = hosted?.hostId ? hosts.get(hosted.hostId) : null;
		if (!host) throw new Error('The isolated plug-in host is unavailable.');
		const descriptor = service.realtimeGrant(owner, instanceId);
		const session = await openPersistentPluginSession({
			supervisor: host.supervisor,
			grant: descriptor.grant,
			createChannel: () => new MessageChannelMain(),
			sampleRate,
			maximumFrames: 128,
		});
		if (isFormatActivated(descriptor.format) !== true) {
			await session.close();
			throw new Error('That plug-in format activation changed while its real-time processor opened.');
		}
		const entry = { owner, session };
		realtime.set(instanceId, entry);
		const settleStopped = (reason) => {
			if (realtime.get(instanceId) !== entry) return;
			realtime.delete(instanceId);
			try { service.reportInstanceHostStopped(owner, instanceId, reason); }
			catch { /* owner or policy was revoked concurrently */ }
		};
		// The supervisor rejects this promise when the host process dies, so the
		// rejection branch is the crash-containment path, not an error afterthought.
		void session.closed.then(
			(result) => settleStopped(stopReason(result)),
			(error) => settleStopped(supervisionStopReason(error)),
		);
		session.transferTo(destination, { instanceId });
	};
	const persistState = (owner, value) => {
		const instanceId = value?.instanceId;
		const entry = realtime.get(instanceId);
		if (!entry || entry.owner !== owner) throw new Error('The live native plug-in state RPC is unavailable.');
		const bytes = entry.session.authenticateState(value);
		return service.persistState(owner, { instanceId, generation: value?.generation, bytes });
	};
	const restoreState = (owner, value) => {
		const entry = realtime.get(value?.instanceId);
		if (!entry || entry.owner !== owner) throw new Error('The live native plug-in state RPC is unavailable.');
		return service.restoreStateForRuntime(owner, value);
	};
	const closeAll = () => Promise.all([...realtime.keys()].map(closeRealtime));
	const revokeOwner = (owner) => Promise.all([...realtime]
		.filter(([, entry]) => entry.owner === owner).map(([instanceId]) => closeRealtime(instanceId)));
	return Object.freeze({
		isolation, service, openRealtime, closeRealtime, closeAll, revokeOwner, persistState, restoreState,
		settleQuarantineWrites: () => quarantineWrites,
	});
}

function stopReason(value) {
	const reason = value?.reason;
	if (['user-cancelled', 'device-loss', 'editor-shutdown'].includes(reason)) return reason;
	if (['crash', 'hang', 'malformed-answer', 'resource-violation', 'oversize-state', 'identity-changed'].includes(reason)) return reason;
	return reason === 'oversized-answer' ? 'oversize-state' : 'crash';
}

/** A rejected session is the supervisor speaking; its codes are translated, never guessed. */
function supervisionStopReason(error) {
	const code = error?.cause_;
	if (code === 'heartbeat' || code === 'cancellation-timeout') return 'hang';
	if (code === 'resource-violation') return 'resource-violation';
	if (code === 'malformed-message') return 'malformed-answer';
	if (code === 'disposed') return 'editor-shutdown';
	if (code === 'cancelled') return 'user-cancelled';
	return 'crash';
}
