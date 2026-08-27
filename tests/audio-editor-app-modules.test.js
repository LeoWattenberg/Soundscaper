import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { sourceLineCount } from '../scripts/lib/source-line-count.mjs';

const UI_ROOT = new URL('../src/common/editor/ui/', import.meta.url);
const FEATURE_DIRECTORIES = Object.freeze([
	'dialogs',
	'toolbar',
	'workspace',
]);
const LAZY_DIALOGS = Object.freeze([
	'EditorDialog.jsx',
	'GeneratorDialog.jsx',
	'NyquistDialog.jsx',
	'SpectralSelectionDialog.jsx',
	'WorkspacePreferencesDialog.jsx',
]);

test('the editor app is a bounded shell with focused feature modules', async () => {
	const app = await readFile(new URL('AudioEditorApp.jsx', UI_ROOT), 'utf8');
	assert.ok(sourceLineCount(app) <= 600, 'AudioEditorApp.jsx must stay at or below 600 lines');

	for (const directoryName of FEATURE_DIRECTORIES) {
		const directory = new URL(`${directoryName}/`, UI_ROOT);
		const modules = (await readdir(directory)).filter((name) => /\.(?:jsx|ts|tsx)$/.test(name));
		assert.ok(modules.length > 0, `${directoryName} must contain focused production modules`);
		for (const moduleName of modules) {
			const source = await readFile(new URL(moduleName, directory), 'utf8');
			assert.ok(
				sourceLineCount(source) <= 600,
				`${directoryName}/${moduleName} must stay at or below 600 lines`,
			);
		}
	}
});

test('heavy workspace dialogs retain direct lazy entry points', async () => {
	const overlayOwner = await readFile(new URL('workspace/AudioEditorWorkspaceOverlays.jsx', UI_ROOT), 'utf8');
	for (const moduleName of LAZY_DIALOGS) {
		assert.match(
			overlayOwner,
			new RegExp(`import\\('\\.\\./dialogs/${moduleName.replaceAll('.', '\\.')}'\\)`),
			moduleName,
		);
		const source = await readFile(new URL(`dialogs/${moduleName}`, UI_ROOT), 'utf8');
		assert.match(source, /export default /, `${moduleName} must expose a lazy default export`);
	}
});

test('browser preferences do not retain the legacy FFmpeg offline runtime', async () => {
	const preferences = await readFile(new URL('dialogs/WorkspacePreferencesDialog.jsx', UI_ROOT), 'utf8');
	assert.doesNotMatch(preferences, /OfflineRuntimePreferencePanel/u);
	assert.doesNotMatch(preferences, /id: ['"]offline['"]/u);
	assert.doesNotMatch(preferences, /selectedPage === ['"]offline['"]/u);
});

test('menus and keyboard runtime are not owned by the React app shell', async () => {
	const app = await readFile(new URL('AudioEditorApp.jsx', UI_ROOT), 'utf8');
	assert.doesNotMatch(app, /function createApplicationMenus/);
	assert.doesNotMatch(app, /function handleWorkspaceKeyboard/);
	assert.doesNotMatch(app, /function projectZoomShortcut/);
	assert.doesNotMatch(app, /function matchAudioEditorShortcut/);
});

test('desktop read callers retain capabilities for their scoped consumers', async () => {
	const workspace = await readFile(new URL('workspace/AudioEditorWorkspace.jsx', UI_ROOT), 'utf8');
	const projectBin = await readFile(new URL('workspace/ProjectBinPanel.jsx', UI_ROOT), 'utf8');
	const desktopBridge = await readFile(new URL('workspace/useDesktopEditorBridge.js', UI_ROOT), 'utf8');
	assert.match(workspace, /withDesktopProjectReadDescriptor\(/u);
	assert.match(workspace, /fileService\.withReadDescriptors\(/u);
	assert.match(projectBin, /fileService\.withReadDescriptors\(/u);
	assert.match(desktopBridge, /openDesktopProjectDescriptor\(descriptor\)/u);
	for (const source of [workspace, projectBin, desktopBridge]) {
		assert.doesNotMatch(source, /fileService\.openReadDescriptor\(/u);
	}
});
