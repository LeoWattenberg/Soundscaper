/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import test from 'node:test'
import React, { act } from 'react'

import NyquistNumberInput from '../src/common/editor/ui/dialogs/NyquistNumberInput.tsx'
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts'

for (const key of ['Enter', 'Escape']) for (const composing of [true, false]) {
	test(`Nyquist ${key} ${composing ? 'releases native composition' : 'retains completed draft behavior'}`, async () => {
		const dom = installReactTestDom()
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
		const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true
		const { createRoot } = await import('react-dom/client')
		const root = createRoot(dom.container as unknown as Element)
		let current = .8
		const writes: number[] = []
		const render = () => root.render(<NyquistNumberInput value={current} minimum={0} maximum={1}
			integer={false} disabled={false} onChange={value => { current = value; writes.push(value); render() }} />)
		try {
			await act(async () => render())
			const input = dom.one('input')
			await act(async () => { reactProps(input).onFocus() })
			const draft = key === 'Enter' ? '2' : '0.5'
			await act(async () => { reactProps(input).onChange({ currentTarget: { value: draft, valueAsNumber: Number(draft) } }) })
			const priorWrites = [...writes]
			let prevented = false; let stopped = false
			await act(async () => { reactProps(input).onKeyDown({ key, nativeEvent: { isComposing: composing },
				preventDefault() { prevented = true }, stopPropagation() { stopped = true } }) })
			if (composing) {
				assert.equal(input.value, draft)
				assert.deepEqual(writes, priorWrites)
				assert.equal(prevented || stopped, false)
				await act(async () => { reactProps(input).onKeyDown({ key: 'Escape', nativeEvent: { isComposing: false },
					preventDefault() {}, stopPropagation() {} }) })
				assert.equal(input.value, '0.8')
			} else {
				assert.equal(input.value, key === 'Enter' ? '1' : '0.8')
				assert.equal(current, key === 'Enter' ? 1 : .8)
				assert.equal(prevented, true)
				assert.equal(stopped, key === 'Escape')
			}
		} finally {
			await act(async () => root.unmount())
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct
			dom.restore()
		}
	})
}
