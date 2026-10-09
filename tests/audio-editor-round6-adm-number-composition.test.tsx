/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AdmMetadataFields from '../src/common/editor/ui/AdmMetadataFields.tsx';
import { addAdmEditorObject, createDefaultAdmMetadata, listAdmEditorSourceChannels } from '../src/common/editor/ui/adm-metadata-editor-model.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const project = { title: 'Programme', masterChannels: 1, metadata: {}, sources: [{ id: 'source', channelCount: 1 }],
	clips: [{ id: 'clip', sourceId: 'source' }], tracks: [{ id: 'track', type: 'audio', name: 'Track', clipIds: ['clip'] }],
	mixer: { groups: [], sends: [], routes: {} } };

for (const key of ['Enter', 'Escape']) test(`ADM numeric metadata releases composing ${key}`, async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const commits: unknown[] = [];
	const [source] = listAdmEditorSourceChannels(project);
	assert.ok(source);
	const value = addAdmEditorObject(createDefaultAdmMetadata(project), source, () => 'object');
	try {
		await act(async () => { root.render(<AdmMetadataFields project={project} value={value} copy={{}}
			onCommit={next => { commits.push(next); }} />); });
		const input = dom.container.querySelectorAll('input').find(field => field.getAttribute('min') === '-180');
		assert.ok(input);
		input.focus();
		Object.defineProperty(input, 'blur', { configurable: true, value: () => {
			input.ownerDocument.activeElement = input.ownerDocument.body;
			reactProps(input).onBlur({ currentTarget: input });
		} });
		Object.defineProperty(input, 'checkValidity', { configurable: true, value: () => true });
		input.value = '20';
		await act(async () => { reactProps(input).onChange({ currentTarget: input }); });
		let consumed = false;
		await act(async () => { reactProps(input).onKeyDown({ key, currentTarget: input, nativeEvent: { isComposing: true },
			preventDefault() { consumed = true; }, stopPropagation() { consumed = true; } }); });
		assert.equal(consumed, false);
		assert.deepEqual(commits, []);
		assert.equal(input.value, '20');
		input.value = '30';
		await act(async () => { reactProps(input).onChange({ currentTarget: input }); });
		await act(async () => { reactProps(input).onKeyDown({ key: 'Enter', currentTarget: input, nativeEvent: { isComposing: false },
			preventDefault() {}, stopPropagation() {} }); });
		assert.equal(commits.length, 1);
		assert.equal((commits[0] as { objects: { position: { azimuth: number } }[] }).objects[0]?.position.azimuth, 30);
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
