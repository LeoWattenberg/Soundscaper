/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import BextMetadataFields from '../src/common/editor/ui/BextMetadataFields.tsx';
import AdmMetadataFields from '../src/common/editor/ui/AdmMetadataFields.tsx';
import { createBextMetadataEditorValue } from '../src/common/editor/ui/bext-metadata-editor-model.ts';
import { addAdmEditorObject, createDefaultAdmMetadata, listAdmEditorSourceChannels } from '../src/common/editor/ui/adm-metadata-editor-model.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const project = {
	title: 'Programme', masterChannels: 1, metadata: {}, mixer: { groups: [], sends: [], routes: {} },
	sources: [{ id: 'voice', channelCount: 1 }], clips: [{ id: 'clip', sourceId: 'voice' }],
	tracks: [{ id: 'track', type: 'audio', name: 'Voice', clipIds: ['clip'] }],
};

for (const kind of ['bext', 'adm-text', 'adm-number'] as const) test(`metadata Enter commits once and retains field focus: ${kind}`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const globalAct = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globalAct.IS_REACT_ACT_ENVIRONMENT;
	globalAct.IS_REACT_ACT_ENVIRONMENT = true;
	const commits: unknown[] = [];
	const firstSource = listAdmEditorSourceChannels(project)[0]; assert.ok(firstSource);
	function Fixture() {
		const [bext, setBext] = useState(() => createBextMetadataEditorValue(project));
		const [adm, setAdm] = useState(() => addAdmEditorObject(createDefaultAdmMetadata(project), firstSource!, () => 'object'));
		return kind === 'bext' ? <BextMetadataFields copy={{}} value={bext} onCommit={value => { commits.push(value); setBext(value); }} />
			: <AdmMetadataFields copy={{}} project={project} value={adm} onCommit={value => {
				assert.ok(value?.mode === 'authored'); commits.push(value); setAdm(value);
			}} />;
	}
	try {
		await act(async () => { root.render(<Fixture />); });
		const input = dom.container.querySelectorAll('input').find(element => kind === 'bext' ? element.name === 'originator'
			: kind === 'adm-text' ? element.name === 'adm-programme-name' : element.getAttribute('min') === '-180');
		assert.ok(input);
		Object.defineProperty(input, 'checkValidity', { value: () => kind !== 'adm-number' || (Number(input.value) >= -180 && Number(input.value) <= 180) });
		Object.defineProperty(input, 'blur', { value: () => {
			input.ownerDocument.activeElement = input.ownerDocument.body;
			reactProps(input).onBlur({ currentTarget: input });
		} });
		input.focus();
		if (kind === 'adm-number') {
			await act(async () => { reactProps(input).onChange({ currentTarget: { value: '200' } }); });
			await act(async () => { reactProps(input).onKeyDown({ key: 'Enter', currentTarget: input, preventDefault() {} }); });
			assert.equal(commits.length, 0); assert.equal(input.value, '0');
			assert.equal(input.ownerDocument.activeElement === input, true);
		}
		await act(async () => { reactProps(input).onChange({ currentTarget: { value: kind === 'adm-number' ? '45' : 'Location unit' } }); });
		let prevented = false;
		await act(async () => { reactProps(input).onKeyDown({ key: 'Enter', currentTarget: input, preventDefault() { prevented = true; } }); });
		assert.equal(input.ownerDocument.activeElement === input, true);
		assert.equal(prevented, true);
		assert.equal(commits.length, 1);
		await act(async () => { reactProps(input).onBlur({ currentTarget: input }); });
		assert.equal(commits.length, 1, 'the later ordinary blur does not repeat the completed edit');
		await act(async () => { reactProps(input).onChange({ currentTarget: { value: kind === 'adm-number' ? '90' : 'Cancelled' } }); });
		await act(async () => { reactProps(input).onKeyDown({ key: 'Escape', currentTarget: input, preventDefault() {}, stopPropagation() {} }); });
		assert.equal(commits.length, 1, 'Escape keeps the saved metadata');
	} finally {
		await act(async () => { root.unmount(); }); dom.restore(); globalAct.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
