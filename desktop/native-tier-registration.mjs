/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * One seam for the whole supervised native tier.
 *
 * Every helper is registered, revoked and disposed together, so
 * main holds one handle rather than one variable per helper. That matters
 * beyond tidiness: a helper that main forgets to revoke on renderer loss keeps
 * running for a window that is already gone, and a per-helper variable is
 * exactly how that gets forgotten.
 */

import { registerDesktopHelperProbe } from './helper-registration.mjs';
import { registerDesktopNativeAudioHelper } from './native-helper-registration.mjs';
import { registerDesktopPluginDiscovery } from './plugin-registration.mjs';
import { createSoundscaperNativeActivationPolicy } from './soundscaper-native-activation-policy.mjs';

/**
 * What every registrar behind this seam is entitled to receive. Spreading an
 * unchecked bag into each of them is what let a missing seam reach a path join
 * inside a helper, where the failure named an argument type rather than the
 * caller that forgot it, and took the whole start-up down with it.
 */
const REQUIRED_SEAMS = Object.freeze({
	channels: 'object',
	handle: 'function',
	ownerFor: 'function',
	readCapabilities: 'object',
	settings: 'object',
	desktopRoot: 'string',
	packaged: 'boolean',
	resourcesPath: 'string',
	userDataPath: 'string',
	parentWindow: 'function',
	productId: 'string',
	nativePluginStateAuthority: 'function',
});

export function registerDesktopNativeTier(options) {
	const seams = requireNativeTierSeams(options);
	let activation = createSoundscaperNativeActivationPolicy({
		sourceAudit: options.nativeSourceAudit ?? null,
		productionReadiness: options.nativeProductionReadiness ?? null,
		pluginIsolationEnforced: options.nativePluginIsolationEnforced === true,
	});
	const backendActivated = typeof options.isBackendActivated === 'function'
		? options.isBackendActivated : (backend) => activation.audioBackend(backend);
	const pluginFormatActivated = typeof options.isPluginHostFormatActivated === 'function'
		? options.isPluginHostFormatActivated : (format) => activation.pluginFormat(format);
	const audio = registerDesktopNativeAudioHelper({
		...seams, isBackendActivated: backendActivated,
	});
	const plugins = registerDesktopPluginDiscovery({
		...seams,
		isPluginHostFormatActivated: pluginFormatActivated,
		nativePluginStateAuthority: seams.productId === 'soundscaper'
			? seams.nativePluginStateAuthority()
			: null,
	});
	return Object.freeze({
		probe: registerDesktopHelperProbe(seams),
		audio,
		plugins,
		/** The durable stores the surfaces consult, loaded before a window exists. */
		ready: async () => {
			if (seams.productId === 'soundscaper' && options.nativeSourceAudit === undefined) {
				const payload = await audio.describePayload();
				if (payload.status === 'available') {
					activation = createSoundscaperNativeActivationPolicy({
						sourceAudit: payload.descriptor.sourceAudit,
						productionReadiness: payload.descriptor.productionReadiness,
						// The current utilityProcess host is same-UID and has no
						// authenticated OS launcher, regardless of signed review bytes.
						pluginIsolationEnforced: false,
					});
				}
			}
			return plugins.ready();
		},
	});
}

export async function disposeDesktopNativeTier(tier) {
	const results = await Promise.allSettled([
		tier?.probe?.dispose(),
		tier?.audio?.dispose(),
		tier?.plugins?.dispose(),
	]);
	throwNativeTierFailures(results, 'Desktop native-tier shutdown failed');
}

/** Every native surface drains together when a renderer goes away. */
export async function revokeDesktopNativeTierOwner(tier, owner) {
	const results = await Promise.allSettled([
		tier?.probe?.revokeOwner(owner),
		tier?.audio?.revokeOwner(owner),
		tier?.plugins?.revokeOwner(owner),
	]);
	throwNativeTierFailures(results, 'Desktop native-tier owner revocation failed');
}

function throwNativeTierFailures(results, message) {
	const failures = results.filter(({ status }) => status === 'rejected').map(({ reason }) => reason);
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, message);
}

function requireNativeTierSeams(options) {
	if (!options || typeof options !== 'object') {
		throw new TypeError('The native tier is registered from one options record naming every seam it forwards.');
	}
	for (const [seam, kind] of Object.entries(REQUIRED_SEAMS)) {
		if (options[seam] === null || typeof options[seam] !== kind) {
			throw new TypeError(`The native tier requires a ${kind} ${seam} seam from main.`);
		}
	}
	return options;
}
