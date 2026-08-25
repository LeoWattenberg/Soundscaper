/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed, authenticated configuration admitted by the bundled codec helper. */

import { isAbsolute } from 'node:path';

import type { DesktopCodecTarget } from '../src/common/editor/desktop-codec-provider-catalog.js';

export const BUNDLED_AUDIO_CODEC_IDS = Object.freeze([
	'flac', 'lame', 'mpg123', 'opus', 'twolame', 'vorbis', 'wavpack',
] as const);
export type BundledAudioCodecId = typeof BUNDLED_AUDIO_CODEC_IDS[number];

export interface BundledAudioCodecDependencyIdentity {
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface BundledAudioCodecHelperConfiguration {
	readonly contractVersion: 1;
	readonly target: DesktopCodecTarget;
	readonly codec: BundledAudioCodecId;
	readonly runtimeRoot: string;
	readonly moduleBytes: number;
	readonly moduleSha256: string;
	readonly dependencies: readonly Readonly<BundledAudioCodecDependencyIdentity>[];
	readonly wasmBytes: number;
	readonly wasmSha256: string;
}

export interface BundledAudioCodecSpec {
	readonly moduleFile: string;
	readonly wasmFile: string;
	readonly dependencies: readonly string[];
	readonly loaderName: string;
	readonly providerId: (target: DesktopCodecTarget) => string;
}

const TARGETS = new Set<string>([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
]);
const CODEC_IDS = new Set<string>(BUNDLED_AUDIO_CODEC_IDS);
const SHA256 = /^[a-f0-9]{64}$/u;
const MAXIMUM_MODULE_BYTES = 2 * 1024 * 1024;
const PATH_BYTES = 4_096;
const CONFIGURATION_FIELDS = Object.freeze([
	'contractVersion', 'target', 'codec', 'runtimeRoot', 'moduleBytes', 'moduleSha256',
	'dependencies', 'wasmBytes', 'wasmSha256',
]);
const COMMON_DEPENDENCIES = Object.freeze([
	'desktop/desktop-audio-codec-operation-contract.js',
	'src/common/editor/desktop-codec-provider-catalog.js',
]);
const CODECS: Readonly<Record<BundledAudioCodecId, Readonly<BundledAudioCodecSpec>>> = Object.freeze({
	flac: Object.freeze({
		moduleFile: 'desktop/bundled-flac-audio-codec-runtime.js',
		wasmFile: 'src/common/editor/flac/flac.wasm',
		dependencies: Object.freeze([...COMMON_DEPENDENCIES, 'desktop/bundled-flac-stream.js'].sort()),
		loaderName: 'loadBundledFlacAudioCodecRuntime',
		providerId: (target: DesktopCodecTarget) => `bundled-libflac-wasm-${target}`,
	}),
	lame: Object.freeze({
		moduleFile: 'desktop/bundled-lame-audio-codec-runtime.js',
		wasmFile: 'src/common/editor/lame/lame.wasm',
		dependencies: Object.freeze([...COMMON_DEPENDENCIES, 'desktop/bundled-mpeg-audio-stream.js'].sort()),
		loaderName: 'loadBundledLameAudioCodecRuntime',
		providerId: (target: DesktopCodecTarget) => `bundled-lame-wasm-${target}`,
	}),
	mpg123: Object.freeze({
		moduleFile: 'desktop/bundled-mpg123-audio-codec-runtime.js',
		wasmFile: 'src/common/editor/mpg123/mpg123.wasm',
		dependencies: Object.freeze([...COMMON_DEPENDENCIES, 'desktop/bundled-mpeg-audio-stream.js'].sort()),
		loaderName: 'loadBundledMpg123AudioCodecRuntime',
		providerId: (target: DesktopCodecTarget) => `bundled-mpg123-wasm-${target}`,
	}),
	opus: Object.freeze({
		moduleFile: 'desktop/bundled-opus-audio-codec-runtime.js',
		wasmFile: 'src/common/editor/opus/opus.wasm',
		dependencies: Object.freeze([...COMMON_DEPENDENCIES, 'desktop/bundled-opus-stream.js'].sort()),
		loaderName: 'loadBundledOpusAudioCodecRuntime',
		providerId: (target: DesktopCodecTarget) => `bundled-libopus-libogg-wasm-${target}`,
	}),
	twolame: Object.freeze({
		moduleFile: 'desktop/bundled-twolame-audio-codec-runtime.js',
		wasmFile: 'src/common/editor/twolame/twolame.wasm',
		dependencies: Object.freeze([...COMMON_DEPENDENCIES, 'desktop/bundled-mpeg-audio-stream.js'].sort()),
		loaderName: 'loadBundledTwolameAudioCodecRuntime',
		providerId: (target: DesktopCodecTarget) => `bundled-twolame-wasm-${target}`,
	}),
	vorbis: Object.freeze({
		moduleFile: 'desktop/bundled-vorbis-audio-codec-runtime.js',
		wasmFile: 'src/common/editor/vorbis/vorbis.wasm',
		dependencies: Object.freeze([...COMMON_DEPENDENCIES, 'desktop/bundled-vorbis-stream.js'].sort()),
		loaderName: 'loadBundledVorbisAudioCodecRuntime',
		providerId: (target: DesktopCodecTarget) => `bundled-libvorbis-libogg-wasm-${target}`,
	}),
	wavpack: Object.freeze({
		moduleFile: 'desktop/bundled-wavpack-audio-codec-runtime.js',
		wasmFile: 'src/common/editor/wavpack/wavpack.wasm',
		dependencies: Object.freeze([
			...COMMON_DEPENDENCIES,
			'desktop/bundled-wavpack-stream.js',
			'src/common/editor/desktop-wavpack-codec-profile.js',
			'src/common/editor/wavpack/pcm.js',
			'src/common/editor/wavpack/runtime.js',
		].sort()),
		loaderName: 'loadBundledWavPackAudioCodecRuntime',
		providerId: (target: DesktopCodecTarget) => `bundled-wavpack-wasm-${target}`,
	}),
});

export function bundledAudioCodecSpec(codec: BundledAudioCodecId): Readonly<BundledAudioCodecSpec> {
	return CODECS[codec];
}

export function normalizeBundledAudioCodecHelperConfiguration(
	value: unknown,
): BundledAudioCodecHelperConfiguration {
	const record = exactRecord(value, CONFIGURATION_FIELDS, 'bundled audio codec configuration');
	if (record.contractVersion !== 1 || typeof record.target !== 'string' || !TARGETS.has(record.target)
		|| typeof record.codec !== 'string' || !CODEC_IDS.has(record.codec)) {
		throw new TypeError('The bundled audio codec helper target is invalid.');
	}
	const codec = record.codec as BundledAudioCodecId;
	return Object.freeze({
		contractVersion: 1, target: record.target as DesktopCodecTarget, codec,
		runtimeRoot: absolutePath(record.runtimeRoot, 'runtime root'),
		moduleBytes: integer(record.moduleBytes, 1, MAXIMUM_MODULE_BYTES, 'module byte length'),
		moduleSha256: sha256(record.moduleSha256, 'module'),
		dependencies: dependencyDescriptors(record.dependencies, CODECS[codec].dependencies),
		wasmBytes: integer(record.wasmBytes, 8, MAXIMUM_MODULE_BYTES, 'wasm byte length'),
		wasmSha256: sha256(record.wasmSha256, 'wasm'),
	});
}

function dependencyDescriptors(value: unknown, expected: readonly string[]) {
	if (!Array.isArray(value) || value.length !== expected.length) {
		throw new TypeError('The bundled audio codec dependency inventory is invalid.');
	}
	return Object.freeze(value.map((candidate, index) => {
		const record = exactRecord(
			candidate, ['path', 'byteLength', 'sha256'], 'bundled audio codec dependency',
		);
		if (record.path !== expected[index]) {
			throw new TypeError('The bundled audio codec dependency path is invalid.');
		}
		return Object.freeze({
			path: relativePath(record.path),
			byteLength: integer(record.byteLength, 1, MAXIMUM_MODULE_BYTES, 'dependency byte length'),
			sha256: sha256(record.sha256, 'dependency'),
		});
	}));
}

function relativePath(value: unknown): string {
	if (typeof value !== 'string' || value.startsWith('/') || value.includes('\\')
		|| value.split('/').includes('..') || Buffer.byteLength(value) > PATH_BYTES) {
		throw new TypeError('The bundled audio codec dependency path is invalid.');
	}
	return value;
}

function absolutePath(value: unknown, label: string): string {
	if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')
		|| Buffer.byteLength(value) > PATH_BYTES || value.split(/[\\/]/u).includes('..')) {
		throw new TypeError(`The bundled audio codec ${label} path is invalid.`);
	}
	return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The bundled audio codec ${label} is invalid.`);
	}
	return Number(value);
}

function sha256(value: unknown, label: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError(`The bundled audio codec ${label} digest is invalid.`);
	}
	return value;
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} is invalid.`);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Reflect.ownKeys(descriptors);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))
		|| keys.some((key) => !Object.hasOwn(descriptors[key as keyof typeof descriptors]!, 'value'))) {
		throw new TypeError(`${label} has an inexact shape.`);
	}
	return value as Record<string, unknown>;
}
