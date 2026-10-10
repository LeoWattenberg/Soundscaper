/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import WorkspacePanelGroup from '../src/common/editor/ui/workspace/WorkspacePanelGroup.jsx';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

interface Move { readonly panelId: string; readonly kind: string; readonly targetPanelId: string }
async function mountedGroup(
	direction: 'ltr' | 'rtl', dock: string, groupIndex: number,
	run: (grip: ReactTestElement, moves: Move[]) => Promise<void>,
) {
	const dom = installReactTestDom();
	const view = dom.container.ownerDocument.defaultView as { getComputedStyle?: (element: unknown) => { direction: string } };
	view.getComputedStyle = () => ({ direction });
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const moves: Move[] = [];
	const groups = (groupIndex === 0 ? ['history', 'markers', 'labels'] : ['markers', 'history', 'labels']).map(id => ({
		id, activePanelId: id, entries: [[id, { size: 200 }]],
	}));
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => { root.render(<WorkspacePanelGroup
			group={groups[groupIndex]} groupIndex={groupIndex} groups={groups} dock={dock} copy={ENGLISH_COPY}
			contentProps={{ snapshot: { project: createCurrentAudioEditorProject({ id: 'panel' }) }, copy: ENGLISH_COPY }}
			floatingBounds={{ width: 1000, height: 700 }} activeFloatingPanelId={null}
			setActiveFloatingPanelId={() => undefined} draggedPanelId={null}
			onPanelDragStart={() => undefined} onPanelDragEnd={() => undefined}
			onPanelMove={(panelId: string, destination: Omit<Move, 'panelId'>) => { moves.push({ panelId, ...destination }); }}
			onPanelActivate={() => undefined} onTogglePanel={() => undefined}
			beginFloatingMove={() => undefined} adjustFloatingPanelGeometry={() => false} arrangeTargets={[]}
		/>); });
		await run(dom.one('[data-workspace-panel-drag-handle="history"]'), moves);
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
}

function keyEvent(currentTarget: ReactTestElement, key: string, modifiers: Record<string, boolean> = {}) {
	let prevented = false;
	return { key, currentTarget, ctrlKey: false, metaKey: false, altKey: false,
		get defaultPrevented() { return prevented; }, preventDefault() { prevented = true; }, ...modifiers };
}

for (const direction of ['ltr', 'rtl'] as const) {
	for (const dock of ['top', 'bottom']) {
		test(`${dock} panel reorder follows physical ${direction} horizontal direction`, async () => {
			await mountedGroup(direction, dock, 1, async (grip, moves) => {
				const forward = keyEvent(grip, direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight');
				await act(async () => { reactProps(grip).onKeyDown(forward); });
				assert.deepEqual(moves, [{ panelId: 'history', kind: 'after', targetPanelId: 'labels' }]);
				assert.equal(forward.defaultPrevented, true);
				const backward = keyEvent(grip, direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft');
				await act(async () => { reactProps(grip).onKeyDown(backward); });
				assert.deepEqual(moves[1], { panelId: 'history', kind: 'before', targetPanelId: 'markers' });
			});
		});
	}
	test(`vertical panel reorder remains independent of ${direction} writing direction`, async () => {
		await mountedGroup(direction, 'right', 1, async (grip, moves) => {
			await act(async () => { reactProps(grip).onKeyDown(keyEvent(grip, 'ArrowDown')); });
			await act(async () => { reactProps(grip).onKeyDown(keyEvent(grip, 'ArrowUp')); });
			assert.deepEqual(moves, [
				{ panelId: 'history', kind: 'after', targetPanelId: 'labels' },
				{ panelId: 'history', kind: 'before', targetPanelId: 'markers' },
			]);
		});
	});
}

test('panel reordering preserves claimed commands, modifiers and edge admission', async () => {
	await mountedGroup('rtl', 'bottom', 0, async (grip, moves) => {
		for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { defaultPrevented: true }]) {
			await act(async () => { reactProps(grip).onKeyDown(keyEvent(grip, 'ArrowLeft', modifiers)); });
		}
		await act(async () => { reactProps(grip).onKeyDown(keyEvent(grip, 'ArrowRight')); });
		assert.deepEqual(moves, []);
	});
});
