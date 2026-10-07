/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { ClipHeader } from '../vendor/audacity-design-system/components/src/ClipHeader/ClipHeader.tsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

for (const key of ['Enter', 'Escape', 'blur']) {
	test(`clip rename ${key} preserves its keyboard or pointer focus owner`, async context => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		Object.defineProperty(ReactTestElement.prototype, 'select', { configurable: true, value() {} });
		const root = createRoot(dom.container as unknown as Element);
		context.after(async () => {
			await act(async () => root.unmount());
			Reflect.deleteProperty(ReactTestElement.prototype, 'select');
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		});
		const names: string[] = [];
		let finished = 0;
		await act(async () => root.render(<>
			<div data-clip-id="recording" role="group" tabIndex={0}>
				<ClipHeader name="Original" renameRequestId={1}
					onRename={name => names.push(name)} onRenameFinished={() => { finished += 1; }} />
			</div><button type="button">Another control</button>
		</>));
		const clip = dom.one('[data-clip-id="recording"]');
		const input = dom.one('input');
		input.focus();
		input.value = 'Changed';
		if (key === 'blur') dom.one('button').focus();
		await act(async () => {
			if (key === 'blur') reactProps(input).onBlur({ currentTarget: input });
			else reactProps(input).onKeyDown({ key, currentTarget: input,
				preventDefault() {}, stopPropagation() {} });
		});
		assert.equal(dom.find('input'), null);
		assert.deepEqual(names, key === 'Escape' ? [] : ['Changed']);
		assert.equal(finished, 1);
		assert.equal(dom.container.ownerDocument.activeElement, key === 'blur' ? dom.one('button') : clip);
	});
}
