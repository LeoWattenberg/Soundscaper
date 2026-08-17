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
	DesktopPluginRegistry,
	pluginObservationFromScanEntry,
} from './project-library-runtime/desktop/plugin-registry.js';
import { DesktopPluginScanService } from './project-library-runtime/desktop/plugin-scan-service.js';

const CONSENT_FILE = 'native-plugin-consent-v1.json';
const QUARANTINE_FILE = 'native-plugin-quarantine-v1.json';

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

/**
 * Feeds one described scan into the inventory. The scanner answers about
 * binaries and the registry holds identities; the translation between those two
 * vocabularies belongs to the registry and is imported rather than written a
 * second time here, where it could drift from the set the registry admits.
 */
export function recordScannedPlugins(registry, result, { identityFor = fileIdentity } = {}) {
	if (result.status !== 'scanned') return [];
	return result.entries.map((entry) => {
		const identity = identityFor(entry.binaryPath);
		// A binary that has gone between the scan and this record is not an
		// installation, and an entry the registry has no verdict for is the
		// scanner's fault: both are refused by name, and neither costs the rest
		// of the answer its place in the inventory.
		if (!identity) {
			return Object.freeze({ status: 'rejected', reason: 'malformed', detail: 'That plug-in binary is no longer there.' });
		}
		try {
			return registry.record(pluginObservationFromScanEntry(entry, {
				format: result.format,
				platform: process.platform,
				architecture: process.arch,
				identity,
			}));
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
export function observeScannedPlugins(supervisor, registry) {
	return Object.freeze({
		runJob: async (request) => {
			const result = await supervisor.runJob(request);
			if (request.kind === 'plugin-scan') recordScannedPlugins(registry, result);
			return result;
		},
		snapshot: () => supervisor.snapshot(),
		clearQuarantine: () => supervisor.clearQuarantine(),
		dispose: () => supervisor.dispose(),
	});
}

export function registerDesktopPluginDiscovery({
	channels, handle, ownerFor, settings, supervisor, describePayload, userDataPath, parentWindow,
}) {
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
	const scannerQuarantine = createScannerQuarantinePort(quarantine);
	const service = new DesktopPluginScanService({
		supervisor: observeScannedPlugins(supervisor, registry),
		consent,
		quarantine: scannerQuarantine,
		roots: Object.freeze({
			resolve: (rootId, format) => {
				try {
					return scanRootLocation(consent.resolveRoot(format, rootId));
				} catch {
					// An unknown root is a refusal, never an exception that would
					// tell the renderer which ids do and do not exist.
					return null;
				}
			},
		}),
		isEnabled: () => settings.snapshot().nativePluginDiscoveryEnabled === true,
		describePayload,
	});

	handle(channels.nativePluginAvailability, async () => Object.freeze({
		...(await service.availability()),
		consent: consent.describe(),
		quarantine: quarantine.snapshot(),
	}));
	handle(channels.nativePluginConsent, async (event, value) => {
		void ownerFor(event);
		const outcome = await applyConsentAction(consent, {
			action: String(value?.action || ''),
			format: String(value?.format || ''),
			rootId: String(value?.rootId || ''),
		});
		await persistConsent();
		return outcome;
	});
	handle(channels.nativePluginScan, async (event, value) => {
		const outcome = await service.scanRoot({
			owner: ownerFor(event),
			rootId: String(value?.rootId || ''),
			format: String(value?.format || ''),
		});
		// A fault the store could not write is this scan's failure and not a line
		// in a log: a quarantine that did not persist is one the next start will
		// not honour, and the scan would have looked clean either way.
		await scannerQuarantine.settle();
		return outcome;
	});
	handle(channels.nativePluginInventory, () => registry.describe());
	handle(channels.nativePluginClearQuarantine, async (event, value) => {
		void ownerFor(event);
		const clearance = String(value?.clearance || '');
		if (clearance !== 'rescan' && clearance !== 're-enable') {
			throw new Error('A plug-in quarantine is cleared only by an explicit rescan or re-enable.');
		}
		return Object.freeze({ cleared: await quarantine.clear(String(value?.digest || ''), clearance) });
	});
	return Object.freeze({
		service,
		registry,
		quarantine,
		ready: () => quarantine.load(),
		revokeOwner: (owner) => service.revokeOwner(owner),
		dispose: () => service.dispose(),
	});
}

/** The Tools submenu items that manage discovery, off by default like the rest. */
export function desktopPluginDiscoveryMenuItems(settings) {
	return [
		{ type: 'separator' },
		{
			label: 'Discover Native Effects',
			type: 'checkbox',
			checked: settings.snapshot().nativePluginDiscoveryEnabled === true,
			click: (item) => void settings.setNativePluginDiscoveryEnabled(item.checked),
		},
	];
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
