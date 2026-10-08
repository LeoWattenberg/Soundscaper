/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { SequenceTimingProjectProperties } from '../src/common/editor/ui/toolbar/SequenceTimingControls.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

for (const field of ['name', 'timecode'] as const) {
	test(`the production sequence ${field} field cancels before blur and commits Enter once`, async () => {
		const fixture = await mountSequenceFields();
		try {
			const input = fixture.field(field);
			const original = input.value;
			const changed = field === 'name' ? 'Changed sequence' : '00:00:01:00';
			await fixture.change(input, changed);
			await fixture.key(input, 'Escape');
			assert.equal(input.value, original, 'Escape restores the saved field');
			assert.equal(fixture.updates.length, 0, 'cancel-triggered blur cannot save its stale draft');

			await fixture.change(input, changed);
			await fixture.key(input, 'Enter');
			assert.equal(fixture.updates.length, 1, 'Enter performs one ordinary blur commit');
			assert.deepEqual(fixture.updates[0], field === 'name' ? { name: changed } : {
				startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 1, frames: 0 },
			});
		} finally { await fixture.cleanup(); }
	});
}

test('sequence fields retain composition and invalid timecode admission', async () => {
	const fixture = await mountSequenceFields();
	try {
		const name = fixture.field('name');
		await fixture.change(name, 'Composing sequence');
		await fixture.key(name, 'Enter', true);
		assert.equal(fixture.updates.length, 0);
		assert.equal(name.value, 'Composing sequence');
		const timecode = fixture.field('timecode');
		await fixture.change(timecode, 'bad');
		await fixture.key(timecode, 'Enter');
		assert.equal(fixture.updates.length, 0);
		assert.equal(timecode.getAttribute('aria-invalid'), 'true');
		await fixture.key(timecode, 'Escape');
		assert.equal(timecode.value, '00:00:00:00');
		assert.equal(timecode.getAttribute('aria-invalid'), 'false');
	} finally { await fixture.cleanup(); }
});

async function mountSequenceFields() {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const updates: unknown[] = [];
	await act(async () => root.render(<SequenceTimingProjectProperties
		project={{ primarySequenceId: 'primary', sequences: [{ id: 'primary', name: 'Main sequence',
			rate: { num: 25, den: 1 }, startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 }, dropFrame: false }] }}
		snapshot={{ readOnly: false, recording: false }} copy={ENGLISH_COPY}
		controller={{ actions: { sequences: { update: (_id: string, changes: unknown) => { updates.push(changes); } } } }}
		run={(operation: () => unknown) => operation()} />));
	return {
		updates,
		field: (field: 'name' | 'timecode') => {
			const input = field === 'name' ? dom.one('input') : dom.one('[data-sequence-start-timecode]');
			// A real native blur synchronously sends React its owning onBlur callback.
			input.blur = () => { reactProps(input).onBlur({ currentTarget: input }); };
			return input;
		},
		change: async (input: ReactTestElement, value: string) => act(async () => {
			input.value = value;
			reactProps(input).onChange?.({ currentTarget: input });
		}),
		key: async (input: ReactTestElement, key: string, isComposing = false) => act(async () => {
			reactProps(input).onKeyDown?.({ key, currentTarget: input, nativeEvent: { isComposing },
				preventDefault() {}, stopPropagation() {} });
		}),
		cleanup: async () => {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}
