/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import { useWorkspaceDockPresentation } from '../src/common/editor/ui/workspace/useWorkspaceDockPresentation.ts';
import type { WorkspacePanelPreference } from '../src/common/editor/workspace-panel-layout.ts';
import { workspacePanelAvailable as soundscaperPanelAvailable } from '../src/soundscaper/editor-workspace-panel-runtime.ts';

test('Soundscaper panel port accepts the shared context contract while retaining panel policy', () => {
	assert.equal(soundscaperPanelAvailable('soundscaper', 'history', null, { phase: 'armed' }), true);
	assert.equal(soundscaperPanelAvailable('soundscaper', 'recording-setup', null, { phase: 'recording' }), false);
	assert.equal(soundscaperPanelAvailable('soundscaper', 'web-vcr', null, null), false);
});

void test('workspace dock layout keeps its groups and arrangement targets across unrelated publications', async () => {
	const dom = installReactTestDom(); const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	let reads = 0;
	const preferences: Record<string, WorkspacePanelPreference> = { history: { get visible() { reads++; return true; }, dock: 'left', order: 1 }, clock: { visible: true, dock: 'right', order: 1 } };
	let copy = { panelHistory: 'History', panelClock: 'Clock' }; let showBin = false;
	let result: ReturnType<typeof useWorkspaceDockPresentation>;
	function Harness({ revision }: { revision: number }) { result = useWorkspaceDockPresentation('left', preferences, 'soundscaper', true, true, true, null, null, true, showBin, copy); return <span>{revision}</span>; }
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness revision={0} />)); const first = result!; const work = reads;
		for (let revision = 1; revision <= 30; revision++) await act(async () => root.render(<Harness revision={revision} />));
		assert.equal(reads, work); assert.equal(result!, first); assert.equal(result!.panels[0]?.[0], 'history');
		copy = { ...copy, panelHistory: 'Verlauf' }; await act(async () => root.render(<Harness revision={31} />));
		assert.ok(result!.arrangeTargets.some(target => target.label === 'Verlauf'));
		showBin = true; await act(async () => root.render(<Harness revision={32} />)); assert.ok(reads > work);
	} finally { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); }
});
