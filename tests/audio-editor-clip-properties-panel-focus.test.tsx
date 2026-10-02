/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { useWorkspaceClipPropertiesPanel } from '../src/common/editor/ui/workspace/useWorkspaceClipPropertiesPanel.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('reopening properties focuses the requested clip, and consuming an old request preserves a newer one', async () => {
	const f = await fixture();
	try {
		await f.render();
		await f.open('clip-pitch', 'one');
		const first = f.current().clipPropertiesFocusRequest;
		assert.ok(first);
		assert.deepEqual({ clipId: first.clipId, field: first.field }, { clipId: 'one', field: 'pitchCents' });
		await f.open('clip-speed', 'two');
		const second = f.current().clipPropertiesFocusRequest;
		assert.ok(second);
		await act(async () => first.onHandled?.());
		assert.equal(f.current().clipPropertiesFocusRequest, second);
		await act(async () => second.onHandled?.());
		assert.equal(f.current().clipPropertiesFocusRequest, null);
		assert.deepEqual(f.visibilityCalls, [['clip-properties', true], ['clip-properties', true]]);
	} finally { await f.cleanup(); }
});

test('switching projects discards a pending request even when the original project is revisited', async () => {
	const f = await fixture();
	try {
		await f.render();
		await f.open('clip', 'one');
		await f.render({ projectId: 'project-b' });
		assert.equal(f.current().clipPropertiesFocusRequest, null);
		await f.render({ projectId: 'project-a' });
		assert.equal(f.current().clipPropertiesFocusRequest, null);
	} finally { await f.cleanup(); }
});

test('closing the panel cancels pending focus so reopening from View does not replay it', async () => {
	const f = await fixture();
	try {
		await f.render();
		await f.open('clip-pitch', 'one');
		await f.render({ panelVisible: false });
		assert.equal(f.current().clipPropertiesFocusRequest, null);
		await f.render({ panelVisible: true });
		assert.equal(f.current().clipPropertiesFocusRequest, null);
	} finally { await f.cleanup(); }
});

async function fixture() {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const visibilityCalls: Array<[string, boolean]> = [];
	const controller = { actions: { preferences: { setPanelVisibility: (panelId: string, visible: boolean) => {
		visibilityCalls.push([panelId, visible]);
	} } } };
	let options = { projectId: 'project-a', panelVisible: true };
	let current: ReturnType<typeof useWorkspaceClipPropertiesPanel> | undefined;
	const run = (operation: () => unknown) => operation();
	const setActiveSurface = () => undefined;
	function Subject() {
		current = useWorkspaceClipPropertiesPanel({ controller, run, setActiveSurface, selectedClipId: 'one', ...options });
		return null;
	}
	const api = () => { assert.ok(current); return current; };
	return {
		visibilityCalls, current: api,
		render: async (changes: Partial<typeof options> = {}) => {
			options = { ...options, ...changes };
			await act(async () => root.render(<Subject />));
		},
		open: async (surface: string, clipId: string) => {
			await act(async () => { assert.equal(api().openClipPropertiesSurface(surface, clipId), true); });
		},
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			dom.restore();
		},
	};
}
