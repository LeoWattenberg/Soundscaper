/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, matchesGlob, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import config from '../electron-builder.nightly-tests.config.cjs';
import { NIGHTLY_TEST_PAYLOAD_INPUTS, NIGHTLY_TEST_RUNTIME_PACKAGE_ROOTS } from '../scripts/lib/desktop-nightly-tests-staging.mjs';

const root = resolve(import.meta.dirname, '..');
const prefix = 'scripts/performance/motionscaper-sustained-';
const reference = `${prefix}browser-reference.ts`, decoder = `${prefix}webm.ts`;
const expected = ['browser-reference', 'opus', 'plan', 'webm'].map(name => `${prefix}${name}.ts`);
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));

function packagedInputs() {
	assert.ok(Array.isArray(config.extraResources));
	const payload = config.extraResources.find(value => typeof value === 'object' && value.to === 'nightly-tests');
	assert.ok(payload && typeof payload === 'object' && Array.isArray(payload.filter));
	const filter = payload.filter;
	return NIGHTLY_TEST_PAYLOAD_INPUTS.filter(input => input.source.startsWith(prefix)).map(input => {
		assert.equal(input.kind, 'file');
		assert.equal(input.destination, input.source, 'The staged relative imports must keep their directory.');
		assert.ok(filter.some(pattern => matchesGlob(input.destination, pattern)), `Package filter drops ${input.destination}`);
		return input.source;
	}).sort();
}

async function bundle(directory: string, entry: string, platform: 'node' | 'browser') {
	return build({ absWorkingDir: directory, entryPoints: [resolve(directory, entry)], bundle: true, write: false, metafile: true,
		packages: 'external', platform, format: platform === 'node' ? 'esm' : 'iife',
		...(platform === 'browser' ? { globalName: 'MotionSustainedVerification' } : {}),
		tsconfigRaw: { compilerOptions: { alwaysStrict: true } }, logLevel: 'silent' });
}

test('Motion nightly ships the actual browser reference and dynamic decoder closure without host workload modules', async () => {
	const spec = await readFile(join(root, 'tests/browser/motionscaper-sustained-reference.spec.ts'), 'utf8');
	const imported = /import \{ verifyMotionSustainedBrowserVideo \} from '([^']+)'/u.exec(spec)?.[1];
	assert.ok(imported);
	const actualReference = relative(root, resolve(root, 'tests/browser', imported)).split(sep).join('/');
	const actualDecoder = /entryPoints: \[resolve\('([^']+)'\)\]/u.exec(spec)?.[1];
	assert.equal(actualDecoder, decoder, 'The runtime esbuild entry is part of the packaged source closure.');
	const node = await bundle(root, actualReference, 'node'), browser = await bundle(root, actualDecoder, 'browser');
	const reached = [...new Set([...Object.keys(node.metafile!.inputs), ...Object.keys(browser.metafile!.inputs)])].sort();
	assert.deepEqual(packagedInputs(), reached, 'Every actual graph input must survive staging and the package filter.');
	assert.deepEqual(reached, expected, 'The portable browser regression must not ship the native/process workload harness.');
	assert.equal(actualReference, reference);
	for (const output of [...Object.values(node.metafile!.outputs), ...Object.values(browser.metafile!.outputs)]) {
		for (const dependency of output.imports.filter(value => value.external)) {
			if (builtins.has(dependency.path)) continue;
			assert.equal(isAbsolute(dependency.path), false);
			const parts = dependency.path.split('/'), name = dependency.path.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
			assert.ok(NIGHTLY_TEST_RUNTIME_PACKAGE_ROOTS.includes(name), `Missing packaged runtime ${name}`);
		}
	}
});

async function withPayload(run: (directory: string) => Promise<void>) {
	const directory = await mkdtemp(join(tmpdir(), 'motion-nightly-oracle-'));
	try {
		for (const input of packagedInputs()) {
			await mkdir(dirname(join(directory, input)), { recursive: true });
			await copyFile(join(root, input), join(directory, input));
		}
		await run(directory);
	} finally { await rm(directory, { recursive: true, force: true }); }
}

test('Motion nightly reference and strict decoder rebuild from only the packaged local source bytes', async () => {
	await withPayload(async directory => {
		const node = await bundle(directory, reference, 'node'), browser = await bundle(directory, decoder, 'browser');
		assert.match(node.outputFiles[0]!.text, /verifyMotionSustainedBrowserVideo/u);
		assert.match(browser.outputFiles[0]!.text, /^"use strict";\s+var MotionSustainedVerification =/u);
		assert.match(browser.outputFiles[0]!.text, /verifyMotionSustainedWebm/u);
	});
});

for (const missing of ['webm', 'opus']) {
	test(`Motion nightly refuses the actual dynamic decoder when its ${missing} source is omitted`, async () => {
		await withPayload(async directory => {
			await bundle(directory, decoder, 'browser');
			await rm(join(directory, `${prefix}${missing}.ts`));
			await assert.rejects(bundle(directory, decoder, 'browser'), new RegExp(`Could not resolve .*motionscaper-sustained-${missing}\\.ts`, 'u'));
		});
	});
}
