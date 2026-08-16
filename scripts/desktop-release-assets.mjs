#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	ffmpegRuntimeStageSummary,
	verifyFfmpegRuntimeManifest,
} from './lib/ffmpeg-runtime-manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_ROOT = resolve(process.argv[2] || resolve(ROOT, 'release/desktop'));
const TRANSLATION_BASE_URL = 'https://translations.soundscaper.org/runtime/translations/audacity/4/';
const EXPECTED_RUNTIME_MANIFESTS = Object.freeze([
	'runtime-manifest-soundscaper-linux-arm64.json',
	'runtime-manifest-soundscaper-linux-x64.json',
	'runtime-manifest-soundscaper-mac-arm64.json',
	'runtime-manifest-soundscaper-win-arm64.json',
	'runtime-manifest-soundscaper-win-x64.json',
]);

export async function main() {
	const runtimeRelease = await verifyFfmpegRuntimeManifest({
		repositoryRoot: ROOT,
		purpose: 'desktop-release',
	});
	const ffmpegCorrespondingSource = loadFfmpegCorrespondingSource(runtimeRelease);
	const entries = await readdir(ASSET_ROOT, { withFileTypes: true });
	const packageFiles = regularDesktopReleaseFileNames(entries);
	const manifestNames = packageFiles
		.filter((name) => /^runtime-manifest-.+\.json$/u.test(name))
		.sort();
	assert(JSON.stringify(manifestNames) === JSON.stringify(EXPECTED_RUNTIME_MANIFESTS),
		`Expected runtime manifests for all five native builds; received: ${manifestNames.join(', ') || '<none>'}.`);
	const manifests = await Promise.all(manifestNames.map(async (name) => ({
		name,
		value: parseJson(await readFile(resolve(ASSET_ROOT, name)), name),
	})));
	validateDesktopRuntimeManifests(manifests, runtimeRelease);
	const canonical = manifests[0].value;
	for (const manifest of manifests.slice(1)) {
		assert(manifest.value.applicationVersion === canonical.applicationVersion,
			`${manifest.name} has a different application version.`);
		assert(manifest.value.translations?.releaseId === canonical.translations?.releaseId,
			`${manifest.name} has a different translation release.`);
	}
	validateDesktopReleasePackageInventory(packageFiles, canonical.applicationVersion);
	const sourceSidecarPath = resolve(ASSET_ROOT, 'ffmpeg-corresponding-source.json');
	assert((await readFile(sourceSidecarPath)).equals(runtimeRelease.evidence.correspondingSource.bytes),
		'FFmpeg corresponding-source sidecar does not match the policy manifest.');

	const translationSource = canonical.translations?.source?.archive;
	const translationSourceName = desktopTranslationSourceName(canonical.translations?.releaseId, translationSource);
	await fetchVerified(
		new URL(translationSource.path, TRANSLATION_BASE_URL),
		resolve(ASSET_ROOT, translationSourceName),
		translationSource,
		'translation source archive',
	);
	await fetchVerified(
		new URL(ffmpegCorrespondingSource.buildSource.url),
		resolve(ASSET_ROOT, ffmpegCorrespondingSource.buildSource.fileName),
		ffmpegCorrespondingSource.buildSource,
		'ffmpeg.wasm build-script source archive',
	);
	await fetchVerified(
		new URL(ffmpegCorrespondingSource.source.url),
		resolve(ASSET_ROOT, ffmpegCorrespondingSource.source.fileName),
		ffmpegCorrespondingSource.source,
		'FFmpeg corresponding-source archive',
	);
	await writeFile(resolve(ASSET_ROOT, 'Soundscaper-AGPL-3.0.txt'), await readFile(resolve(ROOT, 'LICENSE')), { flag: 'wx' });
	await writeFile(resolve(ASSET_ROOT, 'THIRD_PARTY_LICENSES.md'), runtimeRelease.evidence.notices.bytes, { flag: 'wx' });
	await writeFile(resolve(ASSET_ROOT, 'ffmpeg-runtime-manifest.json'), runtimeRelease.manifestBytes, { flag: 'wx' });

	const releaseFiles = regularDesktopReleaseFileNames(await readdir(ASSET_ROOT, { withFileTypes: true }))
		.filter((name) => name !== 'SHA256SUMS')
		.sort();
	const checksums = [];
	for (const name of releaseFiles) {
		const bytes = await readFile(resolve(ASSET_ROOT, name));
		checksums.push(`${sha256(bytes)}  ${name}`);
	}
	await writeFile(resolve(ASSET_ROOT, 'SHA256SUMS'), `${checksums.join('\n')}\n`, { flag: 'wx' });
	console.log(`Prepared ${releaseFiles.length} release assets and SHA256SUMS in ${ASSET_ROOT}`);
}

export function validateDesktopReleasePackageInventory(packageFiles, applicationVersion) {
	assert(typeof applicationVersion === 'string' && applicationVersion.length > 0,
		'Desktop runtime manifests have no application version.');
	const version = escapeRegex(applicationVersion);
	const requiredPackages = [
		['Linux x64 AppImage', new RegExp(`^Soundscaper-${version}-linux-(?:x64|x86_64)\\.AppImage$`, 'u')],
		['Linux x64 Debian package', new RegExp(`^Soundscaper-${version}-linux-(?:x64|amd64)\\.deb$`, 'u')],
		['Linux ARM64 AppImage', new RegExp(`^Soundscaper-${version}-linux-arm64\\.AppImage$`, 'u')],
		['Linux ARM64 Debian package', new RegExp(`^Soundscaper-${version}-linux-arm64\\.deb$`, 'u')],
		['macOS Apple silicon DMG', new RegExp(`^Soundscaper-${version}-mac-arm64\\.dmg$`, 'u')],
		['Windows x64 installer', new RegExp(`^Soundscaper-${version}-win-x64\\.exe$`, 'u')],
		['Windows x64 ZIP', new RegExp(`^Soundscaper-${version}-win-x64\\.zip$`, 'u')],
		['Windows ARM64 installer', new RegExp(`^Soundscaper-${version}-win-arm64\\.exe$`, 'u')],
		['Windows ARM64 ZIP', new RegExp(`^Soundscaper-${version}-win-arm64\\.zip$`, 'u')],
	];
	const releasePackages = packageFiles.filter((name) => /\.(?:AppImage|deb|dmg|exe|zip)$/u.test(name));
	for (const [label, pattern] of requiredPackages) {
		assert(releasePackages.filter((name) => pattern.test(name)).length === 1, `Expected exactly one ${label}.`);
	}
	assert(releasePackages.length === requiredPackages.length,
		`Unexpected or duplicate desktop package: ${releasePackages.join(', ') || '<none>'}.`);
	assert(packageFiles.includes('ffmpeg-corresponding-source.json'),
		'Missing FFmpeg corresponding-source sidecar.');
	const allowedInputs = new Set([...releasePackages, ...EXPECTED_RUNTIME_MANIFESTS, 'ffmpeg-corresponding-source.json']);
	const unexpectedInputs = packageFiles.filter((name) => !allowedInputs.has(name));
	assert(unexpectedInputs.length === 0,
		`Unexpected desktop release input: ${unexpectedInputs.join(', ')}.`);
}

export function regularDesktopReleaseFileNames(entries) {
	const invalid = entries.filter((entry) => !entry.isFile() || entry.isSymbolicLink());
	assert(invalid.length === 0, `Desktop release input is not a regular file: ${invalid.map(({ name }) => name).join(', ')}.`);
	return entries.map(({ name }) => name).sort();
}

export function desktopTranslationSourceName(releaseId, descriptor) {
	const normalizedId = String(releaseId ?? '');
	assert(/^[1-9][0-9]*$/u.test(normalizedId), 'Translation release ID is invalid.');
	validateDescriptor(descriptor, 'translation source archive', 32 * 1024 * 1024);
	assert(!descriptor.path.includes('%') && descriptor.path.startsWith(`releases/${normalizedId}/source/`)
		&& descriptor.path.endsWith('.zip'),
		'Translation source archive path does not match its release.');
	return `Audacity-translations-${normalizedId}-source.zip`;
}

function loadFfmpegCorrespondingSource(runtimeRelease) {
	const manifest = parseJson(
		runtimeRelease.evidence.correspondingSource.bytes,
		'FFmpeg corresponding-source manifest',
	);
	assert(manifest.schemaVersion === 1, 'FFmpeg corresponding-source manifest has an unsupported schema.');
	for (const [key, label] of [['source', 'FFmpeg corresponding-source archive'], ['buildSource', 'ffmpeg.wasm build-script source archive']]) {
		const source = manifest[key];
		assert(source && typeof source === 'object' && !Array.isArray(source),
			`FFmpeg corresponding-source manifest has no ${key} descriptor.`);
		const url = new URL(String(source.url || ''));
		assert(url.protocol === 'https:' && !url.username && !url.password && !url.hash,
			`${label} must use a clean HTTPS URL.`);
		assert(typeof source.fileName === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u.test(source.fileName),
			`${label} filename is invalid.`);
		assert(/^[a-f\d]{64}$/u.test(source.sha256), `${label} digest is invalid.`);
		assert(Number.isSafeInteger(source.byteLength) && source.byteLength > 0 && source.byteLength <= 2 * 1024 * 1024 * 1024,
			`${label} byte length is invalid.`);
	}
	return manifest;
}

export function validateDesktopRuntimeManifests(manifests, runtimeRelease) {
	const expected = JSON.stringify(ffmpegRuntimeStageSummary(runtimeRelease));
	for (const manifest of manifests) {
		assert(JSON.stringify(manifest.value.ffmpeg) === expected,
			`${manifest.name} does not match the verified FFmpeg runtime policy manifest.`);
		const identity = /^runtime-manifest-soundscaper-(linux|mac|win)-(arm64|x64)\.json$/u.exec(manifest.name);
		assert(manifest.value.productId === 'soundscaper' && manifest.value.target?.platform === identity?.[1]
			&& manifest.value.target?.arch === identity?.[2], `${manifest.name} has invalid product or target identity.`);
		validateDesktopNativeAddonSummary(manifest, `${identity?.[1]}-${identity?.[2]}`);
	}
}

/**
 * Unlike the FFmpeg runtime, the native payload summary is deliberately
 * different per target, so it is checked against the target the filename
 * declares rather than folded into the identical-across-targets comparison. A
 * release-shaped build must also have declared its target: a summary that fell
 * back to the build host is a local build and is never release evidence.
 */
export function validateDesktopNativeAddonSummary(manifest, targetId) {
	const summary = manifest.value.nativeAddons;
	assert(summary && typeof summary === 'object',
		`${manifest.name} does not record a staged native addon payload summary.`);
	assert(summary.target === targetId,
		`${manifest.name} records the native addon payload for ${String(summary.target)} rather than ${targetId}.`);
	assert(summary.targetSource === 'declared',
		`${manifest.name} records a build-host native addon target; release evidence requires a declared target.`);
	assert(summary.status === 'built' || summary.status === 'pending-external',
		`${manifest.name} records an unsupported native addon payload status.`);
	assert(summary.status === 'built'
		? summary.payload !== null && summary.blockedBy === null
		: summary.payload === null && typeof summary.blockedBy === 'string' && summary.blockedBy.trim().length >= 8,
	`${manifest.name} records a native addon payload status that disagrees with its payload.`);
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

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function isMainModule() {
	return Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
}

if (isMainModule()) {
	main().catch((error) => {
		console.error(`Desktop release asset preparation failed: ${error.message}`);
		process.exitCode = 1;
	});
}
