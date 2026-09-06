/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// The packaged direct-WAV smoke drives the real Export audio dialog by DOM
// selector, and it runs only in the nightly packaging job, so a dialog rework
// surfaces days later as a red nightly. Every selector and option label the
// smoke depends on must exist in the sources; a hook that keeps its name but
// changes its widget is still only caught by the packaged smoke itself.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SMOKE = readFileSync(join(ROOT, 'desktop/direct-wav-renderer-smoke.js'), 'utf8');
const SOURCE_ROOTS = ['src/common/editor', 'src/common/i18n'];

function sourceText(directory) {
	const texts = [];
	for (const entry of readdirSync(directory)) {
		const path = join(directory, entry);
		if (statSync(path).isDirectory()) texts.push(sourceText(path));
		else if (/\.(?:jsx?|tsx?)$/u.test(entry) && !entry.includes('.test.')) texts.push(readFileSync(path, 'utf8'));
	}
	return texts.join('\n');
}

const SOURCES = SOURCE_ROOTS.map((root) => sourceText(join(ROOT, root))).join('\n');

test('every export-dialog hook the packaged smoke drives exists in the dialog sources', () => {
	const hooks = new Map();
	for (const match of SMOKE.matchAll(/\[(data-export-[a-z-]+)(?:="([^"]+)")?\]/gu)) {
		hooks.set(`${match[1]}=${match[2] ?? ''}`, { name: match[1], value: match[2] ?? null });
	}
	assert.ok(hooks.size >= 8, 'the smoke drives the dialog through data-export hooks');
	for (const { name, value } of hooks.values()) {
		assert.ok(SOURCES.includes(name), `${name} is not rendered by any dialog source`);
		// A value the smoke interpolates at run time is checked by name only.
		if (value === null || value.includes('${')) continue;
		const literal = SOURCES.includes(`${name}="${value}"`)
			|| new RegExp(`['"\`]${value}['"\`]`, 'u').test(SOURCES);
		assert.ok(literal, `${name}="${value}" is not a value any dialog source renders`);
	}
});

test('every option label the packaged smoke chooses is copy the dialog offers', () => {
	const labels = [...SMOKE.matchAll(/choose\(dialog, '\[data-export-field="[a-zA-Z]+"\]', \d+, '([^']+)'\)/gu)]
		.map((match) => match[1]);
	assert.ok(labels.length >= 4, 'the smoke chooses dialog options by label');
	for (const label of labels) {
		// A label such as "16-bit PCM" is composed from its number at render
		// time, so the wording around the digits is what the sources must carry.
		const wording = label.replace(/\d+/gu, '');
		assert.ok(SOURCES.includes(label) || SOURCES.includes(wording), `${label} is not offered by the dialog`);
	}
});
