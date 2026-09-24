/* SPDX-License-Identifier: AGPL-3.0-only */

/** Dependency-free protocol shared by the renderer node and its AudioWorklet. */

export const NATIVE_PLUGIN_WORKLET_NAME = 'soundscaper-native-plugin-v1';
export const NATIVE_PLUGIN_PIPELINE_BLOCKS = 4;
export const NATIVE_PLUGIN_CONTROL = Object.freeze({
	attach: 'native-plugin-attach', bypass: 'native-plugin-bypass', revoke: 'native-plugin-revoke',
	latency: 'native-plugin-latency', fault: 'native-plugin-fault', attached: 'native-plugin-attached',
	renderStatus: 'native-plugin-render-status', renderStatusResult: 'native-plugin-render-status-result',
	saveState: 'native-plugin-save-state', loadState: 'native-plugin-load-state',
	state: 'native-plugin-state', stateLoaded: 'native-plugin-state-loaded',
	openVendorUi: 'native-plugin-open-vendor-ui', closeVendorUi: 'native-plugin-close-vendor-ui',
	vendorUi: 'native-plugin-vendor-ui',
	capabilities: 'native-plugin-capabilities', capabilitiesResult: 'native-plugin-capabilities-result',
	describeParameters: 'native-plugin-describe-parameters', parameters: 'native-plugin-parameters',
	readParameter: 'native-plugin-read-parameter', writeParameter: 'native-plugin-write-parameter',
	parameterValue: 'native-plugin-parameter-value',
});
