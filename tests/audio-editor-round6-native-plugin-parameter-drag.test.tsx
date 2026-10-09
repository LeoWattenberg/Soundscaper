/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import test from 'node:test'
import React, { act } from 'react'
import type { Root } from 'react-dom/client'

import NativePluginParameterControls, {
	type NativePluginParameterRuntime,
} from '../src/common/editor/ui/dialogs/NativePluginParameterControls.tsx'
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts'
import { useNativePluginParameterClose } from '../src/common/editor/ui/dialogs/useNativePluginParameterClose.ts'

interface PendingWrite {
	readonly instanceId: string
	readonly index: number
	readonly value: number
	readonly resolve: (value: number) => void
	readonly reject: (error: Error) => void
}

interface Fixture {
	readonly root: Root
	readonly writes: PendingWrite[]
	readonly input: (id: string) => ReactTestElement
	readonly runtime: NativePluginParameterRuntime
	readonly text: () => string
	readonly render: (instanceId?: string, disabled?: boolean) => Promise<void>
	readonly close: () => Promise<void>
	readonly closes: () => number
	readonly settle: (index: number) => Promise<void>
	readonly change: (id: string, value: number | boolean) => Promise<void>
}

function ControlHost({ runtime, instanceId, disabled, onClose }: {
	readonly runtime: NativePluginParameterRuntime
	readonly instanceId: string
	readonly disabled: boolean
	readonly onClose: () => void
}) {
	const close = useNativePluginParameterClose(instanceId, onClose)
	return <><NativePluginParameterControls instanceId={instanceId} runtime={runtime} disabled={disabled} />
		<button data-native-host-close onClick={close}>Close</button></>
}

async function fixture(run: (value: Fixture) => Promise<void>): Promise<void> {
	const dom = installReactTestDom()
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React')
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React })
	const { createRoot } = await import('react-dom/client')
	const root = createRoot(dom.container as unknown as Element)
	const writes: PendingWrite[] = []
	let closes = 0
	const onClose = () => { closes += 1 }
	const runtime: NativePluginParameterRuntime = {
		capabilities: async () => ({ parameterCount: 2, hasVendorUi: false }),
		describeParameters: async () => [
			{ index: 0, id: 'gain', name: 'Gain', label: '', defaultValue: .25, minimumValue: 0, maximumValue: 1, flags: 8 },
			{ index: 1, id: 'invert', name: 'Invert', label: '', defaultValue: 0, minimumValue: 0, maximumValue: 1, flags: 9 },
		],
		readParameter: async (_instanceId, index) => index === 0 ? .25 : 0,
		writeParameter: (instanceId, index, value) => new Promise<number>((resolve, reject) => {
			writes.push({ instanceId, index, value, resolve, reject })
		}),
	}
	const input = (id: string): ReactTestElement => {
		const found = dom.container.querySelectorAll('[data-native-plugin-parameter]')
			.find((node) => node.getAttribute('data-native-plugin-parameter') === id)
		assert.ok(found)
		return found
	}
	const render = async (instanceId = 'gain-1', disabled = false) => {
		await act(async () => root.render(<ControlHost instanceId={instanceId} disabled={disabled} runtime={runtime} onClose={onClose} />))
	}
	try {
		await render()
		await run({ root, writes, input, runtime, render, closes: () => closes, text: () => dom.container.textContent,
			close: async () => {
				const button = dom.container.querySelectorAll('[data-native-host-close]')[0]
				assert.ok(button)
				await act(async () => { reactProps(button).onClick() })
			},
			settle: async (index) => {
				const request = writes[index]
				assert.ok(request)
				await act(async () => request.resolve(request.value))
			},
			change: async (id, value) => {
				await act(async () => { reactProps(input(id)).onChange({
					currentTarget: typeof value === 'boolean' ? { checked: value } : { value: String(value) },
				}) })
			},
		})
	} finally {
		await act(async () => root.unmount())
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact)
		else Reflect.deleteProperty(globalThis, 'React')
		dom.restore()
	}
}

test('native parameter drag serializes writes and delivers its latest position after a pending response', async () => {
	await fixture(async ({ change, writes, settle, input }) => {
		await change('gain', .4)
		await change('gain', .6)
		await change('gain', .9)
		assert.deepEqual(writes.map(({ value }) => value), [.4])
		await settle(0)
		assert.deepEqual(writes.map(({ value }) => value), [.4, .9])
		assert.equal(reactProps(input('gain')).value, .9, 'an older acknowledgement must retain the latest draft')
		assert.equal(reactProps(input('gain')).disabled, false)
		await settle(1)
		assert.equal(reactProps(input('gain')).value, .9)
	})
})

test('another native parameter remains editable while a host write is pending', async () => {
	await fixture(async ({ change, writes, settle, input }) => {
		await change('gain', .4)
		await change('invert', true)
		await settle(0)
		assert.deepEqual(writes.map(({ index, value }) => ({ index, value })), [{ index: 0, value: .4 }, { index: 1, value: 1 }])
		await settle(1)
		assert.equal(reactProps(input('invert')).checked, true)
	})
})

test('disabled native parameter controls admit no host writes', async () => {
	await fixture(async ({ render, change, writes }) => {
		await render('gain-1', true)
		await change('gain', .9)
		assert.equal(writes.length, 0)
	})
})

test('a disabled native parameter owner discards queued writes before the first response arrives', async () => {
	await fixture(async ({ render, change, settle, writes, input }) => {
		await change('gain', .4)
		await change('gain', .9)
		await change('invert', true)
		await render('gain-1', true)
		assert.equal(reactProps(input('invert')).checked, false)
		await settle(0)
		assert.equal(writes.length, 1)
		assert.equal(reactProps(input('gain')).value, .4)
	})
})

test('changing native instances retires pending writes without modifying the replacement controls', async () => {
	await fixture(async ({ render, change, settle, writes, input }) => {
		await change('gain', .4)
		await change('gain', .9)
		await render('gain-2')
		await settle(0)
		assert.equal(writes.length, 1)
		assert.equal(reactProps(input('gain')).value, .25)
	})
})

test('disposing native controls retires queued host writes', async () => {
	await fixture(async ({ root, change, settle, writes }) => {
		await change('gain', .4)
		await change('gain', .9)
		await act(async () => root.unmount())
		await settle(0)
		assert.equal(writes.length, 1)
	})
})

test('ordinary native Close waits for every accepted parameter position and completes once', async () => {
	await fixture(async ({ change, settle, writes, close, closes }) => {
		await change('gain', .4)
		await change('gain', .9)
		await close()
		await close()
		assert.equal(closes(), 0)
		await settle(0)
		assert.equal(writes[1]?.value, .9)
		assert.equal(closes(), 0)
		await settle(1)
		assert.equal(closes(), 1)
	})
})

test('a pending native Close loses authority when the selected instance is replaced', async () => {
	await fixture(async ({ change, settle, close, closes, render }) => {
		await change('gain', .4)
		await close()
		await render('gain-2')
		await settle(0)
		assert.equal(closes(), 0)
	})
})

test('double-click reset remains the last native parameter request during an earlier write', async () => {
	await fixture(async ({ change, settle, writes, input }) => {
		await change('gain', .9)
		await act(async () => { reactProps(input('gain')).onDoubleClick({ preventDefault() {}, stopPropagation() {} }) })
		await settle(0)
		assert.deepEqual(writes.map(({ value }) => value), [.9, .25])
		await settle(1)
		assert.equal(reactProps(input('gain')).value, .25)
	})
})

test('an actual native host rejection reports failure and discards later queued changes', async () => {
	await fixture(async ({ change, writes, text, close, closes }) => {
		await change('gain', .4)
		await change('gain', .9)
		await close()
		await act(async () => writes[0]!.reject(new Error('The host refused this write.')))
		assert.equal(writes.length, 1)
		assert.match(text(), /The host refused this write\./u)
		assert.equal(closes(), 0)
		await close()
		assert.equal(closes(), 1)
	})
})
