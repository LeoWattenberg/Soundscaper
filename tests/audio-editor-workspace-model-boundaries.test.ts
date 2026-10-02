/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
	WORKSPACE_OVERLAY_MODEL_KEYS,
	WORKSPACE_PANEL_DOCK_RUNTIME_KEYS,
	createWorkspaceOverlayModel,
	createWorkspacePanelDockRuntime,
} from '../src/common/editor/ui/workspace/workspace-model-boundaries.ts';

test('workspace overlay model has one exact frozen courier inventory', () => {
	const model = createWorkspaceOverlayModel(Object.fromEntries(
		WORKSPACE_OVERLAY_MODEL_KEYS.map((key) => [key, key]),
	) as Record<typeof WORKSPACE_OVERLAY_MODEL_KEYS[number], unknown>);
	assert.deepEqual(Object.keys(model), WORKSPACE_OVERLAY_MODEL_KEYS);
	assert.equal(Object.isFrozen(model), true);
});

test('workspace panel docks share one exact frozen non-dock runtime inventory', () => {
	const runtime = createWorkspacePanelDockRuntime(Object.fromEntries(
		WORKSPACE_PANEL_DOCK_RUNTIME_KEYS.map((key) => [key, key]),
	) as Record<typeof WORKSPACE_PANEL_DOCK_RUNTIME_KEYS[number], unknown>);
	assert.deepEqual(Object.keys(runtime), WORKSPACE_PANEL_DOCK_RUNTIME_KEYS);
	assert.equal(Object.isFrozen(runtime), true);
});

test('the workspace producer passes one overlay model and View reuses one dock runtime', async () => {
	const [workspace, view] = await Promise.all([
		readFile(new URL('../src/common/editor/ui/workspace/AudioEditorWorkspace.jsx', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/workspace/AudioEditorWorkspaceView.jsx', import.meta.url), 'utf8'),
	]);
	assert.match(workspace, /const overlayModel = createWorkspaceOverlayModel\(\{/u);
	assert.match(workspace, /<AudioEditorWorkspaceView model=\{\{[\s\S]*\boverlayModel,/u);
	assert.match(view, /<AudioEditorWorkspaceOverlays model=\{overlayModel\}/u);
	assert.equal(view.match(/<WorkspacePanelDock \{\.\.\.panelDockRuntime\} dock=/gu)?.length, 5);
	assert.match(view, /dock="left" aboutLabel=\{overlayModel\.aboutLabel\}/u);
});
