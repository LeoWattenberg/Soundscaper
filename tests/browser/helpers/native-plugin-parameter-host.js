/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect } from '../audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from '../audio-editor-test-helpers.js';

export async function openInstalledGain(page) {
	await installNativePluginParameterHost(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'recording.wav', duration: 1, channelCount: 2 })]);
	await chooseCommandAction(page, editor, 'Effect', 'Audio Plugins');
	const dialog = page.getByRole('dialog', { name: 'Audio Plugins', exact: true });
	await dialog.getByRole('button', { name: 'Test Gain', exact: true }).click();
	await dialog.locator('[data-native-plugin-instantiate="gain-install"]').click();
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.persisted)).toBe(1);
	return dialog;
}

/** Desktop host fixture over the production preload relay and plug-in RPC port. */
export async function installNativePluginParameterHost(page) {
	await page.addInitScript(() => {
		const values = [.25];
		const writes = [];
		const requests = [];
		const stateBodies = new Map();
		let delay = 0;
		let persisted = 0;
		const encoder = new TextEncoder();
		const hex = (bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
		const digest = async (bytes) => hex(await crypto.subtle.digest('SHA-256', bytes));
		const key = crypto.subtle.importKey('raw', encoder.encode('native-test-host-authentication-key'),
			{ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
		const authenticate = async (requestId, bytes) => ({ requestId, byteLength: bytes.byteLength,
			sha256: await digest(bytes), mac: hex(await crypto.subtle.sign('HMAC', await key,
				encoder.encode(`${requestId}:${await digest(bytes)}`))) });
		const binaryHash = digest(encoder.encode('Installed test gain plug-in, version 1'));
		const instance = async (instanceId) => ({ instanceId, entryId: 'gain', stablePluginId: 'org.test.gain',
			format: 'ladspa', binarySha256: await binaryHash, inputChannels: 2, outputChannels: 2,
			state: 'ready', enabled: true, bypassed: false, latencySamples: 0 });
		const refused = async () => { throw new Error('This host fixture does not offer that operation.'); };
		const quarantine = { loaded: true, degraded: false, records: [], pendingFaults: 0 };
		const registry = { entries: [{ entryId: 'gain', format: 'LADSPA', name: 'Test Gain', vendor: 'Test host',
			eligible: true, ineligibleReason: null, installations: [{ installationId: 'gain-install',
				version: '1', allowed: true, selected: true, quarantined: false }] }] };
		const plugins = { enabled: true, quarantined: false, payload: { status: 'available', reason: null },
			formats: [{ format: 'ladspa', consented: true }], consent: { scanningEnabled: true, formats: [{ format: 'ladspa', supported: true,
				granted: true, roots: [{ rootId: 'system-ladspa', origin: 'standard', name: 'LADSPA', admitted: true }] }] }, quarantine };
		Object.defineProperty(globalThis, '__nativePluginParameterHost', { configurable: true, value: {
			values, writes, requests, setDelay: (milliseconds) => { delay = milliseconds; },
			get persisted() { return persisted; },
		} });
		const bridge = {
			getExternalFfmpegStatus: async () => ({ state: 'unconfigured', location: null, version: null, detail: '',
				canInstall: false, canBrowse: false, canClear: false }),
			getEnvironment: async () => null, signalReady: async () => undefined,
			onMenuCommand: () => () => undefined, onOpenProject: () => () => undefined,
			onCloseRequested: () => () => undefined, onWindowStateChanged: () => () => undefined,
			readNativeTierControls: async () => ({ probeHelperEnabled: false, probeHelperQuarantined: false,
				audioHelperEnabled: false, audioHelperQuarantined: false, nativeEffectDiscoveryEnabled: true }),
			applyNativeTierControl: refused,
			nativeAudioHelperAvailability: async () => ({ enabled: false, quarantined: false,
				payload: { status: 'unavailable', reason: 'not-built' }, backends: [] }),
			setNativeAudioHelperEnabled: refused, describeNativeAudioBackend: refused,
			nativePluginAvailability: async () => plugins, setNativePluginConsent: refused,
			scanNativePlugins: refused, listNativePlugins: async () => registry,
			openNativeAudioSession: refused, bindNativeAudioSession: refused, nativeAudioSessionStatus: refused,
			calibrateNativeAudioSession: refused, reportNativeAudioSessionTransfer: refused,
			reportNativeAudioSessionLoss: refused, closeNativeAudioSession: refused,
			setNativePluginInstallationAllowed: refused, selectNativePluginInstallation: refused,
			instantiateNativePlugin: async ({ installationId, instanceId: requested }) => {
				if (installationId !== 'gain-install') throw new Error('The requested installation is absent.');
				const instanceId = requested || 'test-gain-1';
				const channel = new MessageChannel();
				channel.port1.onmessage = (event) => {
					const request = event.data;
					requests.push(request.kind);
					const reply = (fields, transfer = []) => channel.port1.postMessage({
						protocolVersion: 1, requestId: request.requestId, ...fields,
					}, transfer);
					if (request.kind === 'save-state') {
						const bytes = encoder.encode(JSON.stringify(values));
						void authenticate(request.requestId, bytes).then((authentication) => reply({
							kind: 'state', bytes, authentication,
						}, [bytes.buffer]));
					} else if (request.kind === 'load-state') {
						values.splice(0, values.length, ...JSON.parse(new TextDecoder().decode(request.bytes)));
						reply({ kind: 'state-loaded' });
					} else if (request.kind === 'capabilities') reply({ kind: 'capabilities', parameterCount: 1, hasVendorUi: false });
					else if (request.kind === 'parameters') reply({ kind: 'parameters', parameters: [{
						index: 0, id: 'gain', name: 'Gain', label: '', minimumValue: 0, maximumValue: 1,
						defaultValue: .25, flags: 8,
					}] });
					else if (request.kind === 'parameter-get') reply({ kind: 'parameter-value', index: request.index, value: values[request.index] });
					else if (request.kind === 'parameter-set') {
						writes.push(request.value);
						setTimeout(() => {
							values[request.index] = request.value;
							reply({ kind: 'parameter-value', index: request.index, value: request.value });
						}, delay);
					} else if (request.kind === 'process') {
						for (let c = 0; c < request.output.length; c += 1) {
							for (let i = 0; i < request.frameCount; i += 1) request.output[c][i] = (request.input[c]?.[i] || 0) * values[0];
						}
						reply({ kind: 'processed', frameCount: request.frameCount, input: request.input, output: request.output },
							[...request.input, ...request.output].map(({ buffer }) => buffer));
					}
				};
				channel.port1.start();
				window.postMessage({ type: 'soundscaper-native-plugin-rpc-port-v1', offer: { instanceId,
					purpose: 'plugin-rpc', transport: 'message-port', portContractVersion: 1, generation: 1,
					reportedLatencyFrames: 0 } }, '*', [channel.port2]);
				return instance(instanceId);
			},
			runNativePluginOffline: refused, setNativePluginBypassed: refused,
			persistNativePluginState: async ({ instanceId, bytes, authentication }) => {
				const expected = await authenticate(authentication.requestId, bytes);
				if (JSON.stringify(authentication) !== JSON.stringify(expected)) throw new Error('Unauthenticated plug-in state.');
				persisted += 1;
				stateBodies.set(expected.sha256, new Uint8Array(bytes));
				return { outcome: { status: 'persisted' }, projectState: {
					instanceId, format: 'ladspa', stablePluginId: 'org.test.gain', binarySha256: await binaryHash,
					stateBody: { kind: 'native-plugin-state', bodyId: `native-plugin-state:${expected.sha256}`,
						byteLength: bytes.byteLength, sha256: expected.sha256 },
					enabled: true, bypassed: false, continuity: 'live', latencySamples: 0,
				} };
			},
			restoreNativePluginState: async ({ instanceId, stateBody }) => {
				const bytes = stateBodies.get(stateBody.sha256);
				if (!bytes || bytes.byteLength !== stateBody.byteLength || await digest(bytes) !== stateBody.sha256) throw new Error('The requested saved state is absent.');
				return { bytes: new Uint8Array(bytes), projectState: { instanceId, format: 'ladspa',
					stablePluginId: 'org.test.gain', binarySha256: await binaryHash, stateBody,
					enabled: true, bypassed: false, continuity: 'live', latencySamples: 0 } };
			}, openNativePluginVendorUi: refused,
			closeNativePluginVendorUi: refused, closeNativePluginInstance: async () => true,
		};
		Object.defineProperty(globalThis, 'soundscaperDesktop', { configurable: true, value: Object.freeze({ v1: bridge }) });
	});
}
