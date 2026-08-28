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
import {
	buildOpenFxGpuDriverFixture,
	cleanupOpenFxGpuDriverFixture,
} from './helpers/openfx-gpu-driver-fixture.js';

const root = resolve(import.meta.dirname, '..');
const nativeRoot = join(root, 'native/framescaper-openfx-host');

test.after(() => {
	cleanupOpenFxGpuDriverFixture();
	cleanupOpenFxNativeContractFixture();
});

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

test('OpenCL construction releases a created context and failed queue handle', (context) => {
	const fixture = buildOpenFxGpuDriverFixture(context);
	if (fixture === null) return;
	const observed = fixture.run('opencl', 'opencl-queue');
	assert.deepEqual({
		caught: observed.caught,
		contexts: [observed.contextsCreated, observed.contextsReleased],
		queues: [observed.queuesCreated, observed.queuesReleased],
	}, { caught: 1, contexts: [1, 1], queues: [1, 1] });
});

test('OpenCL construction releases prior buffers and the failing buffer handle', (context) => {
	const fixture = buildOpenFxGpuDriverFixture(context);
	if (fixture === null) return;
	const observed = fixture.run('opencl', 'opencl-buffer-2');
	assert.deepEqual({
		caught: observed.caught,
		contexts: [observed.contextsCreated, observed.contextsReleased],
		queues: [observed.queuesCreated, observed.queuesReleased],
		buffers: [observed.buffersCreated, observed.buffersReleased],
	}, { caught: 1, contexts: [1, 1], queues: [1, 1], buffers: [2, 2] });
});

test('CUDA construction records and frees an allocation before a failed host copy', (context) => {
	const fixture = buildOpenFxGpuDriverFixture(context);
	if (fixture === null) return;
	const observed = fixture.run('cuda', 'cuda-copy');
	assert.deepEqual({
		caught: observed.caught,
		contexts: [observed.contextsCreated, observed.contextsReleased],
		queues: [observed.queuesCreated, observed.queuesReleased],
		buffers: [observed.buffersCreated, observed.buffersReleased],
	}, { caught: 1, contexts: [1, 1], queues: [1, 1], buffers: [1, 1] });
});

test('EGL construction destroys its context and surface after make-current fails', (context) => {
	const fixture = buildOpenFxGpuDriverFixture(context);
	if (fixture === null) return;
	const observed = fixture.run('opengl', 'egl-make-current');
	assert.deepEqual({
		caught: observed.caught,
		contexts: [observed.contextsCreated, observed.contextsReleased],
		surfaces: [observed.surfacesCreated, observed.surfacesReleased],
		displaysTerminated: observed.displaysTerminated,
	}, { caught: 1, contexts: [1, 1], surfaces: [1, 1], displaysTerminated: 1 });
});

test('a failed OpenCL kernel build releases the unadopted program', (context) => {
	const fixture = buildOpenFxGpuDriverFixture(context);
	if (fixture === null) return;
	const observed = fixture.run('opencl', 'opencl-program-build', 'compile');
	assert.deepEqual({
		caught: observed.caught,
		compileStatus: observed.compileStatus,
		programs: [observed.programsCreated, observed.programsReleased],
	}, { caught: 0, compileStatus: 1002, programs: [1, 1] });
});

test('an OpenCL program returned with a creation error is still released', (context) => {
	const fixture = buildOpenFxGpuDriverFixture(context);
	if (fixture === null) return;
	const observed = fixture.run('opencl', 'opencl-program-create', 'compile');
	assert.deepEqual({
		caught: observed.caught,
		compileStatus: observed.compileStatus,
		programs: [observed.programsCreated, observed.programsReleased],
	}, { caught: 0, compileStatus: 1002, programs: [1, 1] });
});

test('the Apple-only Metal backend initializes only after the session is owned', () => {
	const runtime = readFileSync(join(nativeRoot, 'src/gpu_runtime.cpp'), 'utf8');
	const metal = runtime.slice(runtime.indexOf('class MetalSession'), runtime.indexOf('#endif', runtime.indexOf('class MetalSession')));
	assert.doesNotMatch(metal, /MetalSession\(const std::vector<GpuFrameBinding>& frames\)/u);
	assert.match(metal, /void initialize\(const std::vector<GpuFrameBinding>& frames\)/u);
	assert.match(metal, /PendingResource pending\{\[this, buffer\]/u);
	assert.match(runtime, /MetalSession::create\(frames\)/u);
});
