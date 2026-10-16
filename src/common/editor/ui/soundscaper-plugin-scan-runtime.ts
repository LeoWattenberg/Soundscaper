/* SPDX-License-Identifier: AGPL-3.0-only */

import { createNativePluginScanController, type NativePluginScanController } from '../controller/effects/native-plugin-scan-controller.ts';
import { soundscaperNativeServicesStoreFor, type SoundscaperNativeServicesBridge } from './soundscaper-native-services-bridge.ts';

const SCANNERS = new WeakMap<SoundscaperNativeServicesBridge, NativePluginScanController>();

/** Preferences and the toast share one batch, even while the dialog is closed. */
export function soundscaperPluginScanRuntimeFor(bridge: SoundscaperNativeServicesBridge): NativePluginScanController {
	const existing = SCANNERS.get(bridge);
	if (existing) return existing;
	const scanner = createNativePluginScanController(bridge);
	SCANNERS.set(bridge, scanner);
	const tier = soundscaperNativeServicesStoreFor(bridge);
	tier.subscribe(() => {
		const snapshot = tier.getSnapshot();
		if (snapshot !== null) scanner.setEnabled(snapshot.pluginEnabled);
	});
	return scanner;
}
