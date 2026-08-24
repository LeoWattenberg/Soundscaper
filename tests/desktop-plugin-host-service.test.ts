/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { DesktopPluginHostService } from '../desktop/plugin-host-service.ts'
import {
	PluginHostIsolationRegistry,
	type PluginHostLaunch,
} from '../desktop/plugin-host-isolation.ts'
import {
	DesktopPluginRegistry,
	type PluginRegistryAdmission,
} from '../desktop/plugin-registry.ts'

const BINARY_SHA256 = 'ab'.repeat(32)
const OWNER = {}

function installationId(admission: PluginRegistryAdmission): string {
	assert.equal(admission.status, 'recorded')
	if (admission.status !== 'recorded') throw new Error('unreachable')
	return admission.installationId
}

function harness(options: { unstableLatency?: boolean } = {}) {
	const launches: PluginHostLaunch[] = []
	const opened: unknown[] = []
	const closed: string[] = []
	const killed: string[] = []
	const pdc: number[] = []
	let minted = 0
	const registry = new DesktopPluginRegistry({ isQuarantined: () => false })
	const installation = installationId(registry.record({
		format: 'vst3', stableId: 'org.example.native-effect', bundleStableIds: ['org.example.native-effect'],
		name: 'Native effect',
		vendor: 'Example', version: '1.0.0', platform: 'linux', architecture: 'x64',
		binaryPath: '/usr/lib/vst3/native-effect.vst3', binaryBytes: 4_096,
		binarySha256: BINARY_SHA256, identity: { dev: 1, ino: 2 }, classification: 'effect',
		topologies: [{ inputChannels: 2, outputChannels: 2 }], realtimeSupported: true,
		offlineSupported: true, reportedLatencyFrames: 64, signature: 'trusted',
		compatibility: 'compatible', descriptorVersion: 1,
	}))
	const isolation = new PluginHostIsolationRegistry({
		isEnabled: () => true,
		mintId: () => `opaque_${String(++minted).padStart(4, '0')}`,
		startHost: async (launch) => {
			launches.push(launch)
			return {
				kill: () => { killed.push(launch.hostId) },
				openVendorUi: (request) => { opened.push(request); return request.windowHandleId },
				closeVendorUi: (windowId) => { closed.push(windowId) },
			}
		},
	})
	const bodies = new Map<string, Uint8Array>()
	const service = new DesktopPluginHostService({
		registry,
		isolation,
		stateBodies: {
			persist(bytes) {
				const copy = Uint8Array.from(bytes)
				const sha256 = createHash('sha256').update(copy).digest('hex')
				const bodyId = `native-plugin-state:${sha256}`
				bodies.set(bodyId, copy)
				return Object.freeze({ kind: 'native-plugin-state' as const, bodyId, byteLength: copy.byteLength, sha256 })
			},
			read(bodyId) {
				const bytes = bodies.get(bodyId)
				if (!bytes) return null
				const sha256 = bodyId.slice('native-plugin-state:'.length)
				return Object.freeze({ bytes: Uint8Array.from(bytes), byteLength: bytes.byteLength, sha256 })
			},
		},
		offline: {
			run: async () => ({
				reportedLatencyFrames: 128, latencyStable: !options.unstableLatency,
				blocksRendered: 8, renderedSha256: 'cd'.repeat(32), stateBytes: 4,
				stateRefusal: null,
			}),
		},
		onLatencyChanged: (_instanceId, latency) => { pdc.push(latency) },
	})
	return { service, installation, launches, opened, closed, killed, pdc, bodies }
}

test('plug-in service keeps paths private and isolates one owner plus digest host', async () => {
	const fixture = harness()
	const first = await fixture.service.instantiate(OWNER, {
		installationId: fixture.installation, instanceId: null, sampleRate: 48_000,
	})
	const second = await fixture.service.instantiate(OWNER, {
		installationId: fixture.installation, instanceId: null, sampleRate: 48_000,
	})
	assert.equal(fixture.launches.length, 1)
	assert.equal(JSON.stringify(first).includes('/usr/lib'), false)
	assert.equal(first.binarySha256, BINARY_SHA256)
	assert.deepEqual([first.inputChannels, first.outputChannels], [2, 2])
	assert.notEqual(first.instanceId, second.instanceId)
	await assert.rejects(() => fixture.service.instantiate({}, {
		installationId: '/usr/lib/vst3/native-effect.vst3', instanceId: null, sampleRate: 48_000,
	}), /opaque plug-in installation ID/iu)
})

test('plug-in state is content addressed, survives restore, and supplies exact PDC latency', async () => {
	const fixture = harness()
	const instance = await fixture.service.instantiate(OWNER, {
		installationId: fixture.installation, instanceId: 'effect_instance_01', sampleRate: 48_000,
	})
	const persisted = fixture.service.persistState(OWNER, {
		instanceId: instance.instanceId, generation: 1, bytes: Uint8Array.from([1, 2, 3, 4]),
	})
	assert.equal(persisted.outcome.status, 'persisted')
	assert.ok(persisted.projectState)
	assert.equal(persisted.projectState?.stateBody.bodyId,
		`native-plugin-state:${persisted.projectState?.stateBody.sha256}`)
	assert.equal(fixture.bodies.size, 1)
	const restored = fixture.service.restoreState(OWNER, {
		instanceId: instance.instanceId, generation: 2,
		stateBody: persisted.projectState?.stateBody,
	})
	assert.equal(restored.stateBody.sha256, persisted.projectState?.stateBody.sha256)
	const rendered = await fixture.service.runOffline(OWNER, instance.instanceId)
	assert.equal(rendered.blocksRendered, 8)
	assert.equal(rendered.instance.latencySamples, 128)
	assert.deepEqual(fixture.pdc, [64, 128])
})

test('a vendor window closes only through the instance that owns it', async () => {
	const fixture = harness()
	const first = await fixture.service.instantiate(OWNER, {
		installationId: fixture.installation, instanceId: 'vendor_owner_01', sampleRate: 48_000,
	})
	const second = await fixture.service.instantiate(OWNER, {
		installationId: fixture.installation, instanceId: 'vendor_owner_02', sampleRate: 48_000,
	})
	const outcome = fixture.service.openVendorUi(OWNER, first.instanceId)
	assert.equal(outcome.status, 'opened')
	if (outcome.status !== 'opened') return
	// Authorizing one instance must not close another instance's window.
	assert.equal(fixture.service.closeVendorUi(OWNER, {
		instanceId: second.instanceId, windowHandleId: outcome.window.windowHandleId,
	}), false)
	assert.deepEqual(fixture.closed, [])
	assert.equal(fixture.service.closeVendorUi(OWNER, {
		instanceId: first.instanceId, windowHandleId: outcome.window.windowHandleId,
	}), true)
	assert.deepEqual(fixture.closed, [outcome.window.windowHandleId])
})

test('closing an instance releases its retained opaque state with it', async () => {
	const fixture = harness()
	const instance = await fixture.service.instantiate(OWNER, {
		installationId: fixture.installation, instanceId: 'closing_instance_01', sampleRate: 48_000,
	})
	const persisted = fixture.service.persistState(OWNER, {
		instanceId: instance.instanceId, generation: 1, bytes: Uint8Array.from([9, 9, 9, 9]),
	})
	assert.equal(persisted.outcome.status, 'persisted')
	assert.equal(fixture.service.close(OWNER, instance.instanceId), true)
	// A re-acquired instance id must start clean: retained state left behind
	// filled the retention ceiling with orphans and bound plug-in A's state
	// summary to whatever occupied the id next.
	const reacquired = await fixture.service.instantiate(OWNER, {
		installationId: fixture.installation, instanceId: 'closing_instance_01', sampleRate: 48_000,
	})
	assert.equal(reacquired.opaqueState.retained, null,
		'a closed instance must not bequeath its opaque state to the next occupant')
	fixture.service.close(OWNER, reacquired.instanceId)
})

test('vendor UI is helper-owned and crash continuity retains state as bypass', async () => {
	const fixture = harness()
	const instance = await fixture.service.instantiate(OWNER, {
		installationId: fixture.installation, instanceId: 'effect_instance_02', sampleRate: 48_000,
	})
	fixture.service.persistState(OWNER, {
		instanceId: instance.instanceId, generation: 1, bytes: Uint8Array.from([7]),
	})
	const opened = fixture.service.openVendorUi(OWNER, instance.instanceId)
	assert.equal(opened.status, 'opened')
	if (opened.status !== 'opened') return
	assert.equal(opened.window.surface, 'helper-owned-top-level')
	assert.equal(fixture.opened.length, 1)
	assert.equal(fixture.service.closeVendorUi(OWNER, {
		instanceId: instance.instanceId, windowHandleId: opened.window.windowHandleId,
	}), true)
	assert.deepEqual(fixture.closed, [opened.window.windowHandleId])
	const continuity = fixture.service.reportHostStopped({
		hostId: fixture.launches[0]?.hostId, reason: 'crash',
	})
	assert.equal(continuity[0]?.mode, 'bypass')
	assert.ok(continuity[0]?.opaqueState)
	assert.throws(() => fixture.service.reportHostStopped({
		hostId: fixture.launches[0]?.hostId, reason: 'friendly-exit',
	}), /closed native plug-in host stop reason/iu)
})

test('unstable reported latency faults and bypasses instead of changing PDC', async () => {
	const fixture = harness({ unstableLatency: true })
	const instance = await fixture.service.instantiate(OWNER, {
		installationId: fixture.installation, instanceId: null, sampleRate: 48_000,
	})
	await assert.rejects(() => fixture.service.runOffline(OWNER, instance.instanceId), /unstable latency/iu)
	assert.equal(fixture.pdc.at(-1), 64)
	assert.equal(fixture.service.setBypassed(OWNER, {
		instanceId: instance.instanceId, bypassed: false,
	}).bypassed, false)
})
