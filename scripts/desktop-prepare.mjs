#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	cp,
	copyFile,
	mkdir,
	readFile,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMMITTED_LOCALE_TAGS } from '../src/common/i18n/locales.js';
import { generateDesktopIcon } from './desktop-icons.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_ROOT = resolve(ROOT, '.desktop-build');
const APP_ROOT = resolve(BUILD_ROOT, 'app');
const RENDERER_ROOT = resolve(BUILD_ROOT, 'renderer');
const RUNTIME_ROOT = resolve(BUILD_ROOT, 'runtime');
const TRANSLATION_ROOT = resolve(RUNTIME_ROOT, 'translations/audacity/4');
const DEFAULT_TRANSLATIONS_URL = 'https://translations.soundscaper.org/runtime/translations/audacity/4/';
const PRODUCT_ID = process.env.SCAPE_PRODUCT === 'framescaper' ? 'framescaper' : 'soundscaper';
const PRODUCT_NAME = PRODUCT_ID === 'framescaper' ? 'Framescaper' : 'Soundscaper';
const APP_SCHEME = PRODUCT_ID === 'framescaper' ? 'framescaper-app' : 'soundscaper-app';
const FFMPEG_VERSION = '0.12.10';
const FFMPEG_BUILD_SOURCE_VERSION = '12.15';
const FFMPEG_FILES = Object.freeze({
	'ffmpeg-core.js': '67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3',
	'ffmpeg-core.wasm': '9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7',
});

async function main() {
	const projectPackage = parseJson(await readFile(resolve(ROOT, 'package.json')), 'package.json');
	assert(projectPackage.name === 'soundscaper', 'Run desktop preparation from the Soundscaper checkout.');
	assert(projectPackage.dependencies?.['@ffmpeg/core'] === FFMPEG_VERSION,
		`package.json must pin @ffmpeg/core ${FFMPEG_VERSION}.`);
	await assertFile(resolve(ROOT, 'desktop/main.mjs'), 'desktop/main.mjs');
	await assertFile(resolve(ROOT, 'desktop/preload.mjs'), 'desktop/preload.mjs');

	await rm(BUILD_ROOT, { recursive: true, force: true });
	await mkdir(BUILD_ROOT, { recursive: true });
	const ffmpeg = await stageFfmpeg();
	const translations = await stageTranslations();
	await generateDesktopIcon({
		...(PRODUCT_ID === 'framescaper' ? { sourcePath: resolve(ROOT, 'public/logo/framescaper-icon.svg') } : {}),
	});
	await buildRenderer();
	await stageApplication(projectPackage);

	const stageManifest = {
		schemaVersion: 1,
		applicationVersion: projectPackage.version,
		ffmpeg,
		translations,
	};
	await writeJson(resolve(BUILD_ROOT, 'stage-manifest.json'), stageManifest);
	console.log(`Prepared ${PRODUCT_NAME} desktop ${projectPackage.version} in ${BUILD_ROOT}`);
}

async function stageFfmpeg() {
	const packageRoot = resolve(ROOT, 'node_modules/@ffmpeg/core');
	const packageMetadata = parseJson(await readFile(resolve(packageRoot, 'package.json')), '@ffmpeg/core/package.json');
	assert(packageMetadata.version === FFMPEG_VERSION,
		`Installed @ffmpeg/core is ${packageMetadata.version || '<unknown>'}; expected ${FFMPEG_VERSION}. Run npm ci.`);
	const outputRoot = resolve(RUNTIME_ROOT, `ffmpeg/${FFMPEG_VERSION}`);
	await mkdir(outputRoot, { recursive: true });
	const files = {};
	for (const [name, expectedSha256] of Object.entries(FFMPEG_FILES)) {
		const source = resolve(packageRoot, `dist/esm/${name}`);
		const bytes = await readFile(source);
		const actualSha256 = sha256(bytes);
		assert(actualSha256 === expectedSha256,
			`@ffmpeg/core ${name} digest mismatch: expected ${expectedSha256}, received ${actualSha256}.`);
		await copyFile(source, resolve(outputRoot, name));
		files[name] = { byteLength: bytes.byteLength, sha256: actualSha256 };
	}
	const manifest = {
		schemaVersion: 1,
		package: '@ffmpeg/core',
		version: FFMPEG_VERSION,
		license: 'GPL-2.0-or-later',
		source: `https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v${FFMPEG_BUILD_SOURCE_VERSION}`,
		files,
	};
	await writeJson(resolve(outputRoot, 'manifest.json'), manifest);
	return manifest;
}

async function stageTranslations() {
	const localSource = process.env.SOUNDSCAPER_DESKTOP_TRANSLATIONS_SOURCE?.trim();
	await mkdir(dirname(TRANSLATION_ROOT), { recursive: true });
	if (localSource) {
		const source = resolve(ROOT, localSource);
		assert(source !== TRANSLATION_ROOT, 'Translation snapshot source cannot be the generated destination.');
		await cp(source, TRANSLATION_ROOT, { recursive: true, errorOnExist: true });
	} else {
		await retry(async () => {
			await rm(TRANSLATION_ROOT, { recursive: true, force: true });
			await run(process.execPath, [
				resolve(ROOT, 'scripts/manage-audacity-translation-release.mjs'),
				'snapshot',
				'--output', TRANSLATION_ROOT,
				'--base-url', translationBaseUrl().href,
			]);
		}, 'public translation snapshot');
	}

	let latest;
	try {
		latest = parseJson(await readFile(resolve(TRANSLATION_ROOT, 'latest.json')), 'desktop translation latest.json');
	} catch (error) {
		throw new Error(`No compatible released translation snapshot was staged. Publish a release for the current reviewed mapping, or set SOUNDSCAPER_DESKTOP_TRANSLATIONS_SOURCE to a complete verified snapshot. ${error.message}`);
	}
	assert(latest.schemaVersion === 1 && typeof latest.releaseId === 'string',
		'Desktop translation latest.json has an unsupported shape.');
	assert(latest.locales && typeof latest.locales === 'object' && !Array.isArray(latest.locales),
		'Desktop translation latest.json has no locale descriptors.');
	for (const locale of COMMITTED_LOCALE_TAGS) {
		assert(latest.locales[locale]?.eligible === true,
			`Released translation snapshot does not provide committed locale ${locale}.`);
	}
	await verifyTranslationPacks(latest);

	const manifestBytes = await ensureTranslationObject(latest.manifest, 'translation release manifest', localSource);
	const manifest = parseJson(manifestBytes, 'translation release manifest');
	assert(String(manifest.artifactId) === latest.releaseId,
		'Translation release manifest does not match latest.json.');
	await ensureTranslationObject(manifest.audit, 'translation audit', localSource);
	await ensureTranslationObject(manifest.source?.license, 'translation source license', localSource);

	return {
		releaseId: latest.releaseId,
		latest: descriptorForBytes('latest.json', await readFile(resolve(TRANSLATION_ROOT, 'latest.json'))),
		manifest: latest.manifest,
		source: latest.source,
	};
}

async function verifyTranslationPacks(latest) {
	const checked = new Set();
	for (const [locale, descriptor] of Object.entries(latest.locales)) {
		validateDescriptor(descriptor, `translation pack ${locale}`, 2 * 1024 * 1024);
		if (checked.has(descriptor.path)) continue;
		const bytes = await readFile(safeGeneratedPath(TRANSLATION_ROOT, descriptor.path));
		assert(bytes.byteLength === descriptor.byteLength && sha256(bytes) === descriptor.sha256,
			`Staged translation pack ${locale} does not match latest.json.`);
		checked.add(descriptor.path);
	}
}

async function ensureTranslationObject(descriptor, label, localSource) {
	validateDescriptor(descriptor, label, 32 * 1024 * 1024);
	const output = safeGeneratedPath(TRANSLATION_ROOT, descriptor.path);
	try {
		const bytes = await readFile(output);
		verifyDescriptor(bytes, descriptor, label);
		return bytes;
	} catch (error) {
		if (localSource) {
			throw new Error(`SOUNDSCAPER_DESKTOP_TRANSLATIONS_SOURCE is incomplete: ${label} ${descriptor.path} is missing or invalid. ${error.message}`);
		}
	}

	const baseUrl = translationBaseUrl();
	const url = new URL(descriptor.path, baseUrl);
	assert(url.origin === baseUrl.origin && url.pathname.startsWith(baseUrl.pathname),
		`${label} path leaves the translation release root.`);
	const bytes = await retry(async () => {
		const response = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: 'no-store' });
		assert(response.ok, `${label} request returned HTTP ${response.status}.`);
		return Buffer.from(await response.arrayBuffer());
	}, label);
	verifyDescriptor(bytes, descriptor, label);
	await mkdir(dirname(output), { recursive: true });
	await writeFile(output, bytes, { flag: 'wx' });
	return bytes;
}

async function buildRenderer() {
	const vite = resolve(ROOT, 'node_modules/vite/bin/vite.js');
	await run(process.execPath, [vite, 'build', '--outDir', RENDERER_ROOT], {
		env: {
			...process.env,
			PUBLIC_AUDIO_EDITOR_V2: 'true',
			SCAPE_PRODUCT: PRODUCT_ID,
			PUBLIC_FFMPEG_CORE_BASE_URL: `${APP_SCHEME}://bundle/runtime/ffmpeg/0.12.10`,
			PUBLIC_TRANSLATIONS_BASE_URL: `${APP_SCHEME}://bundle/runtime/translations/audacity/4/`,
		},
	});
	await assertFile(resolve(RENDERER_ROOT, 'index.html'), 'desktop editor document');
}

async function stageApplication(projectPackage) {
	await mkdir(APP_ROOT, { recursive: true });
	await cp(resolve(ROOT, 'desktop'), resolve(APP_ROOT, 'desktop'), { recursive: true });
	await writeJson(resolve(APP_ROOT, 'desktop/product.json'), { id: PRODUCT_ID });
	await writeJson(resolve(APP_ROOT, 'package.json'), {
		name: `${PRODUCT_ID}-desktop`,
		productName: PRODUCT_NAME,
		desktopName: `org.${PRODUCT_ID}.desktop`,
		version: projectPackage.version,
		description: PRODUCT_ID === 'framescaper' ? 'Local-first video editor' : 'Local-first multitrack audio editor',
		main: 'desktop/main.mjs',
		type: 'module',
		license: 'AGPL-3.0-only',
		author: { name: 'kw.media', url: 'https://kw.media' },
		homepage: `https://${PRODUCT_ID}.org`,
	});
}

function translationBaseUrl() {
	const url = new URL(process.env.PUBLIC_TRANSLATIONS_BASE_URL || DEFAULT_TRANSLATIONS_URL);
	assert(url.protocol === 'https:', 'Desktop translation staging requires an HTTPS release root.');
	url.pathname = `${url.pathname.replace(/\/+$/u, '')}/`;
	url.search = '';
	url.hash = '';
	return url;
}

function validateDescriptor(descriptor, label, maximumBytes) {
	assert(descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor), `${label} descriptor is missing.`);
	assert(typeof descriptor.path === 'string' && descriptor.path.length > 0, `${label} path is missing.`);
	assert(/^[a-f\d]{64}$/u.test(descriptor.sha256), `${label} digest is invalid.`);
	assert(Number.isSafeInteger(descriptor.byteLength) && descriptor.byteLength > 0 && descriptor.byteLength <= maximumBytes,
		`${label} byte length is invalid.`);
}

function verifyDescriptor(bytes, descriptor, label) {
	assert(bytes.byteLength === descriptor.byteLength, `${label} byte length does not match its descriptor.`);
	assert(sha256(bytes) === descriptor.sha256, `${label} digest does not match its descriptor.`);
}

function safeGeneratedPath(root, relativePath) {
	assert(typeof relativePath === 'string' && !relativePath.includes('\\') && !relativePath.startsWith('/'),
		`Unsafe generated relative path: ${relativePath}`);
	const output = resolve(root, relativePath);
	assert(output.startsWith(`${resolve(root)}${sep}`), `Generated path escapes its root: ${relativePath}`);
	return output;
}

function descriptorForBytes(path, bytes) {
	return { path, byteLength: bytes.byteLength, sha256: sha256(bytes) };
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

async function writeJson(path, value) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function parseJson(bytes, label) {
	try {
		return JSON.parse(String(bytes));
	} catch (error) {
		throw new Error(`${label} is not valid JSON: ${error.message}`);
	}
}

async function assertFile(path, label) {
	let metadata;
	try {
		metadata = await stat(path);
	} catch {
		throw new Error(`Required ${label} is missing: ${path}`);
	}
	assert(metadata.isFile(), `Required ${label} is not a regular file: ${path}`);
}

function run(command, args, options = {}) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, {
			cwd: ROOT,
			stdio: 'inherit',
			...options,
		});
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (code === 0) resolvePromise();
			else reject(new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`));
		});
	});
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

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

main().catch((error) => {
	console.error(`Desktop preparation failed: ${error.message}`);
	process.exitCode = 1;
});
