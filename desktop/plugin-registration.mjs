/* SPDX-License-Identifier: AGPL-3.0-only */

/** Assembles the plug-in discovery subsystem and registers it on main. */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';

import { dialog } from 'electron/main';

import { DesktopPluginConsent } from './project-library-runtime/desktop/plugin-consent.js';
import { DesktopPluginQuarantine } from './project-library-runtime/desktop/plugin-quarantine.js';
import { DesktopPluginRegistry } from './project-library-runtime/desktop/plugin-registry.js';
import { DesktopPluginScanService } from './project-library-runtime/desktop/plugin-scan-service.js';

/**
 * Quarantine has to outlive the process, so it is written atomically. A
 * half-written record would be indistinguishable from a machine on which
 * nothing was ever quarantined, which is the exact state the store exists to
 * prevent.
 */
function createQuarantineFileSystem() {
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

export function registerDesktopPluginDiscovery({
	channels, handle, ownerFor, settings, supervisor, describePayload, userDataPath, parentWindow,
}) {
	const quarantine = new DesktopPluginQuarantine({
		filePath: join(userDataPath, 'native-plugin-quarantine-v1.json'),
		fileSystem: createQuarantineFileSystem(),
	});
	const consent = new DesktopPluginConsent({
		// The picker is the only way a custom root enters the model, and it is
		// main-owned: the renderer can neither propose a path nor learn one.
		pickDirectory: async (format) => {
			const window = parentWindow();
			const result = await (window
				? dialog.showOpenDialog(window, { title: pickerTitle(format), properties: ['openDirectory'] })
				: dialog.showOpenDialog({ title: pickerTitle(format), properties: ['openDirectory'] }));
			return result.canceled || result.filePaths.length !== 1 ? null : result.filePaths[0];
		},
	});
	const registry = new DesktopPluginRegistry({ isQuarantined: (digest) => quarantine.isQuarantined(digest) });
	const service = new DesktopPluginScanService({
		supervisor,
		consent,
		// The service reports a fault; persisting it is this adapter's job, and
		// a failed write must not be swallowed into a clean-looking scan.
		quarantine: Object.freeze({
			isQuarantined: (digest) => quarantine.isQuarantined(digest),
			quarantine: (digest, reason) => {
				void quarantine.record({ digest, reason, at: Date.now() }).catch((error) => {
					console.error('Native plug-in quarantine could not be persisted:', error);
				});
			},
		}),
		roots: Object.freeze({
			resolve: (rootId, format) => {
				try {
					return consent.resolveRoot(format, rootId);
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
	handle(channels.nativePluginConsent, (event, value) => {
		void ownerFor(event);
		const format = String(value?.format || '');
		if (value?.action === 'revoke') {
			consent.revoke(format);
		} else if (value?.action === 'add-custom-root') {
			return consent.addCustomRoot(format);
		} else if (value?.action === 'add-standard-root') {
			return consent.admitStandardRoot(format, String(value?.rootId || ''));
		} else {
			consent.grant(format);
		}
		return consent.describe();
	});
	handle(channels.nativePluginScan, (event, value) => service.scanRoot({
		owner: ownerFor(event),
		rootId: String(value?.rootId || ''),
		format: String(value?.format || ''),
	}));
	handle(channels.nativePluginInventory, () => registry.describe());
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

function pickerTitle(format) {
	return `Choose a ${format} folder to scan`;
}
