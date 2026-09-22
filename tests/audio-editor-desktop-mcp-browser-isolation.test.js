/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';

const SOURCES = [
	['../src/common/editor/file-service.js', 'js'],
	['../src/common/editor/ui/workspace/workspace-application-menu-runtime.js', 'js'],
	['../src/common/editor/ui/workspace/AudioEditorWorkspaceOverlays.jsx', 'jsx'],
	['../src/common/i18n/editor-copy-inventory.ts', 'ts'],
];
const MCP_MARKERS = /(?:readMcpStatus|startMcp|stopMcp|onMcpRequest|respondMcpRequest|desktop-mcp|desktopMcp)/u;

test('desktop MCP bridge and menu code compile out of browser renderers', async () => {
	for (const [sourcePath, loader] of SOURCES) {
		const markers = sourcePath.includes('editor-copy-inventory') ? /desktopMcp/u : MCP_MARKERS;
		const source = await readFile(new URL(sourcePath, import.meta.url), 'utf8');
		const browser = await transform(source, {
			loader,
			define: { __SCAPE_DESKTOP_RENDERER__: 'false' },
			minify: true,
		});
		const desktop = await transform(source, {
			loader,
			define: { __SCAPE_DESKTOP_RENDERER__: 'true' },
			minify: true,
		});
		assert.equal(markers.test(browser.code), false,
			`${sourcePath} contains desktop MCP code in the browser renderer`);
		assert.equal(markers.test(desktop.code), true,
			`${sourcePath} lost desktop MCP code from the desktop renderer`);
	}
});

test('desktop MCP English and German copy compile out of browser renderers', async () => {
	const source = await readFile(new URL('../src/common/i18n/editor-desktop-mcp-copy.ts', import.meta.url), 'utf8');
	const browser = await transform(source, {
		loader: 'ts', define: { __SCAPE_DESKTOP_RENDERER__: 'false' }, minify: true,
	});
	const desktop = await transform(source, {
		loader: 'ts', define: { __SCAPE_DESKTOP_RENDERER__: 'true' }, minify: true,
	});
	assert.equal(browser.code.includes('MCP connection'), false);
	assert.equal(browser.code.includes('MCP-Verbindung'), false);
	assert.equal(desktop.code.includes('MCP connection'), true);
	assert.equal(desktop.code.includes('MCP-Verbindung'), true);
});
