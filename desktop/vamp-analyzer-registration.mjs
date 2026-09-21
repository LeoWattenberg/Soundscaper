/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-process composition and IPC for finite Vamp analyzer sessions. */

import { join } from 'node:path';

import { MessageChannelMain } from 'electron/main';

import { createNativeVampAnalyzerBackendFactory } from './project-library-runtime/desktop/native-vamp-analyzer-helper-backend.js';
import { authenticatePluginBinary } from './plugin-binary-authentication.mjs';
import { createDesktopNativeAddonHelperSupervisor } from './native-helper-registration.mjs';
import { createVampAnalyzerAllowanceStore } from './vamp-analyzer-allowance-store.mjs';
import { createDesktopVampAnalyzerRuntime } from './vamp-analyzer-runtime.mjs';

const ALLOWANCE_FILE = 'native-vamp-analyzer-allowance-v1.json';
const INSTALLATION_ID = /^vi[a-f\d]{30}$/u;

export function registerDesktopVampAnalyzers(options) {
	if (!options || typeof options.handle !== 'function' || typeof options.ownerFor !== 'function') {
		throw new TypeError('Vamp analyzer registration requires IPC and owner seams.');
	}
	let runtime;
	const faultRecorder = createHostFaultRecorder(options.hostQuarantine, (digest) =>
		runtime?.cancelDigest?.(digest) ?? Promise.resolve(0));
	runtime = options.runtime ?? createRuntime(options, faultRecorder.record);
	const { channels, handle, ownerFor } = options;
	handle(channels.nativeVampInventory, (event) => {
		void ownerFor(event);
		return runtime.catalog();
	});
	handle(channels.nativeVampSessionStart, (event, value) => runtime.start(ownerFor(event), value));
	handle(channels.nativeVampSessionConfigure, (event, value) => runtime.configure(ownerFor(event), value));
	handle(channels.nativeVampSessionPush, (event, value) => runtime.pushPcm(ownerFor(event), value));
	handle(channels.nativeVampSessionFinish, (event, value) => runtime.finish(ownerFor(event), value));
	handle(channels.nativeVampSessionCancel, (event, value) => runtime.cancel(ownerFor(event), value));
	const registration = Object.freeze({
		runtime,
		ownsInstallation: (value) => typeof value === 'string' && INSTALLATION_ID.test(value),
		scanRoot: (owner, value) => runtime.scanRoot(owner, value),
		mergeRegistry: (effectRegistry) => Object.freeze({
			...effectRegistry,
			entries: Object.freeze([
				...effectRegistry.entries,
				...runtime.pluginRegistryEntries(),
			]),
		}),
		setInstallationAllowed: (installationId, allowed) =>
			runtime.setInstallationAllowed(installationId, allowed),
		selectInstallation: (installationId) => runtime.selectInstallation(installationId),
		cancelFormat: (format) => runtime.cancelScans?.(format) ?? 0,
		async revokeOwner(owner) {
			const cancelled = await runtime.revokeOwner(owner);
			await faultRecorder.settle();
			return cancelled;
		},
		async disable() {
			const cancelled = await runtime.disable();
			await faultRecorder.settle();
			return cancelled;
		},
		settleQuarantineWrites: faultRecorder.settle,
		async dispose() {
			await runtime.dispose();
			await faultRecorder.settle();
		},
	});
	if (options.effects) registerSharedPluginRoutes(options, registration);
	return registration;
}

function registerSharedPluginRoutes(options, vamp) {
	const { channels, handle, ownerFor, effects } = options;
	handle(channels.nativePluginScan, async (event, value) => {
		const owner = ownerFor(event);
		const analyzer = value?.format === 'vamp';
		const outcome = analyzer
			? await vamp.scanRoot(owner, value)
			: await effects.service.scanRoot({
				owner, rootId: String(value?.rootId || ''), format: String(value?.format || ''),
			});
		await effects.settleQuarantine();
		if (!analyzer) {
			effects.allowances.apply(effects.registry);
			await effects.allowances.capture(effects.registry);
		}
		return outcome;
	});
	handle(channels.nativePluginInventory, () => vamp.mergeRegistry(effects.registry.describe()));
	handle(channels.nativePluginSetInstallationAllowed, async (event, value) => {
		void ownerFor(event);
		if (vamp.ownsInstallation(value?.installationId)) {
			assertActive(effects, 'vamp');
			await vamp.setInstallationAllowed(value.installationId, value?.allowed);
			return vamp.mergeRegistry(effects.registry.describe());
		}
		const format = effectInstallationFormat(effects.registry, value?.installationId);
		assertActive(effects, format);
		if (value?.allowed === true) {
			effects.registry.allow(value.installationId);
			effects.hosting?.isolation.restoreDigest(effects.registry.installationDigest(value.installationId));
		} else if (value?.allowed === false) {
			effects.registry.withdrawAllowance(value.installationId);
			effects.hosting?.isolation.revokeDigest(effects.registry.installationDigest(value.installationId));
		} else throw new Error('A plug-in installation allowance must be an explicit boolean.');
		await effects.allowances.capture(effects.registry);
		return vamp.mergeRegistry(effects.registry.describe());
	});
	handle(channels.nativePluginSelectInstallation, async (event, value) => {
		void ownerFor(event);
		if (vamp.ownsInstallation(value?.installationId)) {
			assertActive(effects, 'vamp');
			await vamp.selectInstallation(value.installationId);
		} else {
			assertActive(effects, effectInstallationFormat(effects.registry, value?.installationId));
			effects.registry.select(value.installationId);
			await effects.allowances.capture(effects.registry);
		}
		return vamp.mergeRegistry(effects.registry.describe());
	});
}

function effectInstallationFormat(registry, installationId) {
	for (const entry of registry.describe().entries) {
		if (entry.installations.some((installation) => installation.installationId === installationId)) return entry.format;
	}
	throw new Error('That plug-in installation is not registered.');
}

function assertActive(effects, format) {
	if (!effects.isFormatActive(format)) {
		throw new Error('That plug-in format remains blocked by production policy and source activation.');
	}
}

function createRuntime(options, onSessionFault) {
	const allowances = createVampAnalyzerAllowanceStore({
		filePath: join(options.userDataPath, ALLOWANCE_FILE), fileSystem: options.fileSystem,
		authenticateLibrary: options.authenticateLibrary ?? authenticatePluginBinary,
	});
	const backend = options.backend ?? createNativeVampAnalyzerBackendFactory({
		supervisorFor: (grant) => (options.createAnalyzerHelper ?? createAnalyzerHelper)(options, grant).supervisor,
		createChannel: options.createMessageChannel ?? (() => new MessageChannelMain()),
	});
	return (options.createRuntime ?? createDesktopVampAnalyzerRuntime)({
		supervisor: options.supervisor, consent: options.consent, quarantine: options.quarantine,
		roots: options.roots, isEnabled: options.isEnabled, describePayload: options.describePayload,
		allowances, backend, onSessionFault,
	});
}

function createHostFaultRecorder(quarantine, cancelDigest) {
	let writes = Promise.resolve();
	const record = (grant, error) => {
		const kind = analyzerFaultKind(error);
		if (kind === null || typeof quarantine?.record !== 'function') return Promise.resolve();
		const write = async () => {
			const outcome = await quarantine.record({
				digest: grant.librarySha256, scope: 'host', kind,
			});
			if (outcome?.status === 'quarantined') await cancelDigest(grant.librarySha256);
		};
		const next = writes.then(write, write);
		writes = next.catch(() => undefined);
		return next.then(() => undefined);
	};
	return Object.freeze({ record, settle: () => writes });
}

function analyzerFaultKind(error) {
	const cause = typeof error?.cause_ === 'string' ? error.cause_ : '';
	const code = typeof error?.code === 'string' ? error.code : '';
	if (['cancelled', 'disposed'].includes(cause)) return null;
	if (['binary-mismatch', 'capacity', 'invalid-request', 'quarantined', 'unsupported-kind'].includes(cause)) return null;
	if (['cancelled', 'configuration-refused', 'invalid-argument'].includes(code)) return null;
	if (['heartbeat', 'cancellation-timeout'].includes(cause)) return 'hang';
	if (['identity-changed', 'library-unreadable'].includes(code)) return 'identity-change';
	if (['limit-exceeded', 'oversize-answer', 'oversized-answer'].includes(code)) return 'oversized-answer';
	if (['malformed-message', 'job-mismatch'].includes(cause)
		|| ['analyzer-not-found', 'duplicate-configure', 'incomplete-stream', 'library-malformed',
			'malformed-message', 'message-before-configure'].includes(code)
		|| error instanceof TypeError || error instanceof RangeError) return 'malformed-answer';
	return 'crash';
}

function createAnalyzerHelper(options, grant) {
	return createDesktopNativeAddonHelperSupervisor({
		desktopRoot: options.desktopRoot, packaged: options.packaged, resourcesPath: options.resourcesPath,
		role: 'plugin-analyzer', payloadKind: 'professional',
		serviceName: `soundscaper-native-vamp-${grant.librarySha256.slice(0, 12)}`,
	});
}
