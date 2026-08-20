/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const WORKSPACE_ROOT = new URL('../src/common/editor/ui/workspace/', import.meta.url);
const DIALOG_ROOT = new URL('../src/common/editor/ui/dialogs/', import.meta.url);

test('custom track-rate dialog retains the track whose submenu opened it', async () => {
	const [workspace, trackRateHook, overlays, dialog, menus, parity] = await Promise.all([
		readFile(new URL('AudioEditorWorkspace.jsx', WORKSPACE_ROOT), 'utf8'),
		readFile(new URL('useTrackRateDialog.js', WORKSPACE_ROOT), 'utf8'),
		readFile(new URL('AudioEditorWorkspaceOverlays.jsx', WORKSPACE_ROOT), 'utf8'),
		readFile(new URL('EditorDialog.jsx', DIALOG_ROOT), 'utf8'),
		readFile(new URL('workspace-application-menu-runtime.js', WORKSPACE_ROOT), 'utf8'),
		readFile(new URL('useWorkspaceParityRequests.js', WORKSPACE_ROOT), 'utf8'),
	]);
	assert.match(workspace, /useTrackRateDialog\(project, setDialog, setDialogValue\)/u);
	assert.match(trackRateHook, /const \[dialogTrackId, setDialogTrackId\] = useState\(null\)/u);
	assert.match(trackRateHook, /const openTrackRate = useCallback\([\s\S]*setDialogTrackId\(track\?\.id \|\| null\)[\s\S]*setDialog\('track-rate'\)/u);
	assert.match(overlays, /trackId=\{dialogTrackId\}/u);
	assert.match(dialog, /applyTrackRateDialog\(\{ trackId, value,[\s\S]*setRate: controller\.actions\.track\.setRate/u);
	assert.match(menus, /openTrackRate: \(\) => openTrackRate\(selectedAudioTrack\)/u);
	assert.match(parity, /openTrackRate\(selectedTrack\)/u);

	const { applyTrackRateDialog } = await import(
		'../src/common/editor/ui/dialogs/editor-dialog-model.js'
	);
	const calls: unknown[][] = [];
	const applied = applyTrackRateDialog({
		trackId: 'menu-track-b',
		value: '96000',
		run: (operation: () => unknown) => operation(),
		setRate: (...args: unknown[]) => { calls.push(args); },
	});
	assert.equal(applied, true);
	assert.deepEqual(calls, [['menu-track-b', 96_000]]);
});

test('workspace overlays forward the product-specific About label to the dialog', async () => {
	const overlays = await readFile(new URL('AudioEditorWorkspaceOverlays.jsx', WORKSPACE_ROOT), 'utf8');
	assert.match(overlays, /<EditorDialog[\s\S]*aboutLabel=\{aboutLabel\}/u);
});
