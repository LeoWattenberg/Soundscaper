/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { applyAudacityItemNavigationAction } from '../src/common/editor/audacity-shortcut-actions/item-navigation.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import type { ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

for (const deliberateFocus of [false, true]) test(`relocated label keyboard focus preserves deliberate focus=${String(deliberateFocus)}`, async context => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const frames: FrameRequestCallback[] = [];
	context.mock.method(globalThis, 'requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	context.after(async () => { await act(async () => root.unmount()); actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore(); });
	const render = (track: string) => root.render(<div data-audio-editor="">
		{['first', 'second'].map(id => <div key={id} data-label-track="" data-track-id={id}>
			{id === track && <div data-label-id="label" role="group" tabIndex={0} />}
		</div>)}
		<button type="button">Another control</button>
	</div>);
	await act(async () => render('first'));
	const original = dom.one('[data-label-id]');
	original.focus();
	const label = { id: 'label', title: 'A label', startFrame: 0, endFrame: 38_400 };
	const project = { sampleRate: 48_000, clips: [], tracks: [
		{ id: 'first', type: 'label', labels: [label] },
		{ id: 'second', type: 'label', labels: [] },
	] } as unknown as ControllerProject;
	const commands: AudioEditorCommand[] = [];
	const controller = { getSnapshot: () => ({ project, selectedTrackId: 'first' }), actions: {
		clip: { move: () => null, trim: () => null }, labels: { update: () => null }, timeline: { setSelection: () => null },
		track: { moveUp: () => null, moveDown: () => null }, transport: { seek: () => null },
		edit: { commit: (command: AudioEditorCommand) => { commands.push(command); render('second'); } },
	} };
	await act(async () => { applyAudacityItemNavigationAction('track-view-item-move-down', controller, { trackId: 'first', labelId: 'label' }); });
	assert.deepEqual(commands, [{ type: 'batch', commands: [
		{ type: 'label/remove', trackId: 'first', labelId: 'label' },
		{ type: 'label/add', trackId: 'second', label },
	] }]);
	const other = dom.one('button');
	if (deliberateFocus) other.focus();
	for (const callback of frames) callback(0);
	assert.equal(dom.container.ownerDocument.activeElement, deliberateFocus ? other : dom.one('[data-label-id]'));
});
