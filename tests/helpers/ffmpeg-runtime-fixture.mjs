/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The synthetic repository fixture the FFmpeg runtime provenance suites drive.
 *
 * It stands in for a whole checkout — package metadata, lockfile, installed
 * runtime bytes, every digest-pinned evidence file — so the verification,
 * staging, packing and publication gates can be exercised against a tree the
 * test controls byte for byte. It carries the real native addon provenance
 * alongside the synthetic FFmpeg runtime because the beforePack hook verifies
 * the whole staged tree, not the FFmpeg half of it.
 */

import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { NATIVE_ADDON_PAYLOAD_MANIFEST_PATH } from '../../scripts/lib/native-addon-payload-manifest.mjs';

const ROOT = resolve(import.meta.dirname, '../..');

/** Every licensing check the FFmpeg provenance manifest derives distribution state from. */
export const ALL_LICENSING_CHECKS = Object.freeze([
	'dependency-notice-version-audit', 'desktop-notice-delivery', 'ffmpeg-enabled-codec-patent-review',
	'ffmpeg-enabled-library-corresponding-source', 'ffmpeg-runtime-manifest-integrity', 'web-notice-delivery',
]);

/** The subset a runtime publication additionally requires. */
export const REQUIRED_LICENSING_CHECKS = Object.freeze([
	'ffmpeg-enabled-codec-patent-review', 'ffmpeg-enabled-library-corresponding-source', 'web-notice-delivery',
]);

export async function createFixture(context) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-ffmpeg-runtime-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	// The beforePack hook verifies the whole staged tree, so the synthetic
	// repository carries the real native payload provenance alongside the
	// synthetic FFmpeg runtime.
	await mkdir(join(root, 'config'), { recursive: true });
	await cp(join(ROOT, NATIVE_ADDON_PAYLOAD_MANIFEST_PATH), join(root, NATIVE_ADDON_PAYLOAD_MANIFEST_PATH));
	await cp(
		join(ROOT, 'config/soundscaper-professional-native-payload-manifest.json'),
		join(root, 'config/soundscaper-professional-native-payload-manifest.json'),
	);
	await cp(
		join(ROOT, 'config/milestone-5-native-source-acquisitions.json'),
		join(root, 'config/milestone-5-native-source-acquisitions.json'),
	);
	await cp(join(ROOT, 'native/soundscaper-helper-addon'), join(root, 'native/soundscaper-helper-addon'), { recursive: true });
	const javascript = Buffer.from('fixture ffmpeg JavaScript');
	const wasm = Buffer.from('fixture ffmpeg WebAssembly');
	const cors = Buffer.from(JSON.stringify({
		rules: [{
			allowed: {
				origins: ['https://soundscaper.org'],
				methods: ['GET', 'HEAD'],
				headers: ['Range'],
			},
			exposeHeaders: ['Content-Length', 'Content-Range', 'ETag'],
			maxAgeSeconds: 86_400,
		}],
	}));
	const publicPolicy = Buffer.from(JSON.stringify({
		schemaVersion: 1,
		publicOrigin: 'https://assets.soundscaper.org',
		publicPrefix: 'runtime/ffmpeg/0.12.10',
		releaseSegment: 'releases',
		immutableCacheControl: 'public, max-age=31536000, immutable',
		runtimeFiles: [
			{ name: 'ffmpeg-core.js', contentType: 'text/javascript; charset=utf-8' },
			{ name: 'ffmpeg-core.wasm', contentType: 'application/wasm' },
		],
		releaseMetadata: {
			manifest: { contentType: 'application/json; charset=utf-8' },
			notice: { contentType: 'text/markdown; charset=utf-8' },
			correspondingSource: { contentType: 'application/json; charset=utf-8' },
		},
		pointer: {
			name: 'latest.json',
			contentType: 'application/json; charset=utf-8',
			cacheControl: 'no-store',
		},
		pages: {
			origin: 'https://soundscaper.org',
		},
		cloudflare: {
			pointerRuleRef: 'soundscaper-ffmpeg-runtime-pointer-v1',
			releaseRuleRef: 'soundscaper-ffmpeg-runtime-releases-v1',
			pagesRuleRef: 'soundscaper-pages-browser-origin-v1',
		},
	}));
	const packageEntry = {
		version: '0.12.10',
		resolved: 'https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.10.tgz',
		integrity: 'sha512-fixture-integrity',
		license: 'GPL-2.0-or-later',
	};
	const paths = {
		lineEndings: '.gitattributes',
		correspondingSource: 'desktop/ffmpeg-corresponding-source.json',
		notices: 'THIRD_PARTY_LICENSES.md',
		licensingPolicy: 'docs/production-licensing-policy.md',
		licensingMatrix: 'config/production-licensing-matrix.json',
		securityMatrix: 'config/production-security-matrix.json',
		threatModel: 'docs/production-threat-model.md',
	};
	const sourceDescriptor = {
		url: 'https://example.test/ffmpeg-source.tar.gz',
		fileName: 'ffmpeg-source.tar.gz',
		byteLength: 12,
		sha256: '1'.repeat(64),
	};
	const buildSourceDescriptor = {
		url: 'https://github.com/ffmpegwasm/ffmpeg.wasm/archive/refs/tags/v12.15.tar.gz',
		fileName: 'ffmpeg-build-source.tar.gz',
		byteLength: 13,
		sha256: '2'.repeat(64),
	};
	const securityMatrix = {
		schemaVersion: 1,
		risks: [{
			id: 'runtime-supply-chain',
			currentControls: [{ id: 'validated-ffmpeg-runtime-publication' }],
		}],
	};
	const lineEndings = Buffer.from([
		'/.gitattributes text eol=lf',
		'/THIRD_PARTY_LICENSES.md text eol=lf',
		'/config/ffmpeg-runtime-manifest.json text eol=lf',
		'/config/ffmpeg-runtime-publication-policy.json text eol=lf',
		'/config/production-licensing-matrix.json text eol=lf',
		'/config/production-security-matrix.json text eol=lf',
		'/desktop/ffmpeg-corresponding-source.json text eol=lf',
		'/docs/production-licensing-policy.md text eol=lf',
		'/docs/production-threat-model.md text eol=lf',
		'/r2-cors.json text eol=lf',
		'',
	].join('\n'));
	const evidenceBytes = {
		lineEndings,
		correspondingSource: Buffer.from(JSON.stringify({
			schemaVersion: 1,
			runtime: {
				package: '@ffmpeg/core',
				version: '0.12.10',
				javascriptSha256: sha256(javascript),
				wasmSha256: sha256(wasm),
			},
			source: sourceDescriptor,
			buildSource: buildSourceDescriptor,
		})),
		notices: Buffer.from('Fixture notices for `@ffmpeg/core` 0.12.10 from https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v12.15\n'),
		licensingPolicy: Buffer.from('# Fixture licensing policy\n'),
		licensingMatrix: Buffer.from(JSON.stringify({
			schemaVersion: 1,
			distributionChecks: ALL_LICENSING_CHECKS.map((id) => ({ id, status: 'implemented' })),
		})),
		securityMatrix: Buffer.from(JSON.stringify(securityMatrix)),
		threatModel: Buffer.from('# Fixture threat model\n'),
	};
	await Promise.all([
		writeJson(join(root, 'package.json'), {
			name: 'soundscaper',
			dependencies: {},
			devDependencies: { '@ffmpeg/core': '0.12.10' },
		}),
		writeJson(join(root, 'package-lock.json'), {
			lockfileVersion: 3,
			packages: { 'node_modules/@ffmpeg/core': packageEntry },
		}),
		writeJson(join(root, 'node_modules/@ffmpeg/core/package.json'), {
			name: '@ffmpeg/core',
			version: '0.12.10',
			license: 'GPL-2.0-or-later',
		}),
		writeBytes(join(root, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js'), javascript),
		writeBytes(join(root, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm'), wasm),
		...Object.entries(evidenceBytes).map(([id, bytes]) => writeBytes(join(root, paths[id]), bytes)),
		writeBytes(join(root, 'r2-cors.json'), cors),
		writeBytes(join(root, 'config/ffmpeg-runtime-publication-policy.json'), publicPolicy),
	]);
	const manifestPath = join(root, 'config/ffmpeg-runtime-manifest.json');
	const manifest = {
		schemaVersion: 1,
		id: 'ffmpeg-core-0.12.10',
		package: {
			name: '@ffmpeg/core',
			version: '0.12.10',
			lockPath: 'node_modules/@ffmpeg/core',
			resolved: packageEntry.resolved,
			integrity: packageEntry.integrity,
			license: packageEntry.license,
		},
		runtime: {
			publicPrefix: 'runtime/ffmpeg/0.12.10',
			cacheControl: 'public, max-age=31536000, immutable',
			files: [
				fileDescriptor('ffmpeg-core.js', javascript, 'text/javascript; charset=utf-8'),
				fileDescriptor('ffmpeg-core.wasm', wasm, 'application/wasm'),
			],
		},
		publication: {
			bucket: 'soundscaper-assets',
			jurisdiction: 'eu',
			manifestName: 'manifest.json',
			noticeName: 'THIRD_PARTY_LICENSES.md',
			correspondingSourceName: 'ffmpeg-corresponding-source.json',
			corsOrigins: ['https://soundscaper.org'],
			cors: descriptor('r2-cors.json', cors),
			policy: descriptor('config/ffmpeg-runtime-publication-policy.json', publicPolicy),
		},
		evidence: Object.fromEntries(Object.entries(paths).map(([id, path]) => [
			id,
			descriptor(path, evidenceBytes[id]),
		])),
		security: {
			matrixPath: 'config/production-security-matrix.json',
			riskId: 'runtime-supply-chain',
			controlId: 'validated-ffmpeg-runtime-publication',
		},
		distributionChecks: {
			desktopAssembly: { allowed: true, blockedBy: [] },
			runtimePublication: { allowed: true, blockedBy: [] },
			desktopRelease: { allowed: true, blockedBy: [] },
		},
		integrity: {
			payloadSha256: '',
		},
	};
	const fixture = {
		root,
		manifest,
		manifestPath,
		javascript,
		wasm,
		cors,
		javascriptPath: join(root, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js'),
		wasmPath: join(root, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm'),
	};
	await writeManifest(fixture);
	return fixture;
}

export async function writeManifest(fixture) {
	fixture.manifest.integrity.payloadSha256 = sha256(Buffer.from(canonicalJson(
		Object.fromEntries(Object.entries(fixture.manifest).filter(([key]) => key !== 'integrity')),
	)));
	await writeJson(fixture.manifestPath, fixture.manifest);
}

export function fileDescriptor(name, bytes, contentType) {
	return { name, byteLength: bytes.byteLength, sha256: sha256(bytes), contentType };
}

export function descriptor(path, bytes) {
	return { path, byteLength: bytes.byteLength, sha256: sha256(bytes) };
}

export function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

export function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

export async function writeJson(path, value) {
	await writeBytes(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

export async function writeBytes(path, bytes) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, bytes);
}
