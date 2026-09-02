/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);
const HEADER_TSX = new URL('vendor/audacity-design-system/components/src/DialogHeader/DialogHeader.tsx', ROOT);
const HEADER_CSS = new URL('vendor/audacity-design-system/components/src/DialogHeader/DialogHeader.css', ROOT);
const UI_ROOT = new URL('src/common/editor/ui/', ROOT);

// Segoe MDL2 Assets is a Windows-only font, and its icons live in the Unicode
// private use area. Where the font is absent — every Linux desktop — those
// codepoints render as a missing-glyph box, so the dialog close button showed
// tofu instead of an X.
test('window controls draw their marks without the Segoe private-use codepoints', async () => {
	const tsx = await readFile(HEADER_TSX, 'utf8');
	const css = await readFile(HEADER_CSS, 'utf8');

	assert.doesNotMatch(tsx, /\\u[EF][0-9A-F]{3}/u, 'a private-use escape has no glyph without Segoe MDL2 Assets');
	assert.doesNotMatch(
		css,
		/font-family:[^;]*Segoe MDL2 Assets/u,
		'the control must not depend on a Windows-only font',
	);
	assert.match(
		tsx,
		/dialog-header__windows-control--close[\s\S]*?<Icon name="close"/u,
		'close renders through the bundled MuseScore icon font',
	);
	assert.match(css, /\.dialog-header__windows-glyph\s*\{/u, 'maximize draws a CSS square rather than a font glyph');
});

// The vendored default is os="macos", which renders traffic lights. Any app
// dialog that forgets the prop diverges from every other dialog in the product.
test('every application DialogHeader chooses its control layout explicitly', async () => {
	const offenders: string[] = [];
	const files = await collectSources(UI_ROOT);
	for (const file of files) {
		const source = await readFile(file, 'utf8');
		if (!source.includes('<DialogHeader')) continue;
		for (const match of source.matchAll(/<DialogHeader\b([\s\S]*?)(?:\/>|>)/gu)) {
			const props = match[1];
			if (!/\bos=/u.test(props) && !/\{\.\.\.headerProps\}/u.test(props)) {
				offenders.push(`${file.pathname.split('/src/')[1]}: <DialogHeader${props.slice(0, 40).trim()}`);
			}
		}
	}

	assert.deepEqual(offenders, [], 'an omitted os prop falls back to macOS traffic lights');
});

async function collectSources(directory: URL): Promise<URL[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files: URL[] = [];
	for (const entry of entries) {
		if (entry.isDirectory()) {
			files.push(...await collectSources(new URL(`${entry.name}/`, directory)));
		} else if (/\.(?:jsx?|tsx?)$/u.test(entry.name)) {
			files.push(new URL(entry.name, directory));
		}
	}
	return files;
}
