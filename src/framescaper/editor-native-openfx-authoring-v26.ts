/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bind renderer-authored V26 state to one exact main-owned plug-in projection. */

import {
	assertOfxEffectStateV26,
	type OfxEffectStateV26,
} from '../common/editor/native-ofx-state-v26.ts';
import {
	framescaperOpenFxPluginProjectionV1,
	type FramescaperOpenFxPluginProjectionV1,
} from '../common/editor/native-ofx-service-contract.ts';

export function attestFramescaperOpenFxEffectV26(
	pluginValue: unknown,
	effectValue: unknown,
): OfxEffectStateV26 {
	const plugin = framescaperOpenFxPluginProjectionV1(pluginValue);
	if (plugin.state !== 'enabled' || plugin.quarantined) {
		throw new Error('The exact OpenFX binary must be explicitly enabled and outside quarantine.');
	}
	const effect = structuredClone(effectValue);
	assertOfxEffectStateV26(effect);
	if (effect.pluginId !== plugin.pluginId || effect.binarySha256 !== plugin.binarySha256
		|| !plugin.supportedContexts.includes(effect.context)) {
		throw new Error('The authored OpenFX state does not match the selected binary fingerprint and context.');
	}
	const parameters = new Map(plugin.parameters.map((parameter) => [parameter.name, parameter]));
	for (const parameter of effect.parameters) {
		const descriptor = parameters.get(parameter.name);
		if (!descriptor || descriptor.type !== parameter.type
			|| (!descriptor.animates && parameter.keyframes.length !== 0)) {
			throw new Error('The authored OpenFX state exceeds the scanned parameter contract.');
		}
	}
	return effect;
}

export type { FramescaperOpenFxPluginProjectionV1 };
