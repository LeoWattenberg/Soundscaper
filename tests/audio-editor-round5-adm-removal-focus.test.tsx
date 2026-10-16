/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AdmMetadataFields from '../src/common/editor/ui/AdmMetadataFields.tsx';
import { addAdmEditorObject, createDefaultAdmMetadata, listAdmEditorSourceChannels } from '../src/common/editor/ui/adm-metadata-editor-model.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const project = {
	id: 'project', title: 'Programme', masterChannels: 1, metadata: {}, mixer: { groups: [], sends: [], routes: {} },
	sources: [{ id: 'voice', channelCount: 1 }], clips: [{ id: 'clip', sourceId: 'voice' }],
	tracks: [{ id: 'track', type: 'audio', name: 'Voice', clipIds: ['clip'] }],
};

for (const mode of ['next', 'final', 'moved', 'disabled', 'replacement'] as const) test(`mounted ADM object removal preserves its keyboard owner: ${mode}`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const source = listAdmEditorSourceChannels(project)[0]; assert.ok(source);
	let initial = addAdmEditorObject(createDefaultAdmMetadata(project), source, () => 'first');
	if (mode !== 'final') initial = addAdmEditorObject(initial, source, () => 'second');
	function Fixture({ disabled = false, projectId = 'project' }: { disabled?: boolean; projectId?: string }) {
		const [value, setValue] = useState(initial);
		return <><input aria-label="Unrelated control" /><AdmMetadataFields copy={{ admRemoveObject: 'Remove object', admAddObject: 'Add object' }}
			project={{ ...project, id: projectId }} value={value} disabled={disabled} onCommit={next => {
				assert.ok(next?.mode === 'authored'); setValue(next);
			}} /></>;
	}
	const buttons = () => dom.container.querySelectorAll('button').filter(button => button.textContent === 'Remove object');
	const add = () => dom.container.querySelectorAll('button').find(button => button.textContent === 'Add object');
	try {
		await act(async () => { root.render(<Fixture />); });
		const remove = buttons()[0]; assert.ok(remove); remove.focus();
		const unrelated = dom.container.querySelectorAll('input').find(input => input.getAttribute('aria-label') === 'Unrelated control'); assert.ok(unrelated);
		await act(async () => {
			reactProps(remove).onClick({ currentTarget: remove });
			if (mode === 'moved') unrelated.focus();
			if (mode === 'disabled') root.render(<Fixture disabled />);
			if (mode === 'replacement') root.render(<Fixture projectId="other-project" />);
		});
		assert.equal(remove.isConnected, false);
		if (mode === 'disabled') {
			assert.equal(remove.ownerDocument.activeElement, remove, 'temporary disabling does not focus an unavailable action');
			await act(async () => { root.render(<Fixture />); });
		}
		assert.equal(remove.ownerDocument.activeElement, mode === 'moved' ? unrelated : mode === 'replacement' ? remove
			: mode === 'final' ? add() : buttons()[0]);
	} finally {
		await act(async () => { root.unmount(); }); dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
