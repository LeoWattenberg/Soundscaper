/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import manifest from '../config/assistance-native-runtime-manifest.json' with { type: 'json' };
import {
	assistanceNativeRuntimeStageSummary,
	assistanceNativeRuntimeTargetId,
	stageAssistanceNativeRuntimePayload,
	verifyAssistanceNativeRuntimePayload,
} from '../desktop/assistance-native-runtime-payload.mjs';

test('the pinned Linux x64 assistance runtime stages and reauthenticates its exact closure', async (context) => {
	const outputRoot = await temporaryRoot(context);
	const summary = await stageAssistanceNativeRuntimePayload({
		manifest,
		targetId: 'linux-x64',
		nodeModulesRoot: resolve('node_modules'),
		outputRoot,
	});
	assert.deepEqual(summary, assistanceNativeRuntimeStageSummary(manifest, 'linux-x64'));
	const verified = await verifyAssistanceNativeRuntimePayload({ manifest, targetId: 'linux-x64', outputRoot });
	assert.equal(verified.status, 'built');
	assert.equal(verified.moduleSpecifier,
		new URL('file://').protocol === 'file:'
			? new URL(`file://${verified.modulePath}`).href
			: null);
	assert.match(verified.moduleSpecifier, /sherpa-onnx-node\/sherpa-onnx\.js$/u);
	assert.equal(verified.fileCount, 26);
});

test('the assistance runtime refuses changed, extra, and symbolic staged bytes', async (context) => {
	for (const failure of ['changed', 'extra', 'symbol']) {
		const outputRoot = await temporaryRoot(context);
		await stageAssistanceNativeRuntimePayload({
			manifest, targetId: 'linux-x64', nodeModulesRoot: resolve('node_modules'), outputRoot,
		});
		const packageRoot = join(outputRoot, manifest.runtimePrefix, 'node_modules/sherpa-onnx-linux-x64');
		if (failure === 'changed') await writeFile(join(packageRoot, 'index.js'), 'changed');
		if (failure === 'extra') await writeFile(join(packageRoot, 'extra.dll'), 'extra');
		if (failure === 'symbol') {
			await rm(join(packageRoot, 'index.js'));
			await symlink(join(packageRoot, 'README.md'), join(packageRoot, 'index.js'));
		}
		await assert.rejects(
			verifyAssistanceNativeRuntimePayload({ manifest, targetId: 'linux-x64', outputRoot }),
			/digest|length|inventory|symbolic|regular/iu,
			failure,
		);
	}
});

test('unsupported targets are explicit and may not carry staged executable bytes', async (context) => {
	const outputRoot = await temporaryRoot(context);
	const summary = await stageAssistanceNativeRuntimePayload({
		manifest, targetId: 'win-arm64', nodeModulesRoot: resolve('node_modules'), outputRoot,
	});
	assert.equal(summary.status, 'unsupported');
	const verified = await verifyAssistanceNativeRuntimePayload({ manifest, targetId: 'win-arm64', outputRoot });
	assert.equal(verified.status, 'unsupported');
	assert.equal(verified.moduleSpecifier, null);
	await cp(resolve('node_modules/sherpa-onnx-node'),
		join(outputRoot, manifest.runtimePrefix, 'node_modules/sherpa-onnx-node'), { recursive: true });
	await assert.rejects(
		verifyAssistanceNativeRuntimePayload({ manifest, targetId: 'win-arm64', outputRoot }),
		/unsupported.*payload|must not carry/iu,
	);
});

test('platform identities map only to the five release targets', () => {
	assert.equal(assistanceNativeRuntimeTargetId({ platform: 'linux', arch: 'x64' }), 'linux-x64');
	assert.equal(assistanceNativeRuntimeTargetId({ platform: 'linux', arch: 'arm64' }), 'linux-arm64');
	assert.equal(assistanceNativeRuntimeTargetId({ platform: 'darwin', arch: 'arm64' }), 'mac-arm64');
	assert.equal(assistanceNativeRuntimeTargetId({ platform: 'win32', arch: 'x64' }), 'win-x64');
	assert.equal(assistanceNativeRuntimeTargetId({ platform: 'win32', arch: 'arm64' }), 'win-arm64');
	assert.throws(() => assistanceNativeRuntimeTargetId({ platform: 'darwin', arch: 'x64' }), /unsupported/iu);
});

test('production assistance registration verifies the target payload before helper spawn', async () => {
	const source = await readFile(new URL('../desktop/assistance-registration.mjs', import.meta.url), 'utf8');
	assert.match(source, /verifyAssistanceNativeRuntimePayload/iu);
	assert.match(source, /SOUNDSCAPER_ASSISTANCE_RUNTIME_ROOT/iu);
	assert.doesNotMatch(source, /verifyBinary:\s*\(\)\s*=>\s*Promise\.resolve/iu);
});

async function temporaryRoot(context) {
	const root = await mkdtemp(join(tmpdir(), 'assistance-native-runtime-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}
