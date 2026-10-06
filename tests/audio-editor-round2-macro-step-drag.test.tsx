/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { createEffectMacroStep } from '../src/common/editor/effect-macro-steps.ts';
import { macroSnapshot, mountedMacroManagerFixture } from './helpers/macro-manager-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';

for (const complete of [false, true]) {
	test(`a macro step drag ${complete ? 'commits its preview only on drop' : 'cancels without writing the library'}`, async () => {
		const effects = ['audacity-invert', 'audacity-fade-in', 'audacity-fade-out'].map((type, index) => (
			createEffectMacroStep(type, { id: `step-${String(index)}` })
		));
		const fixture = await mountedMacroManagerFixture({ id: 'macro', name: 'Three steps', effects });
		try {
			await fixture.render(macroSnapshot('project'));
			const slots = fixture.find('[data-macro-effect-stack]')!.querySelectorAll('.effect-slot');
			await act(async () => {
				reactProps(slots[0]!).onDragStart({ dataTransfer: { setData: () => undefined } });
			});
			await act(async () => {
				reactProps(slots[2]!).onDragOver({ preventDefault: () => undefined });
			});
			assert.deepEqual(fixture.effectNames(), ['Invert', 'Fade In', 'Fade Out']);
			assert.equal((reactProps(slots[2]!).style as unknown as { outline: string }).outline, '1px solid var(--accent)');
			assert.deepEqual(fixture.library()[0]!.effects.map(({ id }) => id), ['step-0', 'step-1', 'step-2']);
			await act(async () => {
				const current = fixture.find('[data-macro-effect-stack]')!.querySelectorAll('.effect-slot');
				if (complete) reactProps(fixture.find('[data-macro-effect-stack]')!).onDrop({ preventDefault: () => undefined, dataTransfer: {} });
				else reactProps(current[2]!).onDragEnd({});
			});
			assert.deepEqual(fixture.effectNames(), complete ? ['Fade In', 'Fade Out', 'Invert'] : ['Invert', 'Fade In', 'Fade Out']);
			assert.deepEqual(fixture.library()[0]!.effects.map(({ id }) => id), complete ? ['step-1', 'step-2', 'step-0'] : ['step-0', 'step-1', 'step-2']);
		} finally {
			fixture.settlePending();
			await fixture.cleanup();
		}
	});
}
