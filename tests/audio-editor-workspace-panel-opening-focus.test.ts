/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { focusOpenedWorkspacePanel } from '../src/common/editor/ui/workspace/workspace-panel-opening-focus.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('opening a panel focuses its root when no child has taken focus', () => {
	const dom = installReactTestDom();
	try {
		const panel = dom.container.ownerDocument.createElement('section');
		dom.container.appendChild(panel);
		focusOpenedWorkspacePanel(panel as unknown as HTMLElement);
		assert.equal(dom.container.ownerDocument.activeElement, panel);
		assert.equal((panel as unknown as HTMLElement).tabIndex, -1);
		focusOpenedWorkspacePanel(null);
		assert.equal(dom.container.ownerDocument.activeElement, panel);
	} finally {
		dom.restore();
	}
});

test('opening a panel preserves focus already handed to its upload summary', () => {
	const dom = installReactTestDom();
	try {
		const panel = dom.container.ownerDocument.createElement('section');
		const uploads = dom.container.ownerDocument.createElement('details');
		const summary = dom.container.ownerDocument.createElement('summary');
		dom.container.appendChild(panel);
		panel.appendChild(uploads);
		uploads.appendChild(summary);
		summary.focus();
		focusOpenedWorkspacePanel(panel as unknown as HTMLElement);
		assert.equal(dom.container.ownerDocument.activeElement, summary);
	} finally {
		dom.restore();
	}
});
