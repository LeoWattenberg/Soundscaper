/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

import { DESKTOP_EFFECT_RUNTIME_FILES } from '../scripts/lib/desktop-effect-runtime-files.mjs';
import { DESKTOP_EXPECTED_RUNTIME_FILES } from '../scripts/lib/desktop-project-library-runtime.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const EFFECT_ROOT = 'src/common/editor/audacity-effects/';

test('desktop effect inventory ships the emitted dependencies of realtime Reverb', async () => {
	const queued = [`${EFFECT_ROOT}live.js`, `${EFFECT_ROOT}live-capabilities.js`];
	const emitted = new Set(queued);
	for (let index = 0; index < queued.length; index += 1) {
		const member = queued[index]!;
		const source = await readEffectSource(member);
		const output = ts.transpileModule(source.text, {
			fileName: source.path,
			compilerOptions: {
				module: ts.ModuleKind.ESNext,
				target: ts.ScriptTarget.ES2024,
				rewriteRelativeImportExtensions: true,
			},
		}).outputText;
		const parsed = ts.createSourceFile(member, output, ts.ScriptTarget.ES2024);
		for (const statement of parsed.statements) {
			if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
			const specifier = statement.moduleSpecifier;
			if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) continue;
			const dependency = relative(ROOT, resolve(ROOT, dirname(member), specifier.text)).split(sep).join('/');
			if (!dependency.startsWith(EFFECT_ROOT) || emitted.has(dependency)) continue;
			emitted.add(dependency);
			queued.push(dependency);
		}
	}

	assert.equal(emitted.has(`${EFFECT_ROOT}reverb-parameters.js`), true,
		'the capability graph must declare the pure Reverb parameters and tail helper');
	assert.equal(emitted.has(`${EFFECT_ROOT}reverb-live-processor.js`), true,
		'the realtime dispatcher must declare the persistent Reverb processor');
	assert.deepEqual([...emitted].filter((member) => !DESKTOP_EXPECTED_RUNTIME_FILES.includes(member)).sort(), [],
		'every runtime module emitted for the realtime effect graph must be staged');
	for (const member of [`${EFFECT_ROOT}reverb-parameters.js`, `${EFFECT_ROOT}reverb-live-processor.js`]) {
		assert.equal(DESKTOP_EFFECT_RUNTIME_FILES.includes(member), true,
			`${member} must belong to the desktop effect inventory`);
	}
});

async function readEffectSource(member: string): Promise<{ path: string; text: string }> {
	const path = join(ROOT, member);
	try {
		return { path, text: await readFile(path, 'utf8') };
	} catch (error) {
		if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
		const typescriptPath = path.replace(/\.js$/u, '.ts');
		return { path: typescriptPath, text: await readFile(typescriptPath, 'utf8') };
	}
}
