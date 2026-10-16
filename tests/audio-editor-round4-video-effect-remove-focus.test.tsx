/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import VideoEffectRack from '../src/common/editor/ui/inspector/VideoEffectRack.jsx';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const destination of ['next-effect', 'add-effect', 'other-control'] as const) {
	test(`video effect removal preserves the ${destination} destination`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const removed: string[] = [];
		const effects = [createVideoEffect('color-adjust', { id: 'first' }), createVideoEffect('pixelate', { id: 'second' })];
		const actions = { remove(_clip: string, id: string) { removed.push(id); } };
		const render = async (ids: readonly string[]): Promise<void> => {
			await act(async () => { root.render(<>
				<button type="button" data-other-control>Other authoring</button>
				<VideoEffectRack clip={{ id: 'clip', videoEffects: effects.filter(effect => ids.includes(effect.id)) }}
					controller={{ actions: { video: { effects: actions } } }} copy={ENGLISH_COPY}
					disabled={false} onError={() => undefined} />
			</>); });
		};
		try {
			await render(destination === 'next-effect' ? ['first', 'second'] : ['first']);
			const remove = dom.one('[aria-label="Remove effect: Color Adjust"]');
			remove.focus();
			await act(async () => { reactProps(remove).onClick?.({ currentTarget: remove }); });
			const other = dom.one('[data-other-control]');
			if (destination === 'other-control') other.focus();
			await render(destination === 'next-effect' ? ['second'] : []);
			assert.deepEqual(removed, ['first']);
			assert.equal(document.activeElement, destination === 'other-control' ? other
				: destination === 'next-effect' ? dom.one('[aria-label="Remove effect: Pixelate"]')
					: dom.one('[data-video-effect-add]').querySelector('button'));
		} finally {
			await act(async () => { root.unmount(); });
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		}
	});
}
