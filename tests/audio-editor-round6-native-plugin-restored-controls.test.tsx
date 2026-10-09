/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import test from 'node:test'
import React, { act } from 'react'
import type { Root } from 'react-dom/client'

import NativePluginParameterControls, { type NativePluginParameterRuntime } from '../src/common/editor/ui/dialogs/NativePluginParameterControls.tsx'
import { installReactTestDom, reactProps, type ReactTestDom } from './helpers/react-test-dom.ts'

interface Fixture {
	readonly dom: ReactTestDom
	readonly reads: number[]
	readonly values: number[]
	readonly render: (stateGeneration: number, disabled?: boolean) => Promise<void>
	readonly gain: () => unknown
}

async function fixture(run: (value: Fixture) => Promise<void>): Promise<void> {
	const dom = installReactTestDom()
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React')
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React })
	const { createRoot } = await import('react-dom/client')
	const root: Root = createRoot(dom.container as unknown as Element)
	const values = [.25, 0]
	const reads: number[] = []
	const runtime: NativePluginParameterRuntime = {
		capabilities: async () => ({ parameterCount: 2, hasVendorUi: false }),
		describeParameters: async () => [
			{ index: 0, id: 'gain', name: 'Gain', label: '', defaultValue: .25, minimumValue: 0, maximumValue: 1, flags: 8 },
			{ index: 1, id: 'invert', name: 'Invert', label: '', defaultValue: 0, minimumValue: 0, maximumValue: 1, flags: 9 },
		],
		readParameter: async (_instanceId, index) => { reads.push(index); return values[index]! },
		writeParameter: async (_instanceId, index, value) => { values[index] = value; return value },
	}
	const render = async (stateGeneration: number, disabled = false) => {
		const props = { instanceId: 'gain-1', runtime, stateGeneration, disabled }
		await act(async () => root.render(<NativePluginParameterControls {...props} />))
	}
	try {
		await render(1)
		await run({ dom, reads, values, render, gain: () => reactProps(dom.one('[data-native-plugin-parameter="gain"]')).value })
	} finally {
		await act(async () => root.unmount())
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact)
		else Reflect.deleteProperty(globalThis, 'React')
		dom.restore()
	}
}

test('restored same-instance native state republishes every generated parameter', async () => {
	await fixture(async ({ values, render, gain, dom }) => {
		assert.equal(gain(), .25)
		values[0] = .75; values[1] = 1
		await render(2)
		assert.equal(gain(), .75)
		assert.equal(reactProps(dom.one('[data-native-plugin-parameter="invert"]')).checked, true)
	})
})

test('an unrelated disabled presentation update does not reread a native parameter draft', async () => {
	await fixture(async ({ values, render, gain, reads }) => {
		assert.deepEqual(reads, [0, 1])
		values[0] = .75
		await render(1, true)
		await render(1)
		assert.equal(gain(), .25)
		assert.deepEqual(reads, [0, 1])
	})
})
