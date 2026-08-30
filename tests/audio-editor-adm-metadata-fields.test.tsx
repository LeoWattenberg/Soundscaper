/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import AdmMetadataFields from '../src/common/editor/ui/AdmMetadataFields.tsx';
import {
	addAdmEditorObject,
	createDefaultAdmMetadata,
	listAdmEditorSourceChannels,
} from '../src/common/editor/ui/adm-metadata-editor-model.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const PROJECT = {
	title: 'ADM', masterChannels: 2, metadata: { adm: null },
	sources: [{ id: 'source', channelCount: 2 }],
	clips: [{ id: 'clip', sourceId: 'source' }],
	tracks: [{ id: 'track', type: 'audio', name: 'Track', clipIds: ['clip'] }],
	mixer: { groups: [], sends: [], routes: {} },
};

test('ADM numeric fields ignore invalid typed values before committing', async () => {
	const base = createDefaultAdmMetadata(PROJECT);
	const [source] = listAdmEditorSourceChannels(PROJECT);
	assert.ok(source);
	const authored = addAdmEditorObject(base, source, () => 'object');
	const commits: unknown[] = [];
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<AdmMetadataFields
			value={authored}
			project={PROJECT}
			copy={{}}
			onCommit={(value) => commits.push(value)}
		/>));
		const azimuth = dom.container.querySelectorAll('input').find((input) => (
			input.getAttribute('min') === '-180' && input.getAttribute('max') === '180'
		));
		assert.ok(azimuth);
		const onChange = reactProps(azimuth).onChange;

		await act(async () => onChange({
			currentTarget: { value: '200', checkValidity: () => false },
		}));
		assert.equal(commits.length, 0);
		await act(async () => onChange({
			currentTarget: { value: '45', checkValidity: () => true },
		}));
		assert.equal((commits[0] as { objects: readonly { position: { azimuth: number } }[] })
			.objects[0]?.position.azimuth, 45);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
