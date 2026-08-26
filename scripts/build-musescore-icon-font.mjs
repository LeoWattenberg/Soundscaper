#!/usr/bin/env node

/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import wawoff2 from 'wawoff2';

const root = resolve(import.meta.dirname, '..');
export const MUSESCORE_ICON_TTF_PATH = resolve(
	root,
	'vendor/audacity-design-system/components/src/assets/fonts/MusescoreIcon.ttf',
);
export const MUSESCORE_ICON_WOFF2_PATH = resolve(
	root,
	'vendor/audacity-design-system/components/src/assets/fonts/MusescoreIcon.woff2',
);

export async function buildMusescoreIconFont({ check = false } = {}) {
	const source = await readFile(MUSESCORE_ICON_TTF_PATH);
	const first = Buffer.from(await wawoff2.compress(source));
	const second = Buffer.from(await wawoff2.compress(source));
	if (!first.equals(second)) throw new Error('MusescoreIcon WOFF2 generation is not deterministic.');
	if (check) {
		const existing = await readFile(MUSESCORE_ICON_WOFF2_PATH);
		if (!first.equals(existing)) {
			throw new Error('MusescoreIcon.woff2 is stale; run npm run build:musescore-icon-font.');
		}
		return Object.freeze({ byteLength: first.byteLength, changed: false });
	}
	let existing = null;
	try { existing = await readFile(MUSESCORE_ICON_WOFF2_PATH); } catch {}
	const changed = !existing?.equals(first);
	if (changed) await writeFile(MUSESCORE_ICON_WOFF2_PATH, first);
	return Object.freeze({ byteLength: first.byteLength, changed });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const argument = process.argv[2];
	if (argument && argument !== '--check') throw new Error(`Unknown option: ${argument}`);
	const result = await buildMusescoreIconFont({ check: argument === '--check' });
	console.log(`MusescoreIcon.woff2: ${result.byteLength} bytes${result.changed ? ' (updated)' : ''}`);
}
