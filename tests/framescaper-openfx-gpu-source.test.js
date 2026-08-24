/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
	buildOpenFxNativeContractFixture,
	cleanupOpenFxNativeContractFixture,
} from './helpers/openfx-native-scanner-fixture.js';

const root = resolve(import.meta.dirname, '..');
const nativeRoot = join(root, 'native/framescaper-openfx-host');

test.after(cleanupOpenFxNativeContractFixture);

test('the native host contains real standard GPU context providers and no vendor suite shortcut', () => {
	const runtime = readFileSync(join(nativeRoot, 'src/gpu_runtime.cpp'), 'utf8');
	const host = readFileSync(join(nativeRoot, 'src/host_runtime.cpp'), 'utf8');
	const invocation = readFileSync(join(nativeRoot, 'src/host_runtime_invoke.inc'), 'utf8');
	for (const symbol of [
		'eglCreateContext', 'glFramebufferTexture2D', 'clCreateContext',
		'clCreateCommandQueue', 'cuCtxCreate_v2', 'cuStreamCreate',
		'MTLCreateSystemDefaultDevice', 'newCommandQueue',
	]) assert.match(runtime, new RegExp(symbol, 'u'));
	assert.match(host, /kOfxOpenGLRenderSuite/u);
	assert.match(host, /kOfxOpenCLProgramSuite/u);
	assert.match(invocation, /kOfxActionOpenGLContextAttached/u);
	assert.match(invocation, /kOfxActionOpenGLContextDetached/u);
	assert.doesNotMatch(`${runtime}\n${host}`, /OfxCudaVendorSuite|OfxMetalVendorSuite/u);
});

test('a qualified GPU setup failure is typed and can never report false native success', (context) => {
	const build = buildOpenFxNativeContractFixture(context);
	if (build === null) return;
	const result = spawnSync(build.runtime, [
		'--invoke', build.plugin, '--sha256', build.sha256,
		'--plugin', '0', '--context', 'filter', '--action', 'render', '--backend', 'cuda',
	], {
		encoding: 'utf8',
		env: { ...process.env, FRAMESCAPER_OPENFX_FIXTURE_GPU_FAILURE: 'cuda' },
	});
	assert.equal(result.status, 75);
	assert.deepEqual(JSON.parse(result.stderr), {
		error: 'gpu-execution-failed',
		message: 'The conformance GPU setup failed as requested.',
	});
	assert.equal(result.stdout, '');
});
