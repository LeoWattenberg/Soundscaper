/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { useOperationFocusRecovery } from '../src/common/editor/ui/useOperationFocusRecovery.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

function Probe({ pending, owner }: Readonly<{ pending: boolean; owner: string }>) {
	const capture = useOperationFocusRecovery(pending, owner);
	return <><button onClick={capture}>Move marker</button><input /></>;
}

test('operation focus recovery retains its owner and never steals a newly chosen focus target', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = async (pending: boolean, owner = 'clip-a') => {
		await act(async () => root.render(<Probe pending={pending} owner={owner} />));
	};
	try {
		await render(false);
		const button = dom.one('button');
		const other = dom.one('input');
		button.focus();
		reactProps(button).onClick();
		await render(true);
		document.body.focus();
		await render(false);
		assert.equal(document.activeElement, button);
		button.focus();
		reactProps(button).onClick();
		await render(true);
		other.focus();
		await render(false);
		assert.equal(document.activeElement, other);
		button.focus();
		reactProps(button).onClick();
		await render(true);
		document.body.focus();
		await render(false, 'clip-b');
		assert.equal(document.activeElement, document.body);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
