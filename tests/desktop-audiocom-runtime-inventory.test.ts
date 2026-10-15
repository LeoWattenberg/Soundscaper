/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { DESKTOP_EXPECTED_RUNTIME_FILES } from '../scripts/lib/desktop-project-library-runtime.mjs';
import { desktopProductRuntimeFiles } from '../scripts/lib/desktop-product-package-files.mjs';
import { assertStagedDesktopImportsResolve } from '../scripts/lib/desktop-staged-import-hygiene.mjs';
import {
	collectApplicationDesktopRuntimeReferences, collectDesktopProductRuntimeClosure,
} from '../scripts/lib/desktop-product-runtime-staging.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MEMBERS = ['desktop/audiocom-authorization.js', 'desktop/audiocom-integration.js', 'desktop/audiocom-links.js'];

test('Framescaper retains every audio.com module statically imported by the shared desktop entries', async context => {
	const configuration = ts.getParsedCommandLineOfConfigFile(join(ROOT, 'tsconfig.desktop-runtime.json'), {}, {
		...ts.sys, onUnRecoverableConfigFileDiagnostic: diagnostic => { throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')); },
	});
	assert.ok(configuration);
	const compiledRoot = await mkdtemp(join(tmpdir(), 'scape-audiocom-runtime-'));
	context.after(() => rm(compiledRoot, { recursive: true, force: true }));
	await mkdir(join(compiledRoot, 'desktop'));
	for (const member of MEMBERS) {
		assert.ok(DESKTOP_EXPECTED_RUNTIME_FILES.includes(member), `Global runtime must contain ${member}`);
		const sourcePath = join(ROOT, member.replace(/\.js$/u, '.ts'));
		assert.ok(configuration.fileNames.some(fileName => resolve(fileName) === sourcePath), `Runtime compiler must include ${sourcePath}`);
		const source = await readFile(sourcePath, 'utf8');
		const compiled = ts.transpileModule(source, { fileName: sourcePath, compilerOptions: configuration.options });
		await writeFile(join(compiledRoot, member), compiled.outputText);
	}
	await assertStagedDesktopImportsResolve(compiledRoot);
	assert.deepEqual(desktopProductRuntimeFiles('framescaper', MEMBERS), MEMBERS);
	const roots = await collectApplicationDesktopRuntimeReferences({
		applicationRoot: join(ROOT, 'desktop'), applicationFiles: ['main.mjs', 'preload.mjs'], completeFiles: MEMBERS,
	});
	assert.deepEqual(roots, MEMBERS);
	assert.deepEqual(await collectDesktopProductRuntimeClosure({
		compiledRoot, completeFiles: MEMBERS, rootFiles: roots, productId: 'framescaper',
	}), MEMBERS);
});
