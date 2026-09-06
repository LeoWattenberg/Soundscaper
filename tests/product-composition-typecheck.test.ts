/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { createProductCompilerHost } from '../scripts/lib/product-compiler-host.mjs';

test('composed typechecking diagnoses incompatible replacement arguments and return values', () => {
	const root = mkdtempSync(join(tmpdir(), 'scape-composition-'));
	try {
		writeFileSync(join(root, 'consumer.ts'), [
			"import { run } from './runtime.ts';",
			'export const result: number = run(42);',
		].join('\n'));
		writeFileSync(join(root, 'runtime.ts'), 'export function run(value: number): number { return value; }');
		writeFileSync(join(root, 'replacement.ts'), 'export function run(value: string): string { return value; }');
		const options: ts.CompilerOptions = {
			strict: true, noEmit: true, skipLibCheck: true, types: [],
			allowImportingTsExtensions: true, module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
		};
		const baseline = ts.createProgram([join(root, 'consumer.ts')], options);
		assert.deepEqual(ts.getPreEmitDiagnostics(baseline), []);
		const host = createProductCompilerHost(options, {
			repositoryRoot: root,
			aliases: [{ find: /^\.\/runtime\.ts$/u, standIn: 'replacement.ts' }],
		});
		const composed = ts.createProgram([join(root, 'consumer.ts')], options, host);
		const codes = ts.getPreEmitDiagnostics(composed).map((diagnostic) => diagnostic.code);
		assert.ok(codes.includes(2345), 'the replacement must reject the caller’s numeric argument');
		assert.ok(codes.includes(2322), 'the replacement’s string result must fail the caller’s numeric contract');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
