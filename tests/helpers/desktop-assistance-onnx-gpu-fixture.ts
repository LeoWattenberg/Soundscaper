/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
import { createDesktopAssistanceOnnxNativeClosureManifest } from '../../scripts/lib/desktop-assistance-onnx-native-closure.mjs';

/** Fixtures follow the producer's independently pinned closure, not admission's list. */
export function onnxGpuTargetFixture(targetId: string, bytes = Buffer.from('authenticated GPU runtime')) {
	const [os, architecture] = targetId.split('-');
	const platform = os === 'mac' ? 'darwin' : os === 'win' ? 'win32' : os;
	const native = `node_modules/onnxruntime-node/bin/napi-v6/${platform}/${architecture}`;
	const executable = `onnx-webgpu-device-probe${os === 'win' ? '.exe' : ''}`;
	const paths: string[] = createDesktopAssistanceOnnxNativeClosureManifest(targetId).files
		.map(({ path }: { path: string }) => `${native}/${path}`);
	paths.push(...['onnxruntime_binding.node', executable, 'NODE-ADDON-API-LICENSE', 'NODE-LICENSE',
		'onnx-webgpu-build-provenance.json', ...(os === 'win' ? ['NODE-GYP-LICENSE'] : [])].map((path) => `${native}/${path}`));
	const entrypoint = 'node_modules/onnxruntime-node/dist/index.js';
	return {
		id: targetId, status: 'authenticated' as const, entrypoint,
		executionProviders: os === 'mac' ? ['coreml', 'webgpu', 'cpu'] : ['webgpu', 'cpu'],
		files: [entrypoint, ...paths].map((path) => ({ path, byteLength: bytes.length,
			sha256: createHash('sha256').update(bytes).digest('hex'), executable: path === `${native}/${executable}` })),
	};
}

export function onnxGpuDescriptorFixture(targetId: string, root = '/runtime') {
	const target = onnxGpuTargetFixture(targetId);
	const paths = root.startsWith('/') ? posix : win32;
	return {
		familyId: 'onnxruntime-node' as const, runtimeVersion: '1.29.0', target: targetId,
		executionProvider: 'cpu' as const, executionProviders: target.executionProviders,
		entrypoint: paths.join(root, ...target.entrypoint.split('/')),
		files: target.files.map((file) => ({ ...file, relativePath: file.path, path: paths.join(root, ...file.path.split('/')) })),
	};
}
