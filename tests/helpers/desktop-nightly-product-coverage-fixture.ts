/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPackage } from '@electron/asar';

import { assistanceNativeRuntimeStageSummary } from '../../desktop/assistance-native-runtime-payload.mjs';
import { DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS } from '../../desktop/renderer-smoke-execution.js';

export const REVISION = '0123456789abcdef0123456789abcdef01234567';
const DYNAMIC_EXCLUSIONS = Object.values(DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS)
	.filter(({ products }) => products.includes('soundscaper'))
	.map(({ marker, pathPrefix }, index) => (
		`export const dynamic_recipe_${index} = ${JSON.stringify(`${marker}\n${pathPrefix}`)};`
	)).join('\n');
export const RUNTIME_SCRIPT = [
	'assistance/sherpa-onnx/1.13.5/node_modules',
	'sherpa-onnx-node/sherpa-onnx.js',
].join('/');
const KOKORO_RUNTIME_PREFIX = 'assistance/kokoro-g2p/0.9.4/linux-x64';
export const KOKORO_RUNTIME_SCRIPT = `${KOKORO_RUNTIME_PREFIX}/_internal/torch/utils/model_dump/code.js`;
const KOKORO_EXECUTABLE = `${KOKORO_RUNTIME_PREFIX}/kokoro-g2p`;
export const RENDERER_WASM = 'renderer/assets/sqlite3-fixture.wasm';
export const RUNTIME_WASM = 'runtime/model/engine.wasm';
export const WASM = '\u0000asm\u0001\u0000\u0000\u0000';
export const STARTUP_JSON_DOCUMENT = '<main></main><script type="application/json" data-editor-startup-assets>{"assets":[]}</script>\n';

interface CoverageFixtureOptions {
	readonly kokoroRuntimeAuthority?: boolean;
	readonly packagedApplicationExtras?: ReadonlyMap<string, string>;
	readonly packagedResourceExtras?: ReadonlyMap<string, string>;
	readonly packagedResourcesPath?: string;
	readonly productId?: 'soundscaper' | 'framescaper';
	readonly rendererDocument?: string;
	readonly runtimeAuthority?: boolean;
	readonly runtimeScripts?: ReadonlyMap<string, string>;
}

export async function createCoverageFixture(workspace: string, options: CoverageFixtureOptions = {}) {
	const buildRoot = join(workspace, '.desktop-build');
	const productId = options.productId ?? 'soundscaper';
	const productOutput = join(workspace, 'release', productId);
	const runtimeAuthority = options.runtimeAuthority ?? true;
	const runtimeScripts = options.runtimeScripts ?? new Map(runtimeAuthority
		? [[RUNTIME_SCRIPT, 'module.exports = true;\n']]
		: []);
	const kokoroRuntimeAuthority = options.kokoroRuntimeAuthority ?? false;
	const files = new Map([
		['app/desktop/main.mjs', `export const main = true;\n${DYNAMIC_EXCLUSIONS}\n`],
		['app/desktop/preload.cjs', 'module.exports = true;\n'],
		['app/desktop/window.html', '<script src="preload.cjs"></script>\n'],
		['app/desktop/ignored.json', '{}\n'],
		['renderer/assets/editor-abc.js', 'globalThis.editor = true;\n'],
		['renderer/desktop-renderer-smoke.js', 'export const smoke = true;\n'],
		[RENDERER_WASM, WASM],
		['renderer/index.html', options.rendererDocument ?? '<main></main>\n'],
		['renderer-source-maps/desktop-renderer-smoke.js.map', JSON.stringify({ version: 3, sources: [] })],
		['renderer-source-maps/editor-abc.js.map', JSON.stringify({ version: 3, sources: [] })],
		...[...runtimeScripts].map(([name, contents]) => [`runtime/${name}`, contents] as const),
		...(kokoroRuntimeAuthority ? [
			[`runtime/${KOKORO_RUNTIME_SCRIPT}`, 'globalThis.modelDump = true;\n'],
			[`runtime/${KOKORO_EXECUTABLE}`, '#!/bin/sh\n'],
		] as const : []),
		[RUNTIME_WASM, WASM],
	]);
	const nativeManifest = runtimeAuthority
		? assistanceNativeManifest(files.get(`runtime/${RUNTIME_SCRIPT}`) ?? '')
		: null;
	if (nativeManifest !== null) {
		files.set(
			'app/config/assistance-native-runtime-manifest.json',
			`${JSON.stringify(nativeManifest, null, 2)}\n`,
		);
	}
	const kokoroManifest = kokoroRuntimeAuthority ? assistanceKokoroG2pManifest(files) : null;
	const kokoroManifestSource = kokoroManifest === null
		? null
		: `${JSON.stringify(kokoroManifest, null, 2)}\n`;
	if (kokoroManifestSource !== null) {
		files.set('app/config/assistance-kokoro-g2p-runtime-manifest.json', kokoroManifestSource);
	}
	const kokoroManifestBytes = kokoroManifestSource === null ? null : Buffer.from(kokoroManifestSource);
	for (const [name, contents] of files) await write(join(buildRoot, name), contents);
	await write(join(buildRoot, 'stage-manifest.json'), `${JSON.stringify({
		schemaVersion: 1,
		productId,
		sourceRevision: REVISION,
		target: { platform: 'linux', arch: 'x64' },
		...(nativeManifest === null ? {} : {
			assistanceNativeRuntime: assistanceNativeRuntimeStageSummary(nativeManifest, 'linux-x64'),
		}),
		...(kokoroManifest === null || kokoroManifestBytes === null ? {} : {
			kokoroG2pRuntime: {
				targetId: 'linux-x64',
				fileCount: kokoroManifest.files.length,
				byteLength: kokoroManifest.files.reduce((total, file) => total + file.byteLength, 0),
				manifest: {
					path: 'config/assistance-kokoro-g2p-runtime-manifest.json',
					byteLength: kokoroManifestBytes.byteLength,
					sha256: createHash('sha256').update(kokoroManifestBytes).digest('hex'),
				},
			},
		}),
	}, null, 2)}\n`);
	const resources = join(productOutput, options.packagedResourcesPath ?? 'linux-unpacked/resources');
	for (const [name, contents] of files) {
		if (name.startsWith('renderer/') || name.startsWith('runtime/')) {
			await write(join(resources, name), contents);
		}
	}
	for (const [name, contents] of options.packagedResourceExtras ?? []) {
		await write(join(resources, name), contents);
	}
	const packagedApplicationRoot = join(workspace, 'packaged-app');
	for (const [name, contents] of files) {
		if (name.startsWith('app/')) await write(join(packagedApplicationRoot, name.slice(4)), contents);
	}
	for (const [name, contents] of options.packagedApplicationExtras ?? []) {
		await write(join(packagedApplicationRoot, name), contents);
	}
	await createPackage(packagedApplicationRoot, join(resources, 'app.asar'));
	return { buildRoot, files, productOutput };
}

async function write(path: string, contents: string) {
	await mkdir(join(path, '..'), { recursive: true });
	await writeFile(path, contents);
}

function assistanceNativeManifest(script: string) {
	const descriptor = (contents: string) => ({
		byteLength: Buffer.byteLength(contents),
		sha256: createHash('sha256').update(contents).digest('hex'),
	});
	const generated = (id: string) => ({ id, status: 'package-generated', blockedBy: null });
	return {
		schemaVersion: 1,
		runtimeId: 'sherpa-onnx-node',
		version: '1.13.5',
		runtimePrefix: 'assistance/sherpa-onnx/1.13.5',
		commonPackage: {
			name: 'sherpa-onnx-node',
			version: '1.13.5',
			sourceUrl: 'https://registry.npmjs.org/sherpa-onnx-node/-/sherpa-onnx-node-1.13.5.tgz',
			integrity: 'sha512-AAAA',
			entry: 'sherpa-onnx.js',
			files: { 'sherpa-onnx.js': descriptor(script) },
		},
		targets: {
			'linux-x64': {
				id: 'linux-x64',
				status: 'built',
				package: {
					name: 'sherpa-onnx-linux-x64',
					version: '1.13.5',
					sourceUrl: 'https://registry.npmjs.org/sherpa-onnx-linux-x64/-/sherpa-onnx-linux-x64-1.13.5.tgz',
					integrity: 'sha512-AAAA',
					files: { 'sherpa-onnx.node': descriptor('native') },
				},
			},
			'linux-arm64': generated('linux-arm64'),
			'mac-arm64': generated('mac-arm64'),
			'win-x64': generated('win-x64'),
			'win-arm64': generated('win-arm64'),
		},
	};
}

function assistanceKokoroG2pManifest(files: ReadonlyMap<string, string>) {
	const descriptors = [KOKORO_RUNTIME_SCRIPT, KOKORO_EXECUTABLE]
		.map((path) => {
			const contents = files.get(`runtime/${path}`) ?? '';
			return {
				path: path.slice(KOKORO_RUNTIME_PREFIX.length + 1),
				byteLength: Buffer.byteLength(contents),
				sha256: createHash('sha256').update(contents).digest('hex'),
			};
		})
		.sort((left, right) => left.path.localeCompare(right.path, 'en'));
	return {
		schemaVersion: 1,
		runtimeVersion: '0.9.4',
		targetId: 'linux-x64',
		runtimePrefix: 'assistance/kokoro-g2p/0.9.4',
		executable: 'kokoro-g2p',
		files: descriptors,
	};
}
