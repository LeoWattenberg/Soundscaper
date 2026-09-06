/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { ClipHeader } from '../vendor/audacity-design-system/components/src/ClipHeader/ClipHeader.tsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

// The editor withdraws a clip's rename callback whenever the workspace is
// transiently blocked - an import settling, an effect processing - and on the
// CI runner that happened between the double-click that opened the inline
// editor and the Enter that committed it, so the rename vanished without a
// word. A rename commits through the callback that existed when it began; the
// host decides whether to refuse it.

// The editor selects its text once mounted; the fake element only knows focus.
Object.assign(ReactTestElement.prototype, { select() {} });

const keyEvent = (key: string) => ({ key, preventDefault() {}, stopPropagation() {} });

async function mount(props: Record<string, unknown>) {
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = async (next: Record<string, unknown>) => {
		await act(async () => root.render(<ClipHeader name="browser-long-tone.wav" {...next} />));
	};
	await render(props);
	return {
		render,
		input: () => dom.container.querySelectorAll('input').find((element) => element.getAttribute('aria-label') === 'Clip name') ?? null,
		unmount: () => act(async () => root.unmount()),
	};
}

test('a rename started while the host allowed it commits through that callback after the host withdraws it', async () => {
	const renames: string[] = [];
	let finished = 0;
	const onRename = (name: string) => { renames.push(name); };
	const onRenameFinished = () => { finished += 1; };
	const header = await mount({ onRename, onRenameFinished, renameRequestId: 1 });
	const input = header.input();
	assert.ok(input, 'the rename request opens the inline editor');

	await header.render({ onRename: undefined, onRenameFinished, renameRequestId: 1 });
	assert.ok(header.input(), 'withdrawing the callback does not close an editor already open');

	await act(async () => {
		reactProps(header.input()!).onChange({ target: { value: 'Soundscaper editable copy' } });
	});
	await act(async () => {
		reactProps(header.input()!).onKeyDown(keyEvent('Enter'));
	});
	assert.deepEqual(renames, ['Soundscaper editable copy']);
	assert.equal(finished, 1);
	assert.equal(header.input(), null, 'the editor closes once the rename is committed');
	await header.unmount();
});

test('a rename request without a callback never opens the editor, and Escape commits nothing', async () => {
	const renames: string[] = [];
	let finished = 0;
	const header = await mount({ onRenameFinished: () => { finished += 1; }, renameRequestId: 1 });
	assert.equal(header.input(), null);
	assert.equal(finished, 1, 'the request is answered so the host can clear it');

	await header.render({ onRename: (name: string) => { renames.push(name); }, onRenameFinished: () => { finished += 1; }, renameRequestId: 2 });
	assert.ok(header.input());
	await act(async () => {
		reactProps(header.input()!).onChange({ target: { value: 'Discarded' } });
	});
	await act(async () => {
		reactProps(header.input()!).onKeyDown(keyEvent('Escape'));
	});
	assert.deepEqual(renames, []);
	assert.equal(finished, 2);
	await header.unmount();
});
