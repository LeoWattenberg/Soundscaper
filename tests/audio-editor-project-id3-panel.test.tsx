/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ProjectMetadataPanel from '../src/common/editor/ui/workspace/ProjectMetadataPanel.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

test('project ID3 is menu-panel opt-in, shares General metadata and edits extended tags', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const changes: Readonly<Record<string, unknown>>[] = [];
	const metadata = { title: 'Episode', tags: { GENRE: 'Ambient' } };
	try {
		await act(async () => root.render(<ProjectMetadataPanel project={{ metadata }} locale="en"
			copy={ENGLISH_COPY} disabled={false} onUpdate={value => changes.push(value)} />));
		assert.equal(dom.container.querySelectorAll('[data-id3-metadata-fields]').length, 0);
		const tab = dom.container.querySelectorAll('button').find(button => button.textContent === 'ID3');
		assert.ok(tab);
		await act(async () => reactProps(tab).onClick());
		const genre = dom.container.querySelectorAll('input').find(input => input.name === 'id3-genre');
		assert.ok(genre);
		assert.equal(genre.value, 'Ambient');
		await act(async () => reactProps(genre).onChange({ currentTarget: { value: 'Rock' } }));
		await act(async () => reactProps(genre).onBlur());
		assert.deepEqual(changes.at(-1), { tags: { genre: 'Rock' } });
		const title = dom.container.querySelectorAll('input').find(input => input.name === 'id3-title');
		assert.ok(title);
		await act(async () => reactProps(title).onChange({ currentTarget: { value: 'New episode' } }));
		await act(async () => reactProps(title).onBlur());
		assert.deepEqual(changes.at(-1), { title: 'New episode' });
		assert.ok(dom.container.textContent.includes('Lyrics / transcript'));
		assert.ok(dom.container.textContent.includes('Add artwork'));
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
