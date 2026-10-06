/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { useCaptionTrackFields } from '../src/common/editor/ui/dialogs/useCaptionTrackFields.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

Reflect.set(globalThis, 'React', React);

function Fields({ project }: Readonly<{ project: unknown }>) {
	const fields = useCaptionTrackFields(project);
	return <div>
		<input value={fields.captionTrackId} onChange={(event) => fields.setCaptionTrackId(event.currentTarget.value)} />
		<input value={fields.captionTrackName} onChange={(event) => fields.setCaptionTrackName(event.currentTarget.value)} />
		<input value={fields.captionLanguage} onChange={(event) => fields.setCaptionLanguage(event.currentTarget.value)} />
		<input value={fields.captionSequenceId} onChange={(event) => fields.setCaptionSequenceId(event.currentTarget.value)} />
	</div>;
}

test('caption sidecar fields show the selected saved track and preserve a local name through unrelated updates', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const tracks = [
		{ id: 'french', name: 'French dialogue', language: 'fr', sequenceId: 'sequence-fr' },
		{ id: 'german', name: 'German dialogue', language: 'de', sequenceId: 'sequence-de' },
	];
	try {
		await act(async () => { root.render(<Fields project={{ primarySequenceId: 'main', videoCaptionTracks: tracks }} />); });
		const inputs = dom.container.querySelectorAll('input');
		assert.deepEqual(inputs.map((input) => input.value), ['french', 'French dialogue', 'fr', 'sequence-fr']);
		await act(async () => { reactProps(inputs[0]).onChange({ currentTarget: { value: 'german' } }); });
		assert.deepEqual(inputs.map((input) => input.value), ['german', 'German dialogue', 'de', 'sequence-de']);
		await act(async () => { reactProps(inputs[1]).onChange({ currentTarget: { value: 'Local draft' } }); });
		await act(async () => { root.render(<Fields project={{ primarySequenceId: 'main', videoCaptionTracks: structuredClone(tracks) }} />); });
		assert.equal(inputs[1].value, 'Local draft');
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
