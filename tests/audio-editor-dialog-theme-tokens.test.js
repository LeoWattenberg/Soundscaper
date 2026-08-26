/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);
const DESIGN_SYSTEM_RUNTIME = new URL('src/common/editor/ui/DesignSystemRuntime.jsx', ROOT);
const DIALOG_STYLES = new URL('src/common/editor/ui/dialogs/', ROOT);

/**
 * A `var()` fallback is silent: a token that exists nowhere always resolves to
 * its hardcoded literal, so a light-theme colour survives into dark theme with
 * no error anywhere. Every custom property a stylesheet reads therefore has to
 * be one the runtime actually publishes.
 */
test('dialog stylesheets only read theme tokens the runtime defines', async () => {
	const runtime = await readFile(DESIGN_SYSTEM_RUNTIME, 'utf8');
	const defined = new Set([...runtime.matchAll(/'(--[\w-]+)'\s*:/gu)].map(([, name]) => name));
	assert.ok(defined.size > 10, 'the runtime publishes a token palette');

	const missing = [];
	for (const entry of await readdir(DIALOG_STYLES)) {
		if (!entry.endsWith('.css')) continue;
		const css = await readFile(new URL(entry, DIALOG_STYLES), 'utf8');
		for (const [, name] of css.matchAll(/var\(\s*(--kw-[\w-]+)/gu)) {
			if (!defined.has(name)) missing.push(`${entry}: ${name}`);
		}
	}

	assert.deepEqual(missing, [], 'undefined tokens always fall back to their literal colour');
});

test('the inline video clip rename field does not inherit its light-on-dark header colour', async () => {
	const css = await readFile(
		new URL('src/common/editor/ui/audio-editor-design-system/07-timeline-tracks.css', ROOT),
		'utf8',
	);
	const rule = /\.audio-editor-video-clip__title-input\s*\{([^}]*)\}/u.exec(css);
	assert.ok(rule, 'the rename field is styled');
	assert.match(rule[1], /background:\s*rgb\(255 255 255/u, 'the field is a light surface');
	assert.doesNotMatch(
		rule[1],
		/color:\s*inherit/u,
		'inheriting the header colour puts near-white text on a near-white field',
	);
	assert.match(rule[1], /color:\s*#14151a/u);
});
