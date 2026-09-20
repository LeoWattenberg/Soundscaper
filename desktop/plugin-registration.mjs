/* SPDX-License-Identifier: AGPL-3.0-only */

/** Assembles the plug-in discovery subsystem and registers it on main. */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { readFileSync, statSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';

import { dialog } from 'electron/main';

import { DesktopPluginConsent } from './project-library-runtime/desktop/plugin-consent.js';
import { DesktopPluginQuarantine } from './project-library-runtime/desktop/plugin-quarantine.js';
import {
	openNativePersistentPluginSession,
} from './project-library-runtime/desktop/native-plugin-helper-adapter.js';
import { createDesktopPluginHostingRuntime } from './plugin-hosting-runtime.mjs';

export { createDesktopPluginHostingRuntime } from './plugin-hosting-runtime.mjs';
import {
	DesktopPluginRegistry,
	pluginObservationFromScanEntry,
} from './project-library-runtime/desktop/plugin-registry.js';
import { DesktopPluginScanService } from './project-library-runtime/desktop/plugin-scan-service.js';
import { createDesktopNativeAddonHelperSupervisor } from './native-helper-registration.mjs';
import { productionSoundscaperPluginFormatActivated } from './soundscaper-native-activation-policy.mjs';
import { createPluginRegistryAllowanceStore } from './plugin-registry-allowance-store.mjs';
import { authenticatePluginBinary } from './plugin-binary-authentication.mjs';
import { registerDesktopVampAnalyzers } from './vamp-analyzer-registration.mjs';

const CONSENT_FILE = 'native-plugin-consent-v1.json';
const QUARANTINE_FILE = 'native-plugin-quarantine-v1.json';
const ALLOWANCE_FILE = 'native-plugin-allowance-v1.json';
const LEGACY_ALLOWANCE_FILE = 'native-plugin-review-v1.json';

/**
 * The scan service names a fault in the vocabulary of a scan; the durable store
 * names it in the vocabulary of the bytes that misbehaved. The translation is
 * total and explicit: a reason with no entry here is a wiring mistake that has
 * to be heard, never a fault filed under whichever kind happened to be first.
 */
const SCANNER_FAULT_KINDS = new Map([
	['scanner-crash', 'crash'],
	['scanner-hang', 'hang'],
	['malformed-answer', 'malformed-answer'],
	['oversize-answer', 'oversized-answer'],
	['malformed-plugin', 'malformed-answer'],
	['oversize-plugin', 'oversized-answer'],
	['identity-change', 'identity-change'],
]);

/**
 * Both durable files have to outlive the process, so they are written
 * atomically. A half-written record would be indistinguishable from a machine
 * on which nothing was ever quarantined or consented to, which is the exact
 * state these stores exist to prevent.
 */
function createDurableFileSystem() {
	return Object.freeze({
		readFile: (path) => readFile(path, 'utf8'),
		writeFile: async (path, contents) => {
			await mkdir(dirname(path), { recursive: true });
			const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
			await writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
			await rename(temporary, path);
		},
	});
}

/**
 * Adapts the durable quarantine onto the port the scan service holds. The
 * service reports a fault and moves on; deciding what that is in the store's
 * own closed vocabulary, and writing it, is this adapter's whole job.
 */
export function createScannerQuarantinePort(quarantine) {
	let writes = Promise.resolve();
	return Object.freeze({
		isQuarantined: (digest) => quarantine.isQuarantined(digest),
		quarantine: (digest, reason) => {
			// Deferred into the chain rather than raised here: this port is called
			// from inside the service's own fault handling, where throwing would
			// replace the fault being recorded with the failure to record it.
			writes = writes.then(() => quarantine.record({ digest, scope: 'scanner', kind: scannerFaultKind(reason) }));
		},
		/** Awaited by the scan that caused them, so a failed write is that scan's failure too. */
		settle: () => {
			const pending = writes;
			writes = pending.catch(() => undefined);
			return pending;
		},
	});
}

export function recordScannedPlugins(registry, result, {
	identityFor = pluginCandidateIdentity, onRecorded = () => undefined,
	onIdentityChanged = () => undefined,
} = {}) {
	// An oversized root still reports the prefix that fits; those entries are
	// shown to the user, so refusing to record them left every plug-in from a
	// large folder visible in the results yet impossible to allow or host.
	if (!['scanned', 'root-oversized'].includes(result.status)) return [];
	return result.entries.map((entry) => {
		const identity = identityFor(entry.binaryPath);
		const bundleStableIds = result.entries.filter((candidate) => candidate.binaryPath === entry.binaryPath
			&& candidate.binaryBytes === entry.binaryBytes && candidate.binarySha256 === entry.binarySha256)
			.map((candidate) => candidate.stableId);
		// A binary that has gone between the scan and this record is not an
		// installation, and an entry the registry has no verdict for is the
		// scanner's fault: both are refused by name, and neither costs the rest
		// of the answer its place in the inventory.
		if (!identity) {
			return Object.freeze({ status: 'rejected', reason: 'malformed', detail: 'That plug-in binary is no longer there.' });
		}
		try {
			const observation = pluginObservationFromScanEntry(entry, {
				format: result.format,
				platform: process.platform,
				architecture: process.arch,
				identity,
				bundleStableIds,
			});
			const admission = registry.record(observation);
			if (admission.status === 'recorded') onRecorded(observation, admission);
			// A digest that re-claims a different identity lied about what it is;
			// the plan quarantines that immediately and durably, whichever
			// process noticed. Dropping the rejection silently left the binary
			// eligible for the very next scan.
			if (admission.status === 'rejected' && admission.reason === 'identity-change') {
				onIdentityChanged(entry.binarySha256);
			}
			return admission;
		} catch (error) {
			return Object.freeze({ status: 'rejected', reason: 'malformed', detail: describeError(error) });
		}
	});
}

/**
 * The scan job's own answer, on its way past. It is the only point at which
 * main still holds the binary paths behind a scan — the service's outcome is
 * the renderer projection, which drops them by design — so the inventory is
 * filled here and the answer is handed back untouched.
 */
export function observeScannedPlugins(supervisor, registry, {
	isFormatActivated = () => true, onRecorded = () => undefined,
	onIdentityChanged = () => undefined,
} = {}) {
	return Object.freeze({
		runJob: async (request) => {
			if (request.kind === 'plugin-scan' && !isFormatActivated(request.grant?.format)) {
				throw new Error('That plug-in format remains behind its production activation gate.');
			}
			const result = await supervisor.runJob(request);
			if (request.kind === 'plugin-scan') {
				if (request.signal?.aborted) return result;
				if (!isFormatActivated(request.grant?.format)) {
					throw new Error('That plug-in format activation changed while its scan was running.');
				}
				recordScannedPlugins(registry, result, { onRecorded, onIdentityChanged });
			}
			return result;
		},
		snapshot: () => supervisor.snapshot(),
		clearQuarantine: () => supervisor.clearQuarantine(),
		dispose: () => supervisor.dispose(),
	});
}

export function registerDesktopPluginDiscovery({
	channels, handle, ownerFor, settings, supervisor: injectedSupervisor, describePayload: injectedDescribePayload,
	userDataPath, parentWindow, desktopRoot, packaged, resourcesPath,
	nativePluginStateAuthority = null,
	isPluginHostFormatActivated = productionPluginFormatActivated,
	createPluginHostHelper = null,
	openPersistentPluginSession = openNativePersistentPluginSession,
	vampAnalyzerRuntime = null, vampAnalyzerBackend = null,
}) {
	const helper = injectedSupervisor ? null : createDesktopNativeAddonHelperSupervisor({
		desktopRoot,
		packaged,
		resourcesPath,
		role: 'plugin-scanner',
		serviceName: 'soundscaper-native-plugin-scanner',
		payloadKind: 'professional',
	});
	const supervisor = injectedSupervisor ?? helper.supervisor;
	const describePayload = injectedDescribePayload ?? helper.describePayload;
	const durable = createDurableFileSystem();
	const consentPath = join(userDataPath, CONSENT_FILE);
	const quarantine = new DesktopPluginQuarantine({
		filePath: join(userDataPath, QUARANTINE_FILE),
		fileSystem: durable,
	});
	const consent = createConsent(consentPath, async (format) => {
		// The picker is the only way a custom root enters the model, and it is
		// main-owned: the renderer can neither propose a path nor learn one.
		const window = parentWindow();
		const result = await (window
			? dialog.showOpenDialog(window, { title: pickerTitle(format), properties: ['openDirectory'] })
			: dialog.showOpenDialog({ title: pickerTitle(format), properties: ['openDirectory'] }));
		return result.canceled || result.filePaths.length !== 1 ? null : result.filePaths[0];
	});
	let consentWrites = Promise.resolve();
	const persistConsent = () => {
		const contents = JSON.stringify(consent.exportState());
		consentWrites = consentWrites.then(
			() => durable.writeFile(consentPath, contents),
			() => durable.writeFile(consentPath, contents),
		);
		return consentWrites;
	};
	const registry = new DesktopPluginRegistry({ isQuarantined: (digest) => quarantine.isQuarantined(digest) });
	const allowances = createPluginRegistryAllowanceStore({
		filePath: join(userDataPath, ALLOWANCE_FILE),
		legacyFilePath: join(userDataPath, LEGACY_ALLOWANCE_FILE), fileSystem: durable,
		authenticateBinary: authenticatePluginBinary,
	});
	const scannerQuarantine = createScannerQuarantinePort(quarantine);
	const formatIsActive = (format) => isPluginHostFormatActivated(format) === true;
	const discoveryConsent = Object.freeze({
		isGranted: (format) => formatIsActive(format) && consent.isGranted(format),
	});
	const discoveryRoots = Object.freeze({
		resolve: (rootId, format) => {
			if (!formatIsActive(format)) return null;
			try { return scanRootLocation(consent.resolveRoot(format, rootId)); }
			catch { return null; }
		},
	});
	const service = new DesktopPluginScanService({
		supervisor: observeScannedPlugins(supervisor, registry, {
			isFormatActivated: formatIsActive, onRecorded: allowances.observe,
			onIdentityChanged: (digest) => scannerQuarantine.quarantine(digest, 'identity-change'),
		}),
		consent: discoveryConsent,
		quarantine: scannerQuarantine,
		roots: discoveryRoots,
		isEnabled: () => settings.snapshot().nativePluginDiscoveryEnabled === true,
		describePayload,
	});
	const hosting = nativePluginStateAuthority === null ? null : createDesktopPluginHostingRuntime({
		registry,
		quarantine,
		settings,
		stateBodies: nativePluginStateAuthority,
		isFormatActivated: isPluginHostFormatActivated,
		createHostHelper: createPluginHostHelper ?? ((launch) => createDesktopNativeAddonHelperSupervisor({
			desktopRoot,
			packaged,
			resourcesPath,
			role: 'plugin-host',
			serviceName: `soundscaper-native-plugin-${launch.format}-${launch.binarySha256.slice(0, 12)}`,
			payloadKind: 'professional',
		})),
		openPersistentPluginSession,
	});
	const vamp = registerDesktopVampAnalyzers({
		channels, handle, ownerFor, userDataPath, fileSystem: durable, supervisor,
		consent: discoveryConsent, quarantine: scannerQuarantine, roots: discoveryRoots,
		hostQuarantine: quarantine,
		isEnabled: () => settings.snapshot().nativePluginDiscoveryEnabled === true,
		describePayload, desktopRoot, packaged, resourcesPath,
		...(vampAnalyzerRuntime ? { runtime: vampAnalyzerRuntime } : {}),
		...(vampAnalyzerBackend ? { backend: vampAnalyzerBackend } : {}),
		effects: Object.freeze({ service, registry, allowances, hosting, isFormatActive: formatIsActive,
			settleQuarantine: () => scannerQuarantine.settle() }),
	});

	handle(channels.nativePluginAvailability, async () => Object.freeze({
		...(await service.availability()),
		consent: activatedConsentProjection(consent.describe(), formatIsActive),
		quarantine: quarantine.snapshot(),
	}));
	handle(channels.nativePluginConsent, async (event, value) => {
		void ownerFor(event);
		const format = String(value?.format || '');
		const action = String(value?.action || '');
		if (!formatIsActive(format)) {
			throw new Error('That plug-in format remains blocked by production policy and source activation.');
		}
		const outcome = await applyConsentAction(consent, {
			action,
			format,
			rootId: String(value?.rootId || ''),
		});
		if (action === 'revoke' || action === 'remove-root') {
			service.cancelFormat(format);
			vamp.cancelFormat(format);
		}
		if (!formatIsActive(format)) {
			consent.revoke(format);
			service.cancelFormat(format);
			vamp.cancelFormat(format);
			await persistConsent();
			throw new Error('That plug-in format activation changed before consent completed.');
		}
		await persistConsent();
		return outcome;
	});
	handle(channels.nativePluginClearQuarantine, async (event, value) => {
		void ownerFor(event);
		const clearance = String(value?.clearance || '');
		if (clearance !== 'rescan' && clearance !== 're-enable') {
			throw new Error('A plug-in quarantine is cleared only by an explicit rescan or re-enable.');
		}
		const digest = String(value?.digest || '');
		// A fault write still in flight lands before the clearance, so the user
		// clears the quarantine that exists rather than racing its record.
		await Promise.all([hosting?.settleQuarantineWrites(), vamp.settleQuarantineWrites()]);
		const cleared = await quarantine.clear(digest, clearance);
		// The in-memory hold releases with the durable one, or an explicit
		// re-enable would leave the digest dead until the editor restarts.
		const restored = hosting ? hosting.isolation.restoreDigest(digest) : false;
		return Object.freeze({ cleared: cleared || restored });
	});
	handle(channels.nativePluginInstantiate, async (event, value) => {
		await rebindPluginInstallation(allowances, registry, value?.installationId);
		const runtime = requireHosting(hosting);
		const owner = ownerFor(event);
		const instance = await runtime.service.instantiate(owner, value);
		try {
			await runtime.openRealtime(owner, instance.instanceId, event.sender, value?.sampleRate);
			return instance;
		} catch (error) {
			runtime.service.close(owner, instance.instanceId);
			throw error;
		}
	});
	handle(channels.nativePluginRunOffline, (event, value) =>
		requireHosting(hosting).service.runOffline(ownerFor(event), value?.instanceId));
	handle(channels.nativePluginSetBypassed, (event, value) =>
		requireHosting(hosting).service.setBypassed(ownerFor(event), value));
	handle(channels.nativePluginPersistState, (event, value) =>
		requireHosting(hosting).persistState(ownerFor(event), value));
	handle(channels.nativePluginRestoreState, (event, value) =>
		requireHosting(hosting).restoreState(ownerFor(event), value));
	handle(channels.nativePluginOpenVendorUi, (event, value) =>
		requireHosting(hosting).service.openVendorUi(ownerFor(event), value?.instanceId));
	handle(channels.nativePluginCloseVendorUi, (event, value) =>
		requireHosting(hosting).service.closeVendorUi(ownerFor(event), value));
	handle(channels.nativePluginCloseInstance, async (event, value) => {
		const runtime = requireHosting(hosting);
		const owner = ownerFor(event);
		await runtime.closeRealtime(value?.instanceId);
		return runtime.service.close(owner, value?.instanceId);
	});
	return Object.freeze({
		service,
		hostService: hosting?.service ?? null,
		hostIsolation: hosting?.isolation ?? null,
		supervisorPort: supervisor,
		registry,
		quarantine,
		settlePluginQuarantineWrites: () => Promise.all([
			hosting?.settleQuarantineWrites(), vamp.settleQuarantineWrites(),
		]),
		ready: async () => {
			await quarantine.load();
			return Object.freeze([]);
		},
		setEnabled: async (enabled) => {
			const result = await settings.setNativePluginDiscoveryEnabled(enabled === true);
			if (!result) {
				service.cancelAll();
				const vampDisabled = vamp.disable();
				await hosting?.closeAll();
				hosting?.service.closeAll();
				await vampDisabled;
			}
			return result;
		},
		revokeOwner: (owner) => {
			service.revokeOwner(owner);
			void hosting?.revokeOwner(owner);
			hosting?.service.revokeOwner(owner);
			return vamp.revokeOwner(owner);
		},
		dispose: async () => {
			void hosting?.closeAll();
			hosting?.service.dispose();
			service.dispose();
			await vamp.dispose();
		},
	});
}

/** Resolve machine activation for every known format from authenticated machine state. */
export function productionPluginFormatActivated() {
	return productionSoundscaperPluginFormatActivated(...arguments);
}

function activatedConsentProjection(projection, isActive) {
	return Object.freeze({
		...projection,
		scanningEnabled: projection.formats.some((entry) => isActive(entry.format)
			&& entry.granted && entry.roots.some((root) => root.admitted)),
		formats: Object.freeze(projection.formats.map((entry) => isActive(entry.format)
			? entry
			: Object.freeze({ ...entry, supported: false, granted: false, roots: Object.freeze([]) }))),
	});
}


function requireHosting(hosting) {
	if (!hosting) throw new Error('Native plug-in hosting is unavailable outside Soundscaper V11.');
	return hosting;
}

async function rebindPluginInstallation(allowances, registry, installationId) {
	if (await allowances.rebind(registry, installationId)) return;
	try { registry.hostDescriptorFor(installationId); }
	catch { throw new Error('That persisted plug-in installation could not be re-authenticated.'); }
}

/**
 * The action set is closed. An action this build does not implement is refused
 * rather than interpreted, because the one reading an authorization surface
 * must never fall back to is the one that grants.
 */
async function applyConsentAction(consent, { action, format, rootId }) {
	if (action === 'grant') consent.grant(format);
	else if (action === 'revoke') consent.revoke(format);
	else if (action === 'add-custom-root') return consent.addCustomRoot(format);
	else if (action === 'add-standard-root') return consent.admitStandardRoot(format, rootId);
	else if (action === 'remove-root') consent.removeRoot(format, rootId);
	else throw new Error('That is not an admitted plug-in consent action.');
	return consent.describe();
}

/**
 * Consent is restored before the first handler can be called, so the read is
 * synchronous: a renderer that asked about a format while the file was still
 * being read would be told the user had consented to nothing. A file that
 * cannot be trusted starts the format table empty rather than refusing to
 * start, exactly as the durable quarantine does.
 */
function createConsent(filePath, pickDirectory) {
	const state = readConsentState(filePath);
	if (state === null) return new DesktopPluginConsent({ pickDirectory });
	try {
		return new DesktopPluginConsent({ pickDirectory, state });
	} catch (error) {
		console.error('The persisted plug-in consent was not admitted; starting with none:', error);
		return new DesktopPluginConsent({ pickDirectory });
	}
}

function readConsentState(filePath) {
	try {
		return JSON.parse(readFileSync(filePath, 'utf8'));
	} catch (error) {
		if (error?.code !== 'ENOENT') {
			console.error('The persisted plug-in consent could not be read; starting with none:', error);
		}
		return null;
	}
}

/**
 * The main-private location one scan runs against. The digest names the
 * root-and-format pair the durable quarantine is keyed by, and the identity is
 * captured here so the grant names the directory main resolved rather than
 * whatever the path happens to point at by the time the helper opens it.
 */
function scanRootLocation(root) {
	const identity = fileIdentity(root.path, (entry) => entry.isDirectory());
	if (!identity) return null;
	return Object.freeze({
		path: root.path,
		identity,
		scanDigest: createHash('sha256').update(`${root.format}\u0000${root.path}`).digest('hex'),
	});
}

function fileIdentity(path, admits = (entry) => entry.isFile()) {
	let entry;
	try {
		entry = statSync(path);
	} catch {
		return null;
	}
	if (!admits(entry)) return null;
	const dev = Number(entry.dev);
	const ino = Number(entry.ino);
	if (!Number.isSafeInteger(dev) || !Number.isSafeInteger(ino) || dev < 0 || ino < 0) return null;
	return Object.freeze({ dev, ino });
}

function pluginCandidateIdentity(path) {
	return fileIdentity(path, (entry) => entry.isFile() || entry.isDirectory());
}

function describeError(error) {
	return error instanceof Error ? error.message : String(error);
}

function scannerFaultKind(reason) {
	const kind = SCANNER_FAULT_KINDS.get(reason);
	if (!kind) throw new Error(`The plug-in scanner reported an unmapped fault reason: ${String(reason)}.`);
	return kind;
}

function pickerTitle(format) {
	return `Choose a ${format} folder to scan`;
}
