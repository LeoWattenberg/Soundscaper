/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { WorkspacePanelOverlayPortal } from '../src/common/editor/ui/workspace/WorkspacePanelOverlayPortal.tsx';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('panel dialogs leave the dock subtree and retire from the editor overlay on unmount', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const host = document.createElement('div');
	const overlay = document.createElement('div');
	dom.container.appendChild(host as never);
	dom.container.appendChild(overlay as never);
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(host);
	const render = (target: Element | null) => <section data-panel-dock="top">
		<WorkspacePanelOverlayPortal target={target}>
			<div role="alertdialog"><button type="button">Cancel</button></div>
		</WorkspacePanelOverlayPortal>
	</section>;
	try {
		await act(async () => { root.render(render(null)); });
		assert.equal(dom.find('button'), null, 'a detached overlay target cannot publish a panel dialog');
		await act(async () => { root.render(render(overlay)); });
		assert.equal(dom.one('[role="alertdialog"]').parentNode, overlay);
		assert.equal(dom.one('[data-panel-dock="top"]').contains(dom.one('button')), false,
			'the modal must escape dock clipping, containment and stacking');
		await act(async () => { root.render(render(null)); });
		assert.equal(overlay.childNodes.length, 0, 'retiring the target removes its dialog');
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
