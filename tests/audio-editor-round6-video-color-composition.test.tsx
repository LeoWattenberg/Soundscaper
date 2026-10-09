/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import VideoEffectRack from '../src/common/editor/ui/inspector/VideoEffectRack.jsx';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const key of ['Enter', 'Escape']) for (const composing of [false, true]) {
	test(`video color ${key} ${composing ? 'releases unfinished composition' : 'retains completed editing'}`, async () => {
		const dom = installReactTestDom();
		const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		environment.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		const calls: string[] = [];
		const failures: string[] = [];
		const actions = {
			beginGesture() { calls.push('begin'); },
			preview() { calls.push('preview'); },
			commit() { calls.push('commit'); },
			cancel() { calls.push('cancel'); },
		};
		try {
			await act(async () => root.render(<VideoEffectRack
				clip={{ id: 'video', videoEffects: [createVideoEffect('chroma-key', { id: 'key' })] }}
				controller={{ actions: { video: { effects: actions } } }} copy={ENGLISH_COPY}
				disabled={false} onError={(message: string) => { if (message) failures.push(message); }} />));
			const input = dom.one('[data-video-effect-param="keyColor"]').querySelectorAll('input')
				.find(element => element.type === 'text');
			assert.ok(input);
			await act(async () => reactProps(input).onFocus());
			const draft = composing ? '#１２' : '#123456';
			await act(async () => reactProps(input).onChange({ currentTarget: { value: draft } }));
			calls.length = 0;
			let prevented = false;
			let blurred = false;
			await act(async () => reactProps(input).onKeyDown({ key, nativeEvent: { isComposing: composing },
				currentTarget: { blur() { blurred = true; } },
				preventDefault() { prevented = true; }, stopPropagation() {},
			}));
			assert.equal(prevented, !composing);
			assert.equal(blurred, !composing && key === 'Enter');
			assert.deepEqual(failures, []);
			if (composing) {
				assert.equal(reactProps(input).value, draft);
				assert.deepEqual(calls, []);
			} else assert.deepEqual(calls, [key === 'Enter' ? 'commit' : 'cancel']);
		} finally {
			await act(async () => root.unmount());
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		}
	});
}
