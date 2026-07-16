#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_ROOT = resolve(process.argv[2] || resolve(ROOT, 'release/desktop'));
const TRANSLATION_BASE_URL = 'https://translations.soundscaper.org/runtime/translations/audacity/4/';
const FFMPEG_BUILD_SOURCE_URL = 'https://github.com/ffmpegwasm/ffmpeg.wasm/archive/refs/tags/v0.12.10.tar.gz';
const FFMPEG_BUILD_SOURCE = Object.freeze({
	byteLength: 1_115_568,
	sha256: '3f1c3f94143d11e3bbb322bd8a1a3189965f31162cf7e889fd3b7e21a928d1ea',
});
const FFMPEG_SOURCE_MANIFEST = resolve(ROOT, 'desktop/ffmpeg-corresponding-source.json');
const FFMPEG_RUNTIME = Object.freeze({
	package: '@ffmpeg/core',
	version: '0.12.10',
	javascriptSha256: '67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3',
	wasmSha256: '9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7',
});
const EXPECTED_RUNTIME_MANIFESTS = Object.freeze([
	'runtime-manifest-linux-arm64.json',
	'runtime-manifest-linux-x64.json',
	'runtime-manifest-mac-arm64.json',
	'runtime-manifest-mac-x64.json',
	'runtime-manifest-win-arm64.json',
	'runtime-manifest-win-x64.json',
]);

async function main() {
	const ffmpegCorrespondingSource = await loadFfmpegCorrespondingSource();
	await mkdir(ASSET_ROOT, { recursive: true });
	const entries = await readdir(ASSET_ROOT, { withFileTypes: true });
	const manifestNames = entries
		.filter((entry) => entry.isFile() && /^runtime-manifest-.+\.json$/u.test(entry.name))
		.map((entry) => entry.name)
		.sort();
	assert(JSON.stringify(manifestNames) === JSON.stringify(EXPECTED_RUNTIME_MANIFESTS),
		`Expected runtime manifests for all six native builds; received: ${manifestNames.join(', ') || '<none>'}.`);
	const manifests = await Promise.all(manifestNames.map(async (name) => ({
		name,
		value: parseJson(await readFile(resolve(ASSET_ROOT, name)), name),
	})));
	const canonical = manifests[0].value;
	for (const manifest of manifests.slice(1)) {
		assert(manifest.value.applicationVersion === canonical.applicationVersion,
			`${manifest.name} has a different application version.`);
		assert(manifest.value.translations?.releaseId === canonical.translations?.releaseId,
			`${manifest.name} has a different translation release.`);
		assert(JSON.stringify(manifest.value.ffmpeg) === JSON.stringify(canonical.ffmpeg),
			`${manifest.name} has a different FFmpeg runtime.`);
	}

	const translationSource = canonical.translations?.source?.archive;
	validateDescriptor(translationSource, 'translation source archive', 32 * 1024 * 1024);
	const translationSourceName = `Audacity-translations-${canonical.translations.releaseId}-source.zip`;
	await fetchVerified(
		new URL(translationSource.path, TRANSLATION_BASE_URL),
		resolve(ASSET_ROOT, translationSourceName),
		translationSource,
		'translation source archive',
	);
	await fetchVerified(
		new URL(FFMPEG_BUILD_SOURCE_URL),
		resolve(ASSET_ROOT, 'ffmpeg.wasm-v0.12.10-build-source.tar.gz'),
		FFMPEG_BUILD_SOURCE,
		'ffmpeg.wasm build-script source archive',
	);
	await fetchVerified(
		new URL(ffmpegCorrespondingSource.url),
		resolve(ASSET_ROOT, ffmpegCorrespondingSource.fileName),
		ffmpegCorrespondingSource,
		'FFmpeg complete corresponding-source bundle',
	);
	await copyFile(resolve(ROOT, 'LICENSE'), resolve(ASSET_ROOT, 'Soundscaper-AGPL-3.0.txt'));
	await copyFile(resolve(ROOT, 'THIRD_PARTY_LICENSES.md'), resolve(ASSET_ROOT, 'THIRD_PARTY_LICENSES.md'));

	const releaseFiles = (await readdir(ASSET_ROOT, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && entry.name !== 'SHA256SUMS')
		.map((entry) => entry.name)
		.sort();
	const requiredPackages = [
		['Linux x64 AppImage', /^Soundscaper-.+-linux-(?:x64|x86_64)\.AppImage$/u],
		['Linux x64 Debian package', /^Soundscaper-.+-linux-(?:x64|amd64)\.deb$/u],
		['Linux ARM64 AppImage', /^Soundscaper-.+-linux-arm64\.AppImage$/u],
		['Linux ARM64 Debian package', /^Soundscaper-.+-linux-arm64\.deb$/u],
		['macOS Intel DMG', /^Soundscaper-.+-mac-x64\.dmg$/u],
		['macOS Apple silicon DMG', /^Soundscaper-.+-mac-arm64\.dmg$/u],
		['Windows x64 installer', /^Soundscaper-.+-win-x64\.exe$/u],
		['Windows x64 ZIP', /^Soundscaper-.+-win-x64\.zip$/u],
		['Windows ARM64 installer', /^Soundscaper-.+-win-arm64\.exe$/u],
		['Windows ARM64 ZIP', /^Soundscaper-.+-win-arm64\.zip$/u],
	];
	for (const [label, pattern] of requiredPackages) {
		assert(releaseFiles.some((name) => pattern.test(name)), `Missing expected ${label}.`);
	}
	const checksums = [];
	for (const name of releaseFiles) {
		const bytes = await readFile(resolve(ASSET_ROOT, name));
		checksums.push(`${sha256(bytes)}  ${name}`);
	}
	await writeFile(resolve(ASSET_ROOT, 'SHA256SUMS'), `${checksums.join('\n')}\n`);
	console.log(`Prepared ${releaseFiles.length} release assets and SHA256SUMS in ${ASSET_ROOT}`);
}

async function loadFfmpegCorrespondingSource() {
	let manifest;
	try {
		manifest = parseJson(await readFile(FFMPEG_SOURCE_MANIFEST), 'FFmpeg corresponding-source manifest');
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
		throw new Error(
			'Public desktop release is blocked: desktop/ffmpeg-corresponding-source.json is missing. '
			+ 'Create and audit a complete digest-pinned source bundle for the shipped FFmpeg core and every enabled dependency before publishing binaries.',
		);
	}
	assert(manifest.schemaVersion === 1, 'FFmpeg corresponding-source manifest has an unsupported schema.');
	for (const [key, expected] of Object.entries(FFMPEG_RUNTIME)) {
		assert(manifest.runtime?.[key] === expected,
			`FFmpeg corresponding-source manifest runtime field ${key} does not match the shipped core.`);
	}
	const source = manifest.source;
	assert(source && typeof source === 'object' && !Array.isArray(source),
		'FFmpeg corresponding-source manifest has no source descriptor.');
	const url = new URL(String(source.url || ''));
	assert(url.protocol === 'https:' && !url.username && !url.password && !url.hash,
		'FFmpeg corresponding-source bundle must use a clean HTTPS URL.');
	assert(typeof source.fileName === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u.test(source.fileName),
		'FFmpeg corresponding-source bundle filename is invalid.');
	assert(/^[a-f\d]{64}$/u.test(source.sha256), 'FFmpeg corresponding-source bundle digest is invalid.');
	assert(Number.isSafeInteger(source.byteLength) && source.byteLength > 0 && source.byteLength <= 2 * 1024 * 1024 * 1024,
		'FFmpeg corresponding-source bundle byte length is invalid.');
	return source;
}

async function fetchVerified(url, output, descriptor, label) {
	const bytes = await fetchBytes(url, descriptor.byteLength, label);
	assert(bytes.byteLength === descriptor.byteLength, `${label} byte length does not match its descriptor.`);
	assert(sha256(bytes) === descriptor.sha256, `${label} digest does not match its descriptor.`);
	await writeFile(output, bytes, { flag: 'wx' });
}

async function fetchBytes(url, maximumBytes, label) {
	return retry(async () => fetchBytesOnce(url, maximumBytes, label), label);
}

async function fetchBytesOnce(url, maximumBytes, label) {
	const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
	assert(response.ok, `${label} request returned HTTP ${response.status}.`);
	const declaredLength = Number(response.headers.get('content-length'));
	assert(!Number.isFinite(declaredLength) || declaredLength <= maximumBytes, `${label} declares too many bytes.`);
	const reader = response.body?.getReader();
	assert(reader, `${label} response has no body.`);
	const chunks = [];
	let byteLength = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		byteLength += value.byteLength;
		assert(byteLength <= maximumBytes, `${label} exceeds ${maximumBytes} bytes.`);
		chunks.push(value);
	}
	assert(byteLength > 0, `${label} is empty.`);
	const result = Buffer.allocUnsafe(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

async function retry(operation, label, attempts = 3) {
	let lastError;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			return await operation();
		} catch (error) {
			lastError = error;
			if (attempt === attempts) break;
			console.warn(`${label} attempt ${attempt} failed; retrying: ${error.message}`);
			await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 1_000));
		}
	}
	throw lastError;
}

function validateDescriptor(descriptor, label, maximumBytes) {
	assert(descriptor && typeof descriptor.path === 'string' && !descriptor.path.startsWith('/')
		&& !descriptor.path.includes('\\') && !descriptor.path.split('/').includes('..'), `${label} path is invalid.`);
	assert(/^[a-f\d]{64}$/u.test(descriptor.sha256), `${label} digest is invalid.`);
	assert(Number.isSafeInteger(descriptor.byteLength) && descriptor.byteLength > 0 && descriptor.byteLength <= maximumBytes,
		`${label} byte length is invalid.`);
	const url = new URL(descriptor.path, TRANSLATION_BASE_URL);
	assert(url.origin === new URL(TRANSLATION_BASE_URL).origin, `${label} leaves the translation origin.`);
}

function parseJson(bytes, label) {
	try {
		return JSON.parse(String(bytes));
	} catch (error) {
		throw new Error(`${label} is invalid JSON: ${error.message}`);
	}
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

main().catch((error) => {
	console.error(`Desktop release asset preparation failed: ${error.message}`);
	process.exitCode = 1;
});
