/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import ProjectMetadataPanel from '../src/common/editor/ui/workspace/ProjectMetadataPanel.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('project comments preserve paragraph drafts and commit them on blur', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const updates: Readonly<Record<string, unknown>>[] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<ProjectMetadataPanel
			project={{ metadata: { comments: 'Original note', title: 'Take one' } }}
			copy={ENGLISH_COPY} disabled={false} onUpdate={changes => updates.push(changes)} />));
		const comments = dom.container.querySelectorAll('textarea').find(field => field.name === 'comments');
		assert.ok(comments, 'project comments must retain ordinary multiline notes');
		assert.equal(reactProps(comments).value, 'Original note');
		assert.equal(dom.container.querySelectorAll('input').find(field => field.name === 'title')?.value, 'Take one');
		const paragraphs = 'Take 1: keep the opening breath.\nTake 2: use the alternate ending.';
		await act(async () => { reactProps(comments).onChange({ currentTarget: { value: paragraphs } }); });
		let blurred = false;
		await act(async () => { reactProps(comments).onKeyDown({
			key: 'Enter', currentTarget: { blur: () => { blurred = true; } },
		}); });
		assert.equal(blurred, false, 'Enter remains available for another comments line');
		assert.deepEqual(updates, []);
		assert.equal(reactProps(comments).value, paragraphs);
		await act(async () => { reactProps(comments).onBlur(); });
		assert.deepEqual(updates, [{ comments: paragraphs }]);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
