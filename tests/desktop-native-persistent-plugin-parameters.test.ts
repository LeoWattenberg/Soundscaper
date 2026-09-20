/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createNativePersistentPluginJobRunner } from '../desktop/native-helper-persistent-plugin-job.js'

interface FakeMessageEvent { readonly data: unknown }

class FakePort {
	peer: FakePort | null = null
	readonly listeners = new Set<(event: FakeMessageEvent) => void>()

	postMessage(message: unknown): void {
		const event = Object.freeze({ data: message })
		queueMicrotask(() => { for (const listener of this.peer?.listeners ?? []) listener(event) })
	}

	on(_event: 'message', listener: (event: FakeMessageEvent) => void): void { this.listeners.add(listener) }
	off(_event: 'message', listener: (event: FakeMessageEvent) => void): void { this.listeners.delete(listener) }
	start(): void {}
	close(): void {}
}

function channel(): Readonly<{ host: FakePort; renderer: FakePort }> {
	const host = new FakePort()
	const renderer = new FakePort()
	host.peer = renderer
	renderer.peer = host
	return Object.freeze({ host, renderer })
}

function nextMessage(port: FakePort): Promise<Record<string, unknown>> {
	return new Promise((resolve) => {
		const listener = (event: FakeMessageEvent) => {
			port.off('message', listener)
			resolve(event.data as Record<string, unknown>)
		}
		port.on('message', listener)
	})
}

const PLUGIN_GRANT = Object.freeze({
	binaryPath: '/effects/gain.so', binaryBytes: 10, binarySha256: 'd'.repeat(64),
	format: 'ladspa', stableId: 'ladspa:gain', identity: Object.freeze({ dev: 1, ino: 2 }),
	persistentPort: Object.freeze({
		portContractVersion: 1, transport: 'message-port', purpose: 'plugin-rpc',
		streamId: 'e'.repeat(40), generation: 1, maximumMessageBytes: 16 * 1_024 * 1_024,
		maximumInFlightMessages: 8,
	}),
})

const RESOURCE_POLICY = Object.freeze({
	maximumInputBytes: 16 * 1_024 * 1_024, maximumJobDurationMs: 60_000,
	maximumRssBytes: 512 * 1_024 * 1_024, allowNetwork: false as const,
	allowChildProcesses: false as const, allowOutputFiles: false as const,
})

test('persistent plug-in runner exposes bounded generated parameter controls', async () => {
	const link = channel()
	let value = 0.5
	const parameter = Object.freeze({
		index: 0, id: 'gain', name: 'Gain', label: '', defaultValue: 0.5,
		minimumValue: 0, maximumValue: 1, flags: 8,
	})
	const runner = createNativePersistentPluginJobRunner({
		addonPath: '/addon.node', addonSha256: 'f'.repeat(64),
		hashFile: async () => ({ byteLength: 10, sha256: 'd'.repeat(64) }),
		loadAddon: async () => ({
			openPluginInstance: () => Object.freeze({}), closePluginInstance: () => true,
			pluginLatencyFrames: () => 0,
			pluginCapabilities: () => ({ parameterCount: 1, hasVendorUi: false }),
			describePluginParameters: () => [parameter], readPluginParameter: () => value,
			writePluginParameter: (_instance: unknown, index: number, next: number) => {
				assert.equal(index, 0)
				value = next
				return value
			},
		}),
	})
	const handle = runner({ grant: PLUGIN_GRANT, ports: [link.host], resourcePolicy: RESOURCE_POLICY })
	let response = nextMessage(link.renderer)
	link.renderer.postMessage({
		protocolVersion: 1, kind: 'configure', sampleRate: 48_000, maximumFrames: 1_024,
		stateAuthenticationKey: '0'.repeat(64),
	})
	assert.equal((await response).kind, 'configured')
	response = nextMessage(link.renderer)
	link.renderer.postMessage({ protocolVersion: 1, kind: 'capabilities', requestId: 'capabilities-1' })
	assert.deepEqual(await response, {
		protocolVersion: 1, kind: 'capabilities', requestId: 'capabilities-1',
		parameterCount: 1, hasVendorUi: false,
	})
	response = nextMessage(link.renderer)
	link.renderer.postMessage({ protocolVersion: 1, kind: 'parameters', requestId: 'parameters-1' })
	assert.deepEqual(await response, {
		protocolVersion: 1, kind: 'parameters', requestId: 'parameters-1', parameters: [parameter],
	})
	response = nextMessage(link.renderer)
	link.renderer.postMessage({
		protocolVersion: 1, kind: 'parameter-set', requestId: 'parameter-set-1', index: 0, value: 0.75,
	})
	assert.deepEqual(await response, {
		protocolVersion: 1, kind: 'parameter-value', requestId: 'parameter-set-1', index: 0, value: 0.75,
	})
	response = nextMessage(link.renderer)
	link.renderer.postMessage({
		protocolVersion: 1, kind: 'parameter-get', requestId: 'parameter-get-1', index: 0,
	})
	assert.equal((await response).value, 0.75)
	link.renderer.postMessage({ protocolVersion: 1, kind: 'close', reason: 'editor-shutdown' })
	assert.equal((await handle.completion).reason, 'editor-shutdown')
})
