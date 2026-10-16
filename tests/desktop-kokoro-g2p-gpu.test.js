/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import recipe from '../config/assistance-kokoro-g2p-gpu-build.json' with { type: 'json' };
import {
	desktopKokoroG2pGpuBuildPlan, validateKokoroG2pGpuRecipe, verifyFrozenKokoroG2pGpu,
} from '../scripts/lib/desktop-kokoro-g2p-gpu.mjs';

for (const [targetId, platform, arch, payloadTargetId] of [
	['mac-arm64', 'darwin', 'arm64', 'mac-arm64'],
	['linux-x64', 'linux', 'x64', 'linux-x64'],
	['linux-arm64', 'linux', 'arm64', 'linux-arm64'],
	['win-x64', 'win32', 'x64', 'win-x64'],
	['win-arm64', 'win32', 'arm64', 'win-x64'],
]) test(`Kokoro learned G2P ${targetId} includes a GPU backend matching its frozen Python architecture`, () => {
	const plan = desktopKokoroG2pGpuBuildPlan({ targetId, platform, arch });
	assert.equal(plan.payloadTargetId, payloadTargetId);
	assert.deepEqual(plan.executionProviders, ['webgpu', 'cpu']);
	assert.equal(plan.sharedLibrary, platform === 'win32' ? 'scape-g2p-gpu.dll'
		: platform === 'darwin' ? 'libscape-g2p-gpu.dylib' : 'libscape-g2p-gpu.so');
	assert.equal(plan.probe, `onnx-webgpu-device-probe${platform === 'win32' ? '.exe' : ''}`);
});

test('Kokoro GPU build refuses foreign target runners and source recipe drift', async () => {
	assert.throws(() => desktopKokoroG2pGpuBuildPlan({ targetId: 'linux-arm64', platform: 'linux', arch: 'x64' }), /matching/iu);
	assert.throws(() => desktopKokoroG2pGpuBuildPlan({ targetId: 'win-x64', platform: 'linux', arch: 'x64' }), /matching/iu);
	assert.throws(() => validateKokoroG2pGpuRecipe({ ...recipe, executionProviders: ['cpu'] }), /GPU|provider|recipe/iu);
	const replaced = structuredClone(recipe);
	delete replaced.recipeFiles['native/assistance-kokoro-g2p-gpu/ort-gemm.cc'];
	replaced.recipeFiles['native/unrelated.cc'] = 'a'.repeat(64);
	assert.throws(() => validateKokoroG2pGpuRecipe(replaced), /recipe/iu);
	validateKokoroG2pGpuRecipe(recipe);
	for (const [path, expected] of Object.entries(recipe.recipeFiles)) {
		const bytes = await readFile(new URL(`../${path}`, import.meta.url));
		assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, path);
	}
});

test('freezing preserves exactly the authenticated GPU native closure', async (t) => {
	const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
	const { tmpdir } = await import('node:os');
	const { join } = await import('node:path');
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-frozen-g2p-gpu-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const bytes = Buffer.from('authenticated native bytes');
	const files = [{ path: 'native.dll', byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex') }];
	await writeFile(join(root, 'native.dll'), bytes);
	await verifyFrozenKokoroG2pGpu(root, files);
	await writeFile(join(root, 'native.dll'), 'modified native bytes');
	await assert.rejects(verifyFrozenKokoroG2pGpu(root, files), /authenticated/iu);
	await writeFile(join(root, 'native.dll'), bytes);
	await writeFile(join(root, 'unexpected.dll'), bytes);
	await assert.rejects(verifyFrozenKokoroG2pGpu(root, files), /inventory/iu);
	await rm(join(root, 'native.dll'));
	await assert.rejects(verifyFrozenKokoroG2pGpu(root, files), /inventory/iu);
});

test('the Python GPU and phonemizer boundaries run with only the Python standard library', async () => {
	const { execFile } = await import('node:child_process');
	const { promisify } = await import('node:util');
	await promisify(execFile)(process.platform === 'win32' ? 'python' : 'python3', [
		'-m', 'unittest', 'discover', '-s', 'tests/python', '-p', 'test_kokoro_g2p_*.py',
	], { cwd: new URL('../', import.meta.url), env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
});

test('a Windows CRLF checkout preserves every pinned GPU recipe source', async (t) => {
	const { execFile } = await import('node:child_process');
	const { promisify } = await import('node:util');
	const { copyFile, mkdir, mkdtemp, rm } = await import('node:fs/promises');
	const { tmpdir } = await import('node:os');
	const { dirname, join } = await import('node:path');
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-g2p-gpu-source-checkout-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	await copyFile(new URL('../.gitattributes', import.meta.url), join(root, '.gitattributes'));
	for (const path of Object.keys(recipe.recipeFiles)) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await copyFile(new URL(`../${path}`, import.meta.url), join(root, path));
	}
	const git = (args) => promisify(execFile)('git', [
		'-c', 'core.autocrlf=true', '-c', 'core.eol=crlf', '-c', 'core.attributesFile=', ...args,
	], { cwd: root });
	await git(['init', '--quiet']);
	await git(['add', '--', '.gitattributes', ...Object.keys(recipe.recipeFiles)]);
	for (const path of Object.keys(recipe.recipeFiles)) await rm(join(root, path));
	await git(['checkout-index', '--force', '--', ...Object.keys(recipe.recipeFiles)]);
	for (const [path, expected] of Object.entries(recipe.recipeFiles)) {
		assert.equal(createHash('sha256').update(await readFile(join(root, path))).digest('hex'), expected, path);
	}
});
