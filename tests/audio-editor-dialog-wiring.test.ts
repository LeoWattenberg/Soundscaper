/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const WORKSPACE_ROOT = new URL('../src/common/editor/ui/workspace/', import.meta.url);
const DIALOG_ROOT = new URL('../src/common/editor/ui/dialogs/', import.meta.url);
// The dialog chrome and the export surface split into two files when the
// combined one outgrew the maintainability ceiling; the no-blur rule below
// covers both, so both are read.
const DIALOG_STYLE_FILES = [
	'../src/common/editor/ui/audio-editor-design-system/11-panels-dialogs-generators.css',
	'../src/common/editor/ui/audio-editor-design-system/11a-dialog-export.css',
].map((path) => new URL(path, import.meta.url));

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

	const { applyTrackRateDialog, TRACK_RATE_DIALOG_MISSING_TRACK } = await import(
		'../src/common/editor/ui/dialogs/editor-dialog-model.js'
	);
	const calls: unknown[][] = [];
	const updated = Promise.resolve('updated');
	const applied = applyTrackRateDialog({
		trackId: 'menu-track-b',
		value: '96000',
		run: (operation: () => unknown) => operation(),
		setRate: (...args: unknown[]) => { calls.push(args); return updated; },
	});
	assert.equal(applied, updated, 'the dialog model must preserve async action settlement');
	assert.deepEqual(calls, [['menu-track-b', 96_000]]);
	assert.equal(applyTrackRateDialog({
		trackId: null,
		value: '48000',
		run: () => { throw new Error('missing tracks must not run'); },
		setRate: () => undefined,
	}), TRACK_RATE_DIALOG_MISSING_TRACK);
});

test('workspace overlays forward the product-specific About label to the dialog', async () => {
	const overlays = await readFile(new URL('AudioEditorWorkspaceOverlays.jsx', WORKSPACE_ROOT), 'utf8');
	assert.match(overlays, /<EditorDialog[\s\S]*aboutLabel=\{aboutLabel\}/u);
});

test('dialog surfaces use a drop shadow without blurring the editor behind them', async () => {
	const styles = (await Promise.all(DIALOG_STYLE_FILES.map((file) => readFile(file, 'utf8')))).join('\n');
	assert.doesNotMatch(styles, /backdrop-filter\s*:/u);
	assert.match(
		styles,
		/\.kw-audio-editor-dialog\s*\{[^}]*box-shadow:\s*0 24px 80px rgba\(0, 0, 0, 0\.38\);/su,
	);
});
