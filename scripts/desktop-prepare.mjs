#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	cp,
	mkdir,
	readFile,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { COMMITTED_LOCALE_TAGS } from '../src/common/i18n/locales.js';
import assistanceNativeRuntimeManifest from '../config/assistance-native-runtime-manifest.json' with { type: 'json' };
import { stageAssistanceNativeRuntimePayload } from '../desktop/assistance-native-runtime-payload.mjs';
import { generateDesktopIcon } from './desktop-icons.mjs';
import {
	compileDesktopProjectLibraryRuntime,
	DESKTOP_RUNTIME_PACKAGE_IMPORTS,
	stageDesktopApplicationSources,
} from './lib/desktop-project-library-runtime.mjs';
import {
	stageVerifiedFfmpegNotice,
	stageVerifiedFfmpegRuntime,
	verifyFfmpegRuntimeManifest,
} from './lib/ffmpeg-runtime-manifest.mjs';
import {
	nativeAddonPayloadOutputRoot,
	resolveNativeAddonPayloadTarget,
	stageVerifiedNativeAddonPayload,
	verifyNativeAddonPayloadManifest,
} from './lib/native-addon-payload-manifest.mjs';
import {
	stageVerifiedFramescaperNativeHostPayloads,
	verifyFramescaperNativeHostPayloads,
} from './lib/framescaper-native-host-payload-staging.mjs';
import {
	professionalNativePayloadOutputRoot,
	stageVerifiedSoundscaperProfessionalNativePayload,
	verifySoundscaperProfessionalNativePayload,
} from './lib/soundscaper-professional-native-payload.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_ROOT = resolve(ROOT, '.desktop-build');
const APP_ROOT = resolve(BUILD_ROOT, 'app');
const RENDERER_ROOT = resolve(BUILD_ROOT, 'renderer');
const RUNTIME_ROOT = resolve(BUILD_ROOT, 'runtime');
const DESKTOP_RUNTIME_ROOT = resolve(BUILD_ROOT, 'desktop-runtime');
const DESKTOP_NOTICE_PATH = resolve(BUILD_ROOT, 'licenses/THIRD_PARTY_LICENSES.md');
const TRANSLATION_ROOT = resolve(RUNTIME_ROOT, 'translations/audacity/4');
const DEFAULT_TRANSLATIONS_URL = 'https://translations.soundscaper.org/runtime/translations/audacity/4/';
// The assistance and native services validate their catalogs and payloads
// against these shipped registers. Executable payloads stay outside the asar;
// only their authenticated pins live inside it.
const ASSISTANCE_REGISTERS = Object.freeze([
	'config/assistance-native-runtime-manifest.json',
	'config/ffmpeg-runtime-manifest.json',
	'config/framescaper-media-host-payload-manifest.json',
	'config/framescaper-openfx-host-payload-manifest.json',
	'config/local-model-catalog.json',
	'config/milestone-5-native-isolation-review-policy.json',
	'config/milestone-5-package-release-authentication-policy.json',
	'config/milestone-5-native-source-acquisitions.json',
	'config/native-addon-payload-manifest.json',
	'config/production-licensing-matrix.json',
	'config/soundscaper-professional-native-payload-manifest.json',
]);
const PRODUCT_ID = process.env.SCAPE_PRODUCT === 'framescaper' ? 'framescaper' : 'soundscaper';
const PRODUCT_NAME = PRODUCT_ID === 'framescaper' ? 'Framescaper' : 'Soundscaper';
const APP_SCHEME = PRODUCT_ID === 'framescaper' ? 'framescaper-app' : 'soundscaper-app';
const SOURCE_REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;

async function main() {
	const projectPackage = parseJson(await readFile(resolve(ROOT, 'package.json')), 'package.json');
	assert(projectPackage.name === 'soundscaper', 'Run desktop preparation from the Soundscaper checkout.');
	await assertFile(resolve(ROOT, 'desktop/main.mjs'), 'desktop/main.mjs');
	await assertFile(resolve(ROOT, 'desktop/preload.mjs'), 'desktop/preload.mjs');
	// Resolving and verifying the native payload before the build tree is
	// destroyed keeps a bad native manifest from costing the previous build,
	// exactly as the FFmpeg admission wrapper does.
	const nativeTarget = resolveNativeAddonPayloadTarget({
		platform: process.env.SOUNDSCAPER_DESKTOP_TARGET_PLATFORM ?? null,
		arch: process.env.SOUNDSCAPER_DESKTOP_TARGET_ARCH ?? null,
	});
	const nativeAddonRelease = await verifyNativeAddonPayloadManifest({
		repositoryRoot: ROOT,
		target: nativeTarget.id,
		targetSource: nativeTarget.source,
	});
	const framescaperNativeHostRelease = PRODUCT_ID === 'framescaper'
		? await verifyFramescaperNativeHostPayloads({
			repositoryRoot: ROOT,
			target: nativeTarget.id,
			targetSource: nativeTarget.source,
		})
		: null;
	const soundscaperProfessionalNativeRelease = PRODUCT_ID === 'soundscaper'
		? await verifySoundscaperProfessionalNativePayload({
			repositoryRoot: ROOT,
			target: nativeTarget.id,
			targetSource: nativeTarget.source,
		})
		: null;
	await admitDesktopFfmpegAssembly({
		repositoryRoot: ROOT,
		assemble: async (ffmpegRelease) => {
			await rm(BUILD_ROOT, { recursive: true, force: true });
			await mkdir(BUILD_ROOT, { recursive: true });
			const desktopRuntime = await compileDesktopProjectLibraryRuntime({
				repositoryRoot: ROOT,
				outputRoot: DESKTOP_RUNTIME_ROOT,
			});
			const ffmpeg = await stageFfmpeg(ffmpegRelease);
			const assistanceNativeRuntime = await stageAssistanceNativeRuntimePayload({
				manifest: assistanceNativeRuntimeManifest,
				targetId: nativeTarget.id,
				nodeModulesRoot: resolve(ROOT, 'node_modules'),
				outputRoot: RUNTIME_ROOT,
			});
			const nativeAddons = await stageNativeAddons(nativeAddonRelease);
			const soundscaperProfessionalNative = soundscaperProfessionalNativeRelease === null
				? null
				: await stageVerifiedSoundscaperProfessionalNativePayload({
					release: soundscaperProfessionalNativeRelease,
					outputRoot: professionalNativePayloadOutputRoot(
						RUNTIME_ROOT, soundscaperProfessionalNativeRelease,
					),
				});
			const framescaperNativeHosts = framescaperNativeHostRelease === null
				? null
				: await stageVerifiedFramescaperNativeHostPayloads({
					release: framescaperNativeHostRelease,
					outputRoot: RUNTIME_ROOT,
				});
			const translations = await stageTranslations();
			await generateDesktopIcon({
				...(PRODUCT_ID === 'framescaper' ? { sourcePath: resolve(ROOT, 'public/logo/framescaper-icon.svg') } : {}),
			});
			await buildRenderer(ffmpegRelease);
			await stageApplication(projectPackage, framescaperNativeHostRelease);

			const stageManifest = {
				schemaVersion: 1,
				productId: PRODUCT_ID,
				applicationVersion: projectPackage.version,
				sourceRevision: resolveDesktopSourceRevision(),
				target: resolveDesktopStageTarget(nativeTarget),
				desktopRuntime,
				assistanceNativeRuntime,
				ffmpeg,
				nativeAddons,
				soundscaperProfessionalNative,
				framescaperNativeHosts,
				translations,
			};
			await writeJson(resolve(BUILD_ROOT, 'stage-manifest.json'), stageManifest);
			console.log(`Prepared ${PRODUCT_NAME} desktop ${projectPackage.version} in ${BUILD_ROOT}`);
		},
	});
}

export function resolveDesktopSourceRevision(
	value = process.env.SOUNDSCAPER_SOURCE_REVISION,
) {
	const revision = value?.trim() ?? '';
	if (revision === '') return null;
	assert(SOURCE_REVISION.test(revision), 'Desktop source revision must be one Git object ID.');
	return revision;
}

export function resolveDesktopStageTarget(nativeTarget) {
	const match = /^(linux|mac|win)-(x64|arm64)$/u.exec(String(nativeTarget?.id ?? ''));
	assert(match !== null && ['declared', 'build-host'].includes(nativeTarget?.source),
		'Resolved desktop target is invalid.');
	return { platform: match[1], arch: match[2] };
}

export async function admitDesktopFfmpegAssembly({ repositoryRoot = ROOT, assemble }) {
	assert(typeof assemble === 'function', 'Desktop FFmpeg assembly callback is required.');
	const release = await verifyFfmpegRuntimeManifest({
		repositoryRoot,
		purpose: 'desktop-assembly',
	});
	return assemble(release);
}

async function stageFfmpeg(release) {
	const outputRoot = resolve(RUNTIME_ROOT, `ffmpeg/${release.manifest.package.version}`);
	const summary = await stageVerifiedFfmpegRuntime({ release, outputRoot });
	await stageVerifiedFfmpegNotice({ release, outputPath: DESKTOP_NOTICE_PATH });
	return summary;
}

/**
 * Native payloads stage under the runtime root, which already ships as an
 * extraResource, so the addon lands outside the asar with no `asarUnpack` entry
 * and no runtime rebuild — the two things the packaging decision forbids.
 */
async function stageNativeAddons(release) {
	return stageVerifiedNativeAddonPayload({
		release,
		outputRoot: nativeAddonPayloadOutputRoot(RUNTIME_ROOT, release),
	});
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

async function buildRenderer(ffmpegRelease) {
	const vite = resolve(ROOT, 'node_modules/vite/bin/vite.js');
	await run(process.execPath, [vite, 'build', '--outDir', RENDERER_ROOT], {
		env: {
			...process.env,
			SCAPE_PRODUCT: PRODUCT_ID,
			PUBLIC_FFMPEG_CORE_BASE_URL: `${APP_SCHEME}://bundle/${ffmpegRelease.manifest.runtime.publicPrefix}`,
			PUBLIC_TRANSLATIONS_BASE_URL: `${APP_SCHEME}://bundle/runtime/translations/audacity/4/`,
		},
	});
	await assertFile(resolve(RENDERER_ROOT, 'index.html'), 'desktop editor document');
}

async function stageApplication(projectPackage, framescaperNativeHostRelease) {
	await mkdir(APP_ROOT, { recursive: true });
	await stageDesktopApplicationSources({
		desktopSourceRoot: resolve(ROOT, 'desktop'),
		applicationDesktopRoot: resolve(APP_ROOT, 'desktop'),
		runtimeRoot: DESKTOP_RUNTIME_ROOT,
	});
	await writeJson(resolve(APP_ROOT, 'desktop/product.json'), { id: PRODUCT_ID });
	await mkdir(resolve(APP_ROOT, 'config'), { recursive: true });
	for (const register of ASSISTANCE_REGISTERS) {
		const verifiedBytes = framescaperNativeHostRelease === null
			? null
			: register === 'config/framescaper-media-host-payload-manifest.json'
				? framescaperNativeHostRelease.mediaHost.manifestBytes
				: register === 'config/framescaper-openfx-host-payload-manifest.json'
					? framescaperNativeHostRelease.openFxHost.manifestBytes
					: null;
		if (verifiedBytes === null) {
			await cp(resolve(ROOT, register), resolve(APP_ROOT, register), { errorOnExist: true });
		} else {
			await writeFile(resolve(APP_ROOT, register), verifiedBytes, { flag: 'wx' });
		}
	}
	await writeJson(resolve(APP_ROOT, 'package.json'), {
		name: `${PRODUCT_ID}-desktop`,
		productName: PRODUCT_NAME,
		desktopName: `org.${PRODUCT_ID}.desktop`,
		version: projectPackage.version,
		description: PRODUCT_ID === 'framescaper' ? 'Local-first video editor' : 'Local-first multitrack audio editor',
		main: 'desktop/main.mjs',
		type: 'module',
		imports: DESKTOP_RUNTIME_PACKAGE_IMPORTS,
		license: 'AGPL-3.0-only',
		author: { name: 'kw.media', url: 'https://kw.media' },
		homepage: `https://${PRODUCT_ID}.org`,
	});
	for (const target of Object.values(DESKTOP_RUNTIME_PACKAGE_IMPORTS)) {
		await assertFile(resolve(APP_ROOT, target), `staged desktop package import target ${target}`);
	}
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

function isMainModule() {
	return Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
}

if (isMainModule()) {
	main().catch((error) => {
		console.error(`Desktop preparation failed: ${error.message}`);
		process.exitCode = 1;
	});
}
