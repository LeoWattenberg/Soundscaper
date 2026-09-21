/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import test from 'node:test'
import React, { act } from 'react'

import NativePluginParameterControls, {
	type NativePluginParameterRuntime,
} from '../src/common/editor/ui/dialogs/NativePluginParameterControls.tsx'
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts'

test('generated native plug-in controls read and write bounded normalized parameters', async () => {
	const dom = installReactTestDom()
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React')
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React })
	const { createRoot } = await import('react-dom/client')
	const root = createRoot(dom.container as unknown as Element)
	const writes: Readonly<{ index: number; value: number }>[] = []
	const values = [0.25, 0]
	const runtime: NativePluginParameterRuntime = Object.freeze({
		capabilities: async () => Object.freeze({ parameterCount: 2, hasVendorUi: false }),
		describeParameters: async () => Object.freeze([
			Object.freeze({
				index: 0, id: 'gain', name: 'Gain', label: 'dB', defaultValue: 0.5,
				minimumValue: 0, maximumValue: 1, flags: 8,
			}),
			Object.freeze({
				index: 1, id: 'invert', name: 'Invert', label: '', defaultValue: 0,
				minimumValue: 0, maximumValue: 1, flags: 9,
			}),
		]),
		readParameter: async (_instanceId: string, index: number) => values[index]!,
		writeParameter: async (_instanceId: string, index: number, value: number) => {
			writes.push(Object.freeze({ index, value }))
			values[index] = value
			return value
		},
	})
	try {
		await act(async () => root.render(<NativePluginParameterControls
			instanceId="ladspa-1" runtime={runtime} />))
		const controls = dom.container.querySelectorAll('[data-native-plugin-parameter]')
		assert.equal(controls.length, 2)
		assert.match(dom.container.textContent, /Gain/u)
		assert.match(dom.container.textContent, /Invert/u)
		const range = controls.find(({ type }) => type === 'range')
		const checkbox = controls.find(({ type }) => type === 'checkbox')
		assert.ok(range)
		assert.ok(checkbox)
		assert.equal(reactProps(range).value, 0.25)
		assert.equal(reactProps(checkbox).checked, false)
		await act(async () => { await reactProps(range).onChange({ currentTarget: { value: '0.75' } }) })
		await act(async () => { await reactProps(checkbox).onChange({ currentTarget: { checked: true } }) })
		assert.deepEqual(writes, [{ index: 0, value: 0.75 }, { index: 1, value: 1 }])
		assert.equal(reactProps(range).value, 0.75)
		assert.equal(reactProps(checkbox).checked, true)
		assert.equal(dom.find('[data-native-plugin-vendor-ui]'), null)
	} finally {
		await act(async () => root.unmount())
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact)
		else Reflect.deleteProperty(globalThis, 'React')
		dom.restore()
	}
})

test('native plug-in parameter controls stay absent when the host reports no parameters', async () => {
	const dom = installReactTestDom()
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true
	const { createRoot } = await import('react-dom/client')
	const root = createRoot(dom.container as unknown as Element)
	const runtime: NativePluginParameterRuntime = Object.freeze({
		capabilities: async () => Object.freeze({ parameterCount: 0, hasVendorUi: false }),
		describeParameters: async () => Object.freeze([]),
		readParameter: async () => { throw new Error('unreachable') },
		writeParameter: async () => { throw new Error('unreachable') },
	})
	try {
		await act(async () => root.render(<NativePluginParameterControls instanceId="empty-1" runtime={runtime} />))
		assert.equal(dom.container.textContent, '')
	} finally {
		await act(async () => root.unmount())
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct
		dom.restore()
	}
})
