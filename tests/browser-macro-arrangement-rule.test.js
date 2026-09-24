/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';

const SPEC_DIRECTORY = new URL('./browser/', import.meta.url);
const HELPER = 'arrangeWithMacro';

/**
 * The macro surface's own golden paths, which must keep clicking.
 *
 * These specs exist to prove the things a macro run bypasses — that the menu
 * entry is reachable, that the dialog's lazy chunk resolves, that the manager's
 * controls do what their labels say. A macro cannot be used to reach their
 * subject, because their subject is the clicking.
 */
const MACRO_SURFACE_SPECS = Object.freeze([
	'audio-editor-macro-script.spec.js',
	'audio-editor-effects.spec.js',
]);

async function readSpecs() {
	const names = (await readdir(SPEC_DIRECTORY)).filter((name) => name.endsWith('.spec.js'));
	return Promise.all(names.map(async (name) => ({
		name,
		source: await readFile(new URL(name, SPEC_DIRECTORY), 'utf8'),
	})));
}

test('a macro arranges a state; it is never the state under test', async () => {
	// Use a macro to reach a state, never to be the state under test. Every UI
	// path a macro can shortcut keeps exactly one hand-clicked golden-path spec,
	// so a spec that takes the shortcut must not also assert on the surface it
	// skipped past — otherwise the coverage that spec appears to carry is
	// coverage nothing actually has.
	for (const { name, source } of await readSpecs()) {
		if (!source.includes(HELPER)) continue;
		assert.equal(MACRO_SURFACE_SPECS.includes(name), false,
			`${name} owns a macro golden path and must keep clicking it rather than calling ${HELPER}`);
		const asserted = source.match(/\[data-macro-[a-z-]*\]/gu) ?? [];
		assert.deepEqual(asserted, [],
			`${name} arranges with a macro, so it must not also assert on the macro surface`);
	}
});

test('the macro surface keeps its hand-clicked golden paths', async () => {
	const specs = new Map((await readSpecs()).map(({ name, source }) => [name, source]));
	for (const name of MACRO_SURFACE_SPECS) {
		const source = specs.get(name);
		assert.ok(source, `${name} is the golden-path spec for the macro surface and must exist`);
		assert.match(source, /Macro manager/u,
			`${name} must reach the Macro Manager the way a user does`);
	}
	// The helper states the rule where somebody about to use it will read it.
	const helper = await readFile(new URL('./helpers/macro-arrange.js', SPEC_DIRECTORY), 'utf8');
	assert.match(helper, /never to be the state under test/u);
});
