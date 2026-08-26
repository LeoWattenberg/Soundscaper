/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

// A quality collector that no `npm run` entry names cannot be invoked from a
// workflow file, so its numbers are only ever produced by somebody typing the
// path by hand. Every collector therefore owns an alias, and this pins that.
const ROOT = resolve(import.meta.dirname, '..');
const COLLECTOR_PATTERN = /^collect-.*\.mjs$/u;

function collectorScripts(): readonly string[] {
	return readdirSync(resolve(ROOT, 'scripts'))
		.filter((entry) => COLLECTOR_PATTERN.test(entry))
		.map((entry) => `scripts/${entry}`)
		.sort();
}

function packageScripts(): Readonly<Record<string, string>> {
	const manifest: unknown = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
	assert.ok(manifest !== null && typeof manifest === 'object', 'package.json must parse to an object.');
	const scripts = (manifest as { scripts?: unknown }).scripts;
	assert.ok(scripts !== null && typeof scripts === 'object', 'package.json must declare scripts.');
	return scripts as Readonly<Record<string, string>>;
}

test('every quality collector is reachable through an npm run alias', () => {
	const commands = Object.values(packageScripts());
	const unreachable = collectorScripts()
		.filter((script) => !commands.some((command) => command.includes(script)));
	assert.deepEqual(unreachable, [], `Collectors without an npm alias: ${unreachable.join(', ')}`);
});

test('collector aliases live under the quality namespace and invoke node directly', () => {
	const scripts = packageScripts();
	const aliases = Object.entries(scripts)
		.filter(([, command]) => COLLECTOR_PATTERN.test(command.split('/').at(-1)?.split(' ').at(0) ?? ''));
	assert.ok(aliases.length >= collectorScripts().length, 'Each collector needs at least one alias.');
	for (const [name, command] of aliases) {
		assert.match(name, /^quality:(?:collect|cohort):/u, `${name} must be a quality namespace alias.`);
		assert.match(command, /^node scripts\/collect-/u, `${name} must invoke its collector with node.`);
	}
});
