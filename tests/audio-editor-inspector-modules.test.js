import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { sourceLineCount } from '../scripts/lib/source-line-count.mjs';

const FEATURE_MODULES = Object.freeze([
	'AnalysisPanel.jsx',
	'AudioEditorEffectsOverlay.jsx',
	'AudioEditorMacroManagerDialog.jsx',
	'ClipPropertiesDialog.jsx',
	'ExportDialog.jsx',
	'LabelExportDialog.jsx',
	'SelectionEffectsDialog.jsx',
]);

test('Inspector features have direct lazy entry points and bounded production modules', async () => {
	const app = await readFile(new URL('../src/common/editor/ui/AudioEditorApp.jsx', import.meta.url), 'utf8');
	const panelOwner = await readFile(new URL('../src/common/editor/ui/workspace/WorkspacePanelContent.jsx', import.meta.url), 'utf8');
	const overlayOwner = await readFile(new URL('../src/common/editor/ui/workspace/AudioEditorWorkspaceOverlays.jsx', import.meta.url), 'utf8');
	const lazyOwners = `${app}\n${panelOwner}\n${overlayOwner}`;
	assert.doesNotMatch(lazyOwners, /loadAudioEditorInspector|import\('\.\.\/AudioEditorInspector\.jsx'\)/);

	for (const moduleName of FEATURE_MODULES) {
		assert.match(lazyOwners, new RegExp(`inspector/${moduleName.replaceAll('.', '\\.')}`), moduleName);
		const source = await readFile(new URL(`../src/common/editor/ui/inspector/${moduleName}`, import.meta.url), 'utf8');
		assert.match(source, /export default /, `${moduleName} must expose a direct lazy default export`);
	}
});

test('every maintained Inspector production module stays below the local size budget', async () => {
	const directory = new URL('../src/common/editor/ui/inspector/', import.meta.url);
	const moduleNames = (await readdir(directory)).filter((name) => /\.(?:jsx|ts|tsx)$/.test(name));
	for (const moduleName of moduleNames) {
		const source = await readFile(new URL(moduleName, directory), 'utf8');
		assert.ok(sourceLineCount(source) <= 600, `${moduleName} must remain at or below 600 lines`);
	}
});

test('the legacy Inspector path is only a bounded compatibility facade', async () => {
	const facade = await readFile(new URL('../src/common/editor/ui/AudioEditorInspector.jsx', import.meta.url), 'utf8');
	assert.ok(sourceLineCount(facade) <= 30);
	for (const moduleName of FEATURE_MODULES) {
		assert.match(facade, new RegExp(`inspector/${moduleName.replace('.', '\\.')}`));
	}
});
