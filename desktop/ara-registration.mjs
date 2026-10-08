/* SPDX-License-Identifier: AGPL-3.0-only */

import { MessageChannelMain } from 'electron/main';
import { DesktopAraSessions } from './project-library-runtime/desktop/ara-session-service.js';
import { openAraHelperSession } from './project-library-runtime/desktop/ara-helper-session.js';
import { ARA_CHANNELS } from './project-library-runtime/src/common/editor/ara-contract.js';
import { createDesktopNativeAddonHelperSupervisor } from './native-helper-registration.mjs';

/** Shared clip editing deliberately carries no product-specific rack authority. */
export function registerDesktopAra(options) {
	const { handle, ownerFor, registry, settings, consent, quarantine, isFormatActive } = options;
	let quarantineWrites = Promise.resolve();
	const runtime = new DesktopAraSessions({
		isEnabled: () => settings.snapshot().nativePluginDiscoveryEnabled === true
			&& consent.isGranted('vst3') && isFormatActive('vst3'),
		isAdmitted: (installationId) => {
			try { return !quarantine.isQuarantined(registry.hostDescriptorFor(installationId).binarySha256); }
			catch { return false; }
		},
		open: async (installationId, source) => {
			await options.rebind(installationId);
			const descriptor = registry.hostDescriptorFor(installationId);
			if (descriptor.format !== 'vst3' || quarantine.isQuarantined(descriptor.binarySha256)) {
				throw new Error('ARA requires an allowed, healthy VST3 installation.');
			}
			const grant = registry.hostGrantFor(installationId);
			const helper = createDesktopNativeAddonHelperSupervisor({
				desktopRoot: options.desktopRoot, packaged: options.packaged, resourcesPath: options.resourcesPath,
				role: 'plugin-host', payloadKind: 'professional',
				serviceName: `scape-ara-${descriptor.binarySha256.slice(0, 12)}`,
			});
			try {
				if ((await helper.describePayload()).status !== 'available') throw new Error('ARA native runtime is unavailable.');
				return await openAraHelperSession({
					supervisor: helper.supervisor, grant, source,
					createChannel: () => new MessageChannelMain(), dispose: () => helper.supervisor.dispose(),
					onFault: (error) => {
						const kind = error.code === 'hang' ? 'hang' : 'crash';
						quarantineWrites = quarantineWrites.then(() => quarantine.record({
							digest: descriptor.binarySha256, scope: 'host', kind,
						})).catch(() => undefined);
					},
				});
			} catch (error) { helper.supervisor.dispose(); throw error; }
		},
	});
	for (const [operation, channel] of Object.entries(ARA_CHANNELS)) {
		const method = operation === 'editor' ? 'openEditor' : operation;
		handle(channel, (event, value) => runtime[method](ownerFor(event), value));
	}
	return Object.freeze({
		disable: () => runtime.disable(), revokeOwner: (owner) => runtime.revokeOwner(owner),
		withdrawInstallation: (id) => runtime.withdrawInstallation(id),
		settleQuarantineWrites: () => quarantineWrites,
		dispose: async () => { await runtime.dispose(); await quarantineWrites; },
	});
}
