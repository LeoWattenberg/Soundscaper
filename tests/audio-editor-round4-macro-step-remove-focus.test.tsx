/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import MacroManagerStepList from '../src/common/editor/ui/inspector/MacroManagerStepList.jsx';
import { createEffectMacroStep } from '../src/common/editor/effect-macro-steps.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

for (const destination of ['next-step', 'add-effect', 'other-control'] as const) {
	test(`macro step removal preserves the ${destination} keyboard destination`, async () => {
		const dom = installReactTestDom();
		Object.assign(globalThis.window, { getComputedStyle: () => ({ display: '', visibility: '' }) });
		const root = createRoot(dom.container as unknown as HTMLElement);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const removed: string[] = [];
		const effects = [createEffectMacroStep('audacity-invert', { id: 'first' }),
			createEffectMacroStep('audacity-fade-in', { id: 'second' })];
		const render = async (ids: readonly string[]): Promise<void> => {
			await act(async () => { root.render(<>
				<button data-other-control type="button">Other authoring</button>
				<MacroManagerStepList copy={ENGLISH_COPY} effects={effects.filter(effect => ids.includes(effect.id))}
					effectTypes={[]} replaceEffectOptions={[]} onAddEffect={() => undefined} onChangeEffect={() => undefined}
					onReorderEffect={() => undefined} onReplaceEffect={() => undefined} onSelectEffect={() => undefined}
					onRemoveEffect={(id: string) => { removed.push(id); }} />
			</>); });
		};
		try {
			await render(destination === 'next-step' ? ['first', 'second'] : ['first']);
			const settings = dom.one('[aria-label="Effect settings"]'); settings.focus();
			await act(async () => { reactProps(settings).onClick?.({ currentTarget: settings, stopPropagation: () => undefined }); });
			const remove = (document.body as unknown as ReactTestElement).querySelectorAll('[role="menuitem"]')
				.find(item => item.textContent === 'Remove effect');
			assert.ok(remove); remove.focus();
			await act(async () => { reactProps(remove).onClick?.({ currentTarget: remove, stopPropagation: () => undefined }); });
			const other = dom.one('[data-other-control]');
			if (destination === 'other-control') other.focus();
			await render(destination === 'next-step' ? ['second'] : []);
			assert.deepEqual(removed, ['first']);
			assert.equal(document.activeElement, destination === 'other-control' ? other
				: destination === 'next-step' ? dom.one('.effect-slot') : dom.one('[data-macro-add-effect]'));
		} finally {
			await act(async () => { root.unmount(); });
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		}
	});
}
