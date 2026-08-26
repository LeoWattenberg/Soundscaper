/* SPDX-License-Identifier: AGPL-3.0-only */

/** Build-time inventory and runtime reauthentication for isolated bundled codecs. */

import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';

export const BUNDLED_AUDIO_CODEC_RUNTIME_MANIFEST_NAME = 'bundled-audio-codec-runtime-manifest.json';
export const BUNDLED_AUDIO_CODEC_RUNTIME_MANIFEST_ID = 'soundscaper-isolated-bundled-audio-codecs-v1';

const TARGETS = new Set(['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']);
const CODECS = Object.freeze(['flac', 'lame', 'mpg123', 'opus', 'twolame', 'vorbis', 'wavpack']);
const SHA256 = /^[a-f0-9]{64}$/u;
const MAXIMUM_FILE_BYTES = 2 * 1024 * 1024;
const MAXIMUM_MANIFEST_BYTES = 32 * 1024;
const MANIFEST_FIELDS = Object.freeze(['schemaVersion', 'id', 'files']);
const FILE_FIELDS = Object.freeze(['role', 'codec', 'path', 'byteLength', 'sha256']);
const CONFIGURATION_FIELDS = Object.freeze([
	'contractVersion', 'target', 'codec', 'runtimeRoot', 'moduleBytes', 'moduleSha256',
	'dependencies', 'wasmBytes', 'wasmSha256',
]);

const CODEC_FILES = Object.freeze({
	flac: Object.freeze({
		module: 'project-library-runtime/desktop/bundled-flac-audio-codec-runtime.js',
		wasm: 'project-library-runtime/src/common/editor/flac/flac.wasm',
		wasmBytes: 153_076,
		wasmSha256: '0f703571f95e37c24ad68577163ea56b4a9dd7d5576760700b482369e924f986',
	}),
	lame: Object.freeze({
		module: 'project-library-runtime/desktop/bundled-lame-audio-codec-runtime.js',
		wasm: 'project-library-runtime/src/common/editor/lame/lame.wasm',
		wasmBytes: 212_205,
		wasmSha256: '654d08f946851134755513c8c0cd4486e8c9d2024df2318dc48b262e4ad7a502',
	}),
	mpg123: Object.freeze({
		module: 'project-library-runtime/desktop/bundled-mpg123-audio-codec-runtime.js',
		wasm: 'project-library-runtime/src/common/editor/mpg123/mpg123.wasm',
		wasmBytes: 172_329,
		wasmSha256: 'd2b5686a16141ec97dbeb4e4f2a1ce28b756dd3eaf6438b31379356c8dd958ae',
	}),
	opus: Object.freeze({
		module: 'project-library-runtime/desktop/bundled-opus-audio-codec-runtime.js',
		wasm: 'project-library-runtime/src/common/editor/opus/opus.wasm',
		wasmBytes: 385_789,
		wasmSha256: 'c4c9f7ac85071b24b2545f966943c4319fff023a65c899146cfcb016ae0a8853',
	}),
	twolame: Object.freeze({
		module: 'project-library-runtime/desktop/bundled-twolame-audio-codec-runtime.js',
		wasm: 'project-library-runtime/src/common/editor/twolame/twolame.wasm',
		wasmBytes: 146_820,
		wasmSha256: 'b4b166bed688504b548adcee02cda391d4d8b25a44aec914c3fe1082f466ed1b',
	}),
	vorbis: Object.freeze({
		module: 'project-library-runtime/desktop/bundled-vorbis-audio-codec-runtime.js',
		wasm: 'project-library-runtime/src/common/editor/vorbis/vorbis.wasm',
		wasmBytes: 523_227,
		wasmSha256: 'c03037c33f35dbf85e1e963058156399b995b2dedb5479f6eb3f3b30148eeee5',
	}),
	wavpack: Object.freeze({
		module: 'project-library-runtime/desktop/bundled-wavpack-audio-codec-runtime.js',
		wasm: 'project-library-runtime/src/common/editor/wavpack/wavpack.wasm',
		wasmBytes: 145_537,
		wasmSha256: 'c547aca2d5584d643cea4a9d856f9672b9f621fae518ef99444d94500c31f908',
	}),
});

const CONTROL_FILES = Object.freeze([
	'bundled-audio-codec-electron-spawn.mjs',
	'bundled-audio-codec-runtime-payload.mjs',
	'project-library-runtime/desktop/bounded-regular-file.js',
	'project-library-runtime/desktop/bundled-audio-codec-helper-configuration.js',
	'project-library-runtime/desktop/bundled-audio-codec-helper-process.js',
	'project-library-runtime/desktop/bundled-audio-codec-isolated-runtime.js',
	'project-library-runtime/desktop/bundled-audio-codec-operation-runner.js',
	'project-library-runtime/desktop/bundled-audio-codec-provider-catalog.js',
	'project-library-runtime/desktop/desktop-audio-codec-operation-contract.js',
	'project-library-runtime/src/common/editor/desktop-codec-provider-catalog.js',
]);
const COMMON_DEPENDENCIES = Object.freeze([
	'project-library-runtime/desktop/desktop-audio-codec-operation-contract.js',
	'project-library-runtime/src/common/editor/desktop-codec-provider-catalog.js',
]);
const CODEC_DEPENDENCIES = Object.freeze({
	flac: Object.freeze([...COMMON_DEPENDENCIES,
		'project-library-runtime/desktop/bundled-flac-stream.js'].sort()),
	lame: Object.freeze([...COMMON_DEPENDENCIES,
		'project-library-runtime/desktop/bundled-mpeg-audio-stream.js'].sort()),
	mpg123: Object.freeze([...COMMON_DEPENDENCIES,
		'project-library-runtime/desktop/bundled-mpeg-audio-stream.js'].sort()),
	opus: Object.freeze([...COMMON_DEPENDENCIES,
		'project-library-runtime/desktop/bundled-opus-stream.js'].sort()),
	twolame: Object.freeze([...COMMON_DEPENDENCIES,
		'project-library-runtime/desktop/bundled-mpeg-audio-stream.js'].sort()),
	vorbis: Object.freeze([...COMMON_DEPENDENCIES,
		'project-library-runtime/desktop/bundled-vorbis-stream.js'].sort()),
	wavpack: Object.freeze([
		...COMMON_DEPENDENCIES,
		'project-library-runtime/desktop/bundled-wavpack-stream.js',
		'project-library-runtime/src/common/editor/desktop-wavpack-codec-profile.js',
		'project-library-runtime/src/common/editor/wavpack/pcm.js',
		'project-library-runtime/src/common/editor/wavpack/runtime.js',
	].sort()),
});
const DEPENDENCY_FILES = Object.freeze([
	...new Set(Object.values(CODEC_DEPENDENCIES).flat()),
].filter((path) => !CONTROL_FILES.includes(path)).sort());

export const DESKTOP_BUNDLED_AUDIO_CODEC_CONTROL_FILES = CONTROL_FILES;

export const DESKTOP_BUNDLED_AUDIO_CODEC_EXECUTION_FILES = Object.freeze(Object.fromEntries(
	CODECS.map((codec) => Object.freeze([codec, Object.freeze([
		CODEC_FILES[codec].module, ...CODEC_DEPENDENCIES[codec],
	].sort())])),
));

export const DESKTOP_BUNDLED_AUDIO_CODEC_ISOLATION_FILES = Object.freeze([
	...CONTROL_FILES.map((path) => Object.freeze({ role: 'control', codec: null, path })),
	...DEPENDENCY_FILES.map((path) => Object.freeze({ role: 'dependency', codec: null, path })),
	...CODECS.flatMap((codec) => Object.freeze([
		Object.freeze({ role: 'module', codec, path: CODEC_FILES[codec].module }),
		Object.freeze({
			role: 'wasm', codec, path: CODEC_FILES[codec].wasm,
			byteLength: CODEC_FILES[codec].wasmBytes, sha256: CODEC_FILES[codec].wasmSha256,
		}),
	])),
].sort((left, right) => left.path.localeCompare(right.path)));

export async function createBundledAudioCodecRuntimeManifest(options) {
	const desktopRoot = absoluteRoot(options?.desktopRoot, 'desktop root');
	const files = [];
	for (const expected of DESKTOP_BUNDLED_AUDIO_CODEC_ISOLATION_FILES) {
		const authenticated = await authenticateFile(
			desktopRoot, expected.path, null, `bundled codec ${expected.role}`,
		);
		if (expected.role === 'wasm' && (authenticated.byteLength !== expected.byteLength
			|| authenticated.sha256 !== expected.sha256)) {
			throw new Error(`The staged bundled codec wasm identity is invalid: ${expected.path}`);
		}
		files.push(Object.freeze({
			role: expected.role, codec: expected.codec, path: expected.path,
			byteLength: authenticated.byteLength, sha256: authenticated.sha256,
		}));
	}
	return Object.freeze({
		schemaVersion: 1, id: BUNDLED_AUDIO_CODEC_RUNTIME_MANIFEST_ID,
		files: Object.freeze(files),
	});
}

export function serializeBundledAudioCodecRuntimeManifest(value) {
	const manifest = inspectManifest(value);
	return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function createBundledAudioCodecRuntimeVerifier(options) {
	const desktopRoot = absoluteRoot(options?.desktopRoot, 'desktop root');
	const target = desktopTarget(options?.target);
	const manifestPromise = readManifest(desktopRoot);
	return async (codecValue) => {
		const codec = codecId(codecValue);
		const manifest = await manifestPromise;
		const files = new Map(manifest.files.map((file) => [file.path, file]));
		for (const path of CONTROL_FILES) {
			await authenticateFile(desktopRoot, path, files.get(path), 'bundled codec control file');
		}
		const expected = CODEC_FILES[codec];
		const module = await authenticateFile(
			desktopRoot, expected.module, files.get(expected.module), 'bundled codec module',
		);
		const wasm = await authenticateFile(
			desktopRoot, expected.wasm, files.get(expected.wasm), 'bundled codec wasm',
		);
		const dependencies = [];
		for (const path of CODEC_DEPENDENCIES[codec]) {
			const identity = await authenticateFile(
				desktopRoot, path, files.get(path), 'bundled codec dependency',
			);
			dependencies.push(Object.freeze({
				path: path.slice('project-library-runtime/'.length),
				byteLength: identity.byteLength, sha256: identity.sha256,
			}));
		}
		const configuration = Object.freeze({
			contractVersion: 1, target, codec,
			runtimeRoot: join(desktopRoot, 'project-library-runtime'),
			moduleBytes: module.byteLength, moduleSha256: module.sha256,
			dependencies: Object.freeze(dependencies),
			wasmBytes: wasm.byteLength, wasmSha256: wasm.sha256,
		});
		return inspectConfiguration(configuration, target, codec);
	};
}

async function readManifest(desktopRoot) {
	const path = join(desktopRoot, BUNDLED_AUDIO_CODEC_RUNTIME_MANIFEST_NAME);
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1
		|| metadata.size > MAXIMUM_MANIFEST_BYTES || await realpath(path) !== path) {
		throw new Error('The bundled audio codec runtime manifest identity is invalid.');
	}
	const source = await readFile(path, 'utf8');
	let parsed;
	try { parsed = JSON.parse(source); }
	catch { throw new Error('The bundled audio codec runtime manifest is not valid JSON.'); }
	const manifest = inspectManifest(parsed);
	if (serializeBundledAudioCodecRuntimeManifest(manifest) !== source) {
		throw new Error('The bundled audio codec runtime manifest is not canonical.');
	}
	return manifest;
}

function inspectManifest(value) {
	const record = exactRecord(value, MANIFEST_FIELDS, 'bundled codec runtime manifest');
	if (record.schemaVersion !== 1 || record.id !== BUNDLED_AUDIO_CODEC_RUNTIME_MANIFEST_ID
		|| !Array.isArray(record.files)
		|| record.files.length !== DESKTOP_BUNDLED_AUDIO_CODEC_ISOLATION_FILES.length) {
		throw new TypeError('The bundled audio codec runtime manifest is invalid.');
	}
	const files = record.files.map((value, index) => {
		const file = exactRecord(value, FILE_FIELDS, 'bundled codec runtime file');
		const expected = DESKTOP_BUNDLED_AUDIO_CODEC_ISOLATION_FILES[index];
		if (!expected || file.role !== expected.role || file.codec !== expected.codec
			|| file.path !== expected.path || !Number.isSafeInteger(file.byteLength)
			|| file.byteLength < 1 || file.byteLength > MAXIMUM_FILE_BYTES
			|| typeof file.sha256 !== 'string' || !SHA256.test(file.sha256)
			|| expected.role === 'wasm' && (file.byteLength !== expected.byteLength
				|| file.sha256 !== expected.sha256)) {
			throw new TypeError('The bundled audio codec runtime manifest inventory is invalid.');
		}
		return Object.freeze({
			role: file.role, codec: file.codec, path: file.path,
			byteLength: file.byteLength, sha256: file.sha256,
		});
	});
	return Object.freeze({ schemaVersion: 1, id: record.id, files: Object.freeze(files) });
}

async function authenticateFile(root, relativePath, descriptor, label) {
	const path = confinedPath(root, relativePath);
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || before.size < 1
		|| before.size > MAXIMUM_FILE_BYTES || await realpath(path) !== path) {
		throw new Error(`The ${label} identity is invalid: ${relativePath}`);
	}
	const bytes = await readFile(path);
	const after = await lstat(path);
	const identity = Object.freeze({ byteLength: bytes.byteLength, sha256: digest(bytes) });
	if (!sameFile(before, after) || descriptor !== null && descriptor !== undefined
		&& (descriptor.byteLength !== identity.byteLength || descriptor.sha256 !== identity.sha256)) {
		throw new Error(`The ${label} digest is invalid: ${relativePath}`);
	}
	return identity;
}

function inspectConfiguration(value, target, codec) {
	const record = exactRecord(value, CONFIGURATION_FIELDS, 'bundled codec helper configuration');
	if (record.contractVersion !== 1 || record.target !== target || record.codec !== codec
		|| typeof record.runtimeRoot !== 'string' || !isAbsolute(record.runtimeRoot)
		|| !Number.isSafeInteger(record.moduleBytes) || record.moduleBytes < 1
		|| typeof record.moduleSha256 !== 'string' || !SHA256.test(record.moduleSha256)
		|| !Array.isArray(record.dependencies) || record.dependencies.length < 1
		|| record.dependencies.some((dependency) => !dependency || typeof dependency !== 'object'
			|| typeof dependency.path !== 'string' || !Number.isSafeInteger(dependency.byteLength)
			|| dependency.byteLength < 1 || typeof dependency.sha256 !== 'string'
			|| !SHA256.test(dependency.sha256))
		|| !Number.isSafeInteger(record.wasmBytes) || record.wasmBytes < 8
		|| typeof record.wasmSha256 !== 'string' || !SHA256.test(record.wasmSha256)) {
		throw new TypeError('The bundled codec helper configuration is invalid.');
	}
	return Object.freeze({ ...record });
}

function exactRecord(value, fields, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} is invalid.`);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Reflect.ownKeys(descriptors);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))
		|| keys.some((key) => !Object.hasOwn(descriptors[key], 'value'))) {
		throw new TypeError(`${label} has an inexact shape.`);
	}
	return value;
}

function absoluteRoot(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')
		|| Buffer.byteLength(value) > 4_096) throw new TypeError(`The bundled codec ${label} is invalid.`);
	return resolve(value);
}

function confinedPath(root, relativePath) {
	if (typeof relativePath !== 'string' || relativePath.startsWith('/') || relativePath.includes('\\')
		|| relativePath.split('/').includes('..')) throw new TypeError('Invalid bundled codec path.');
	const path = resolve(root, relativePath);
	if (!path.startsWith(`${root}${sep}`)) throw new TypeError('Bundled codec path escapes its root.');
	return path;
}

function desktopTarget(value) {
	if (typeof value !== 'string' || !TARGETS.has(value)) {
		throw new TypeError('The bundled audio codec desktop target is unsupported.');
	}
	return value;
}

function codecId(value) {
	if (typeof value !== 'string' || !CODECS.includes(value)) {
		throw new TypeError('The bundled audio codec ID is invalid.');
	}
	return value;
}

function sameFile(left, right) {
	return left.dev === right.dev && left.ino === right.ino && left.size === right.size
		&& left.mtimeMs === right.mtimeMs;
}

function digest(value) { return createHash('sha256').update(value).digest('hex'); }
