/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperFinishingDialog from '../src/common/editor/ui/dialogs/FramescaperFinishingDialog.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('the production Dialogue Chain admits only its currently selected audio track', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const tracks = [{ id: 'picture', type: 'video' }, { id: 'labels', type: 'label' }, { id: 'voice', type: 'audio' }];
	let selectedTrackId = 'picture';
	let project = { schemaFamily: 'framescaper', schemaVersion: 1, sampleRate: 48_000, tracks };
	const commands: unknown[] = [];
	const controller = { actions: { edit: { commit(command: unknown) { commands.push(command); } } } };
	const render = (): void => { root.render(<FramescaperFinishingDialog surface="dialogue-chain"
		controller={controller} project={project} selectedTrackId={selectedTrackId}
		fileService={{}} editingBlocked={false} readOnly={false}
		run={operation => operation()} onClose={() => {}} />); };
	const apply = () => dom.one('[data-dialogue-chain-apply]').querySelector('button');
	try {
		await act(async () => { render(); });
		assert.equal(reactProps(apply()!).disabled, true, 'a picture track cannot receive an audio rack');
		await act(async () => { reactProps(apply()!).onClick?.(); });
		assert.equal(commands.length, 0, 'the action also refuses stale or unavailable audio targets');
		selectedTrackId = 'labels';
		await act(async () => { render(); });
		assert.equal(reactProps(apply()!).disabled, true);
		selectedTrackId = 'voice';
		await act(async () => { render(); });
		assert.equal(reactProps(apply()!).disabled, false);
		await act(async () => { reactProps(apply()!).onClick?.(); });
		assert.equal(commands.length, 1);
		assert.equal((commands[0] as { trackId: string }).trackId, 'voice');
		project = { ...project, tracks: tracks.filter(({ id }) => id !== 'voice') };
		await act(async () => { render(); });
		assert.equal(reactProps(apply()!).disabled, true, 'removed selection IDs are not admitted');
		await act(async () => { reactProps(apply()!).onClick?.(); });
		assert.equal(commands.length, 1);
	} finally {
		await act(async () => { root.unmount(); });
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
