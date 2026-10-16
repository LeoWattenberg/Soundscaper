/* SPDX-License-Identifier: AGPL-3.0-only */

import { posix, win32 } from 'node:path';

interface ClosureOptions {
	readonly familyId: string;
	readonly targetId: string;
	readonly entrypoint: string;
	readonly executionProviders?: readonly string[];
	readonly absolute?: boolean;
	readonly files: readonly Readonly<{ path: string; relativePath?: string; executable: boolean }>[];
}

/** Keep this platform inventory aligned with the producer's pinned native closure. */
export function validateAssistanceOnnxGpuClosure(options: ClosureOptions): void {
	if (options.familyId !== 'onnxruntime-node' || !options.executionProviders?.includes('webgpu')) return;
	const [os, architecture] = options.targetId.split('-');
	const platform = os === 'mac' ? 'darwin' : os === 'win' ? 'win32' : os;
	const native = `node_modules/onnxruntime-node/bin/napi-v6/${platform}/${architecture}`;
	const windows = os === 'win', mac = os === 'mac';
	const probe = `onnx-webgpu-device-probe${windows ? '.exe' : ''}`;
	const names = ['onnxruntime_binding.node', probe, 'onnx-webgpu-build-provenance.json',
		'ONNX-WebGPU-LICENSE', 'ONNX-WebGPU-ThirdPartyNotices.txt',
		'ONNXRuntime-LICENSE', 'ONNXRuntime-ThirdPartyNotices.txt', 'NODE-ADDON-API-LICENSE', 'NODE-LICENSE',
		...(windows ? ['onnxruntime.dll', 'onnxruntime_providers_webgpu.dll', 'dxcompiler.dll', 'dxil.dll',
			'NODE-GYP-LICENSE', 'DirectXShaderCompiler-LICENSE', 'DirectXShaderCompiler-ThirdPartyNotices.txt',
			'DirectXShaderCompiler-ReleaseNotes.md'] : mac
			? ['libonnxruntime.1.29.0.dylib', 'libonnxruntime.1.dylib', 'libonnxruntime_providers_webgpu.dylib']
			: ['libonnxruntime.so.1', 'libonnxruntime_providers_webgpu.so'])];
	const entrypoint = 'node_modules/onnxruntime-node/dist/index.js';
	const paths = options.entrypoint.startsWith('/') ? posix : win32;
	let root = options.entrypoint;
	for (let levels = entrypoint.split('/').length; levels > 0; levels -= 1) root = paths.dirname(root);
	const expectedEntry = options.absolute ? paths.join(root, ...entrypoint.split('/')) : entrypoint;
	if (options.entrypoint !== expectedEntry) throw new TypeError('The ONNX WebGPU closure entrypoint is invalid.');
	for (const relative of [entrypoint, ...names.map((name) => `${native}/${name}`)]) {
		const file = options.files.find((candidate) => (candidate.relativePath ?? candidate.path) === relative);
		const expected = options.absolute ? paths.join(root, ...relative.split('/')) : relative;
		if (!file || file.path !== expected || file.executable !== (relative === `${native}/${probe}`)) {
			throw new TypeError('The ONNX WebGPU closure is missing an authenticated native provider, executable probe, or notice.');
		}
	}
}
