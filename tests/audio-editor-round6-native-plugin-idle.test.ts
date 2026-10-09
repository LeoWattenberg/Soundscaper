/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import test from 'node:test'

import { NATIVE_PLUGIN_CONTROL, NativePluginRealtimeProcessor } from '../src/common/editor/native-plugin-realtime-worklet.js'

interface Packet {
	readonly [field: string]: unknown
	readonly kind?: string
	readonly requestId?: string
	readonly input?: Float32Array[]
	readonly output?: Float32Array[]
}
interface Peer {
	onmessage: ((event: { data: Packet }) => void) | null
	postMessage: (message: Packet) => void
	start: () => void
	close: () => void
}
interface Processor {
	readonly port: {
		postMessage: (message: Packet) => void
		onmessage: (event: { data: Packet; ports: Peer[] }) => void
	}
	process: (input: Float32Array[][], output: Float32Array[][]) => boolean
}
const Processor = NativePluginRealtimeProcessor as unknown as new (options: {
	processorOptions: { instanceId: string; inputChannelCount: number; outputChannelCount: number; strictRender: boolean }
}) => Processor

function attached(strictRender = false) {
	const processor = new Processor({ processorOptions: {
		instanceId: 'native-idle-1', inputChannelCount: 2, outputChannelCount: 2, strictRender,
	} })
	const control: Packet[] = []
	const processed: Packet[] = []
	processor.port.postMessage = (message) => { control.push(message) }
	const peer: Peer = {
		onmessage: null, start() {}, close() {},
		postMessage(message) {
			if (message.kind === 'process') {
				processed.push({ ...message, input: message.input?.map((plane) => plane.slice()) })
				for (const channel of message.output ?? []) channel.fill(.125)
				this.onmessage?.({ data: { ...message, kind: 'processed' } })
			} else if (message.kind === 'capabilities') {
				this.onmessage?.({ data: { protocolVersion: 1, requestId: message.requestId,
					kind: 'capabilities', parameterCount: 1, hasVendorUi: false } })
			}
		},
	}
	processor.port.onmessage({ data: { type: NATIVE_PLUGIN_CONTROL.attach, generation: 1 }, ports: [peer] })
	return { processor, control, processed }
}

test('idle live native plug-in accepts disconnected Web Audio inputs as declared-width silence', () => {
	const { processor, control, processed } = attached()
	const output = [new Float32Array(128), new Float32Array(128)]
	for (let block = 0; block < 5; block += 1) processor.process([[]], [output])
	assert.equal(control.some(({ type }) => type === NATIVE_PLUGIN_CONTROL.fault), false)
	assert.equal(processed.length, 5)
	assert.equal(processed[0]?.input?.length, 2)
	assert.ok(processed.every(({ input }) => input?.every((plane) => plane.every((sample) => sample === 0))))
	assert.deepEqual(output.map((channel) => channel[0]), [.125, .125], 'native tails continue through idle silence')
	processor.port.onmessage({ data: { type: NATIVE_PLUGIN_CONTROL.capabilities, requestId: 'capabilities-1' }, ports: [] })
	assert.ok(control.some(({ type }) => type === NATIVE_PLUGIN_CONTROL.capabilitiesResult))
	processor.process([[new Float32Array(128).fill(.5), new Float32Array(128).fill(.25)]], [output])
	assert.deepEqual(processed.at(-1)?.input?.map((channel) => channel[0]), [.5, .25])
})

test('strict native render still refuses missing input channels instead of publishing silence', () => {
	const { processor, control } = attached(true)
	processor.process([[]], [[new Float32Array(128), new Float32Array(128)]])
	assert.ok(control.some(({ type, reason }) => type === NATIVE_PLUGIN_CONTROL.fault && reason === 'topology-mismatch'))
})

test('live native plug-in still refuses a nonempty topology change', () => {
	const { processor, control } = attached()
	processor.process([[new Float32Array(128)]], [[new Float32Array(128), new Float32Array(128)]])
	assert.ok(control.some(({ type, reason }) => type === NATIVE_PLUGIN_CONTROL.fault && reason === 'topology-mismatch'))
})
