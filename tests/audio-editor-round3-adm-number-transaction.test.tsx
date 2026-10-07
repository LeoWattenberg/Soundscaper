/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import AdmMetadataFields from '../src/common/editor/ui/AdmMetadataFields.tsx';
import { addAdmEditorObject, createDefaultAdmMetadata, listAdmEditorSourceChannels } from '../src/common/editor/ui/adm-metadata-editor-model.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const project = {
	title: 'ADM', masterChannels: 2, metadata: { adm: null },
	sources: [{ id: 'source', channelCount: 1 }], clips: [{ id: 'clip', sourceId: 'source' }],
	tracks: [{ id: 'track', type: 'audio', name: 'Track', clipIds: ['clip'] }],
	mixer: { groups: [], sends: [], routes: {} },
};

test('ADM numeric edits publish the completed value once and cancel an unfinished edit', async () => {
	const source = listAdmEditorSourceChannels(project)[0];
	assert.ok(source);
	const authored = addAdmEditorObject(createDefaultAdmMetadata(project), source, () => 'object');
	const commits: unknown[] = [];
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => { root.render(<AdmMetadataFields value={authored} project={project} copy={{}}
			onCommit={(value) => { commits.push(value); }} />); });
		const angle = dom.container.querySelectorAll('input').find((input) => input.getAttribute('min') === '-180');
		assert.ok(angle);
		for (const prefix of ['1', '14', '145']) await act(async () => {
			reactProps(angle).onChange({ currentTarget: { value: prefix, checkValidity: () => true } });
		});
		assert.deepEqual(commits, [], 'valid prefixes are local drafts');
		await act(async () => { reactProps(angle).onBlur({ currentTarget: { value: '145', checkValidity: () => true } }); });
		assert.equal(commits.length, 1);
		assert.equal((commits[0] as typeof authored).objects?.[0]?.position.azimuth, 145);
		await act(async () => { reactProps(angle).onChange({ currentTarget: { value: '-45', checkValidity: () => true } }); });
		await act(async () => { reactProps(angle).onKeyDown({ key: 'Escape', currentTarget: { blur() {} }, preventDefault() {}, stopPropagation() {} }); });
		assert.equal(angle.value, '0');
		await act(async () => { reactProps(angle).onBlur({ currentTarget: { value: '-45', checkValidity: () => true } }); });
		assert.equal(commits.length, 1, 'canceled drafts do not later publish on blur');
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
