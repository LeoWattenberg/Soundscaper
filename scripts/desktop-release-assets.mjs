#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	assertDesktopCodecPolicy,
	isForbiddenDesktopFfmpegPath,
} from './lib/desktop-codec-policy.mjs';
import { stageDesktopBundledCodecCorrespondingSource } from './lib/desktop-bundled-codec-corresponding-source.mjs';
import assistanceNativeRuntimeManifest from '../config/assistance-native-runtime-manifest.json' with { type: 'json' };
import { assistanceNativeRuntimeStageSummary } from '../desktop/assistance-native-runtime-payload.mjs';
import {
	readProductReleaseLines,
	resolveProductApplicationVersion,
} from './lib/product-release-lines.mjs';
import {
	validateSoundscaperStableProfessionalNativeSummary,
} from './lib/soundscaper-professional-native-stable-summary.mjs';
import {
	stageSoundscaperProfessionalNativeReleaseCompliance,
} from './lib/soundscaper-professional-native-release-compliance.mjs';

export { validateSoundscaperStableProfessionalNativeSummary };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ASSET_ROOT = resolve(ROOT, 'release/desktop');
const TRANSLATION_BASE_URL = 'https://translations.soundscaper.org/runtime/translations/audacity/4/';
const RELEASE_PRODUCTS = Object.freeze(['soundscaper', 'framescaper']);
const RELEASE_TARGETS = Object.freeze([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
]);
const RELEASE_TARGET_PACKAGE_ROWS = Object.freeze({
	'linux-arm64': Object.freeze([
		['Linux ARM64 AppImage', 'linux-arm64\\.AppImage'],
		['Linux ARM64 Debian package', 'linux-arm64\\.deb'],
	]),
	'linux-x64': Object.freeze([
		['Linux x64 AppImage', 'linux-(?:x64|x86_64)\\.AppImage'],
		['Linux x64 Debian package', 'linux-(?:x64|amd64)\\.deb'],
	]),
	'mac-arm64': Object.freeze([
		['macOS Apple silicon DMG', 'mac-arm64\\.dmg'],
	]),
	'win-arm64': Object.freeze([
		['Windows ARM64 installer', 'win-arm64\\.exe'],
		['Windows ARM64 ZIP', 'win-arm64\\.zip'],
	]),
	'win-x64': Object.freeze([
		['Windows x64 installer', 'win-x64\\.exe'],
		['Windows x64 ZIP', 'win-x64\\.zip'],
	]),
});
export async function main(args = process.argv.slice(2)) {
	const { admissionProfile, assetRoot, productIds } = parseDesktopReleaseAssetArguments(args);
	const releaseLines = await readProductReleaseLines(ROOT);
	const effectiveAdmissionProfile = validateDesktopReleaseAdmissionProfile(
		admissionProfile, releaseLines, productIds,
	);
	const expectedVersions = new Map(productIds.map((productId) => [
		productId, resolveProductApplicationVersion(productId, releaseLines),
	]));
	const entries = await readdir(assetRoot, { withFileTypes: true });
	const packageFiles = regularDesktopReleaseFileNames(entries);
	const manifestNames = packageFiles
		.filter((name) => /^runtime-manifest-.+\.json$/u.test(name))
		.sort();
	const expectedRuntimeManifests = desktopReleaseRuntimeManifestNames(productIds);
	assert(JSON.stringify(manifestNames) === JSON.stringify(expectedRuntimeManifests),
		`Expected the selected product runtime manifests for all five native builds; received: ${manifestNames.join(', ') || '<none>'}.`);
	const manifests = await Promise.all(manifestNames.map(async (name) => {
		const bytes = await readFile(resolve(assetRoot, name));
		return { name, bytes, value: parseJson(bytes, name) };
	}));
	validateDesktopRuntimeManifests(manifests, productIds, expectedVersions, {
		admissionProfile: effectiveAdmissionProfile,
	});
	const canonical = manifests[0].value;
	for (const manifest of manifests.slice(1)) {
		assert(manifest.value.translations?.releaseId === canonical.translations?.releaseId,
			`${manifest.name} has a different translation release.`);
	}
	validateDesktopReleasePackageInventory(packageFiles,
		expectedVersions,
		productIds,
	);
	validateDesktopReleaseInputInventory(packageFiles, expectedVersions, productIds);
	const translationSource = canonical.translations?.source?.archive;
	const translationSourceName = desktopTranslationSourceName(canonical.translations?.releaseId, translationSource);
	await fetchVerified(
		new URL(translationSource.path, TRANSLATION_BASE_URL),
		resolve(assetRoot, translationSourceName),
		translationSource,
		'translation source archive',
	);
	await writeFile(resolve(assetRoot, 'Soundscaper-AGPL-3.0.txt'), await readFile(resolve(ROOT, 'LICENSE')), { flag: 'wx' });
	await writeFile(resolve(assetRoot, 'THIRD_PARTY_LICENSES.md'), await readFile(resolve(ROOT, 'THIRD_PARTY_LICENSES.md')), { flag: 'wx' });
	for (const applicationVersion of new Set(expectedVersions.values())) {
		await stageDesktopBundledCodecCorrespondingSource({
			repositoryRoot: ROOT,
			outputRoot: assetRoot,
			applicationVersion,
		});
	}
	if (effectiveAdmissionProfile === 'soundscaper-stable-1') {
		const sourceRoot = process.env.SOUNDSCAPER_M5_NATIVE_SOURCE_ROOT?.trim() ?? '';
		assert(sourceRoot !== '',
			'Stable Soundscaper release assembly requires SOUNDSCAPER_M5_NATIVE_SOURCE_ROOT.');
		await stageSoundscaperProfessionalNativeReleaseCompliance({
			repositoryRoot: ROOT,
			sourceRoot,
			outputRoot: assetRoot,
			runtimeManifests: manifests,
		});
	}

	const releaseFiles = regularDesktopReleaseFileNames(await readdir(assetRoot, { withFileTypes: true }))
		.filter((name) => name !== 'SHA256SUMS')
		.sort();
	const checksums = [];
	for (const name of releaseFiles) {
		const bytes = await readFile(resolve(assetRoot, name));
		checksums.push(`${sha256(bytes)}  ${name}`);
	}
	await writeFile(resolve(assetRoot, 'SHA256SUMS'), `${checksums.join('\n')}\n`, { flag: 'wx' });
	console.log(`Prepared ${releaseFiles.length} release assets and SHA256SUMS in ${assetRoot}`);
}

export function parseDesktopReleaseAssetArguments(args) {
	if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
		throw new TypeError('Desktop release asset arguments must be strings.');
	}
	let assetRoot = DEFAULT_ASSET_ROOT;
	let productIds = null;
	let admissionProfile = null;
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === '--product') {
			assert(productIds === null, 'Desktop release product scope may be supplied once.');
			const productId = args[index += 1];
			assert(RELEASE_PRODUCTS.includes(productId), 'Desktop release product is invalid.');
			productIds = [productId];
			continue;
		}
		if (argument === '--suite') {
			assert(productIds === null, 'Desktop release product scope may be supplied once.');
			productIds = [...RELEASE_PRODUCTS];
			continue;
		}
		if (argument === '--asset-root') {
			const path = args[index += 1];
			assert(typeof path === 'string' && path.length > 0, '--asset-root requires a path.');
			assetRoot = resolve(path);
			continue;
		}
		if (argument === '--admission-profile') {
			assert(admissionProfile === null, 'Desktop release admission profile may be supplied once.');
			admissionProfile = args[index += 1];
			assert(admissionProfile === 'soundscaper-stable-1',
				'Desktop release admission profile is invalid.');
			continue;
		}
		throw new Error(`Unknown desktop release asset option ${argument}.`);
	}
	assert(productIds !== null, 'Desktop release assembly requires --product or --suite.');
	assert(admissionProfile === null
		|| (productIds.length === 1 && productIds[0] === 'soundscaper'),
	'Desktop release admission profile requires the Soundscaper-only product scope.');
	return Object.freeze({ admissionProfile, assetRoot, productIds: Object.freeze(productIds) });
}

export function validateDesktopReleaseAdmissionProfile(
	admissionProfile, releaseLines, productIds = ['soundscaper'],
) {
	const line = releaseLines?.products?.soundscaper;
	const stableSelected = productIds.includes('soundscaper')
		&& (line?.applicationVersionChannel === 'stable' || line?.releaseChannel === 'stable');
	if (stableSelected) {
		assert(productIds.length === 1 && productIds[0] === 'soundscaper',
			'The Soundscaper stable line requires the Soundscaper-only product scope.');
		admissionProfile ??= line?.stable?.admissionProfile ?? null;
	}
	if (admissionProfile === null) return null;
	assert(admissionProfile === 'soundscaper-stable-1'
		&& line?.stable?.admissionProfile === admissionProfile,
	'The requested desktop release admission profile is not authoritative.');
	assert(line.applicationVersionChannel === 'stable' && line.releaseChannel === 'stable'
		&& line.stable.status === 'admitted',
	'The Soundscaper Stable 1 release line is not admitted and selected for assembly.');
	return admissionProfile;
}

export function desktopReleaseRuntimeManifestNames(productIds) {
	assert(Array.isArray(productIds) && productIds.length > 0
		&& productIds.every((id) => RELEASE_PRODUCTS.includes(id))
		&& new Set(productIds).size === productIds.length,
	'An exact desktop release product set is required.');
	return productIds.flatMap((productId) => RELEASE_TARGETS.map(
		(target) => `runtime-manifest-${productId}-${target}.json`,
	)).sort();
}

export function validateDesktopReleaseInputInventory(packageFiles, applicationVersion, productIds) {
	validateDesktopReleasePackageInventory(packageFiles, applicationVersion, productIds);
	const expected = desktopReleaseRuntimeManifestNames(productIds);
	const actual = packageFiles.filter((name) => /^runtime-manifest-.+\.json$/u.test(name)).sort();
	assert(JSON.stringify(actual) === JSON.stringify(expected),
		'Desktop release input must contain exactly five runtime manifests per selected product.');
}

export function validateDesktopReleasePackageInventory(
	packageFiles,
	applicationVersionAuthority,
	productIds = ['soundscaper'],
) {
	assert(Array.isArray(productIds) && productIds.length > 0
		&& productIds.every((id) => RELEASE_PRODUCTS.includes(id))
		&& new Set(productIds).size === productIds.length,
		'An exact desktop release product set is required.');
	const requiredPackages = productIds.flatMap((productId) => RELEASE_TARGETS.flatMap((targetId) => (
		desktopReleaseTargetPackageInventory(
			productId,
			targetId,
			desktopReleaseApplicationVersion(productId, applicationVersionAuthority),
		)
			.map(({ label, pattern }) => [
				productIds.length === 1 && productId === 'soundscaper'
					? label
					: `${productId === 'framescaper' ? 'Framescaper' : 'Soundscaper'} ${label}`,
				pattern,
			])
	)));
	const releasePackages = packageFiles.filter((name) => /\.(?:AppImage|deb|dmg|exe|zip)$/u.test(name));
	for (const [label, pattern] of requiredPackages) {
		assert(releasePackages.filter((name) => pattern.test(name)).length === 1, `Expected exactly one ${label}.`);
	}
	assert(releasePackages.length === requiredPackages.length,
		`Unexpected or duplicate desktop package: ${releasePackages.join(', ') || '<none>'}.`);
	const runtimeManifests = productIds.flatMap((productId) => RELEASE_TARGETS.map(
		(target) => `runtime-manifest-${productId}-${target}.json`,
	));
	const forbiddenInputs = packageFiles.filter(isForbiddenDesktopFfmpegPath);
	assert(forbiddenInputs.length === 0,
		`Desktop release input contains forbidden bundled FFmpeg/libav content: ${forbiddenInputs.join(', ')}.`);
	const allowedInputs = new Set([...releasePackages, ...runtimeManifests]);
	const unexpectedInputs = packageFiles.filter((name) => !allowedInputs.has(name));
	assert(unexpectedInputs.length === 0,
		`Unexpected desktop release input: ${unexpectedInputs.join(', ')}.`);
}

export function desktopReleaseApplicationVersion(productId, authority) {
	assert(RELEASE_PRODUCTS.includes(productId), 'Desktop release product is invalid.');
	const applicationVersion = authority instanceof Map ? authority.get(productId) : authority;
	assert(typeof applicationVersion === 'string' && applicationVersion.length > 0,
		`Desktop runtime manifests have no ${productId} application version.`);
	return applicationVersion;
}

export function desktopReleaseTargetPackageInventory(productId, targetId, applicationVersion) {
	assert(RELEASE_PRODUCTS.includes(productId), 'Desktop release product is invalid.');
	assert(RELEASE_TARGETS.includes(targetId), 'Desktop release target is invalid.');
	assert(typeof applicationVersion === 'string' && applicationVersion.length > 0,
		'Desktop release application version is invalid.');
	const productName = productId === 'framescaper' ? 'Framescaper' : 'Soundscaper';
	const version = escapeRegex(applicationVersion);
	return Object.freeze(RELEASE_TARGET_PACKAGE_ROWS[targetId].map(([label, suffix]) => Object.freeze({
		label,
		pattern: new RegExp(`^${productName}-${version}-${suffix}$`, 'u'),
	})));
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

export function validateDesktopRuntimeManifests(
	manifests, productIds = RELEASE_PRODUCTS, expectedVersions, options = {},
) {
	const selectedProducts = new Set(productIds);
	for (const manifest of manifests) {
		assert(manifest.value && typeof manifest.value === 'object' && !Array.isArray(manifest.value),
			`${manifest.name} is not a desktop runtime manifest.`);
		assert(!Object.hasOwn(manifest.value, 'ffmpeg'),
			`${manifest.name} retains a legacy bundled FFmpeg runtime summary.`);
		assertDesktopCodecPolicy(manifest.value.desktopCodecPolicy,
			`${manifest.name} desktop codec policy`);
		const identity = /^runtime-manifest-(soundscaper|framescaper)-(linux|mac|win)-(arm64|x64)\.json$/u.exec(manifest.name);
		assert(identity !== null && selectedProducts.has(identity[1]),
			`${manifest.name} is outside the selected desktop release product scope.`);
		assert(manifest.value.productId === identity?.[1] && manifest.value.target?.platform === identity?.[2]
			&& manifest.value.target?.arch === identity?.[3], `${manifest.name} has invalid product or target identity.`);
		const targetId = `${identity?.[2]}-${identity?.[3]}`;
		if (expectedVersions !== undefined) {
			assert(manifest.value.applicationVersion === expectedVersions.get(identity[1]),
				`${manifest.name} does not use its selected product release-line version.`);
		}
		if (options.admissionProfile === 'soundscaper-stable-1') {
			assert(manifest.value.applicationVersionChannel === 'stable'
				&& manifest.value.releaseChannel === 'stable',
			`${manifest.name} does not declare the stable release channel.`);
		}
		assert(JSON.stringify(manifest.value.assistanceNativeRuntime)
			=== JSON.stringify(assistanceNativeRuntimeStageSummary(assistanceNativeRuntimeManifest, targetId)),
			`${manifest.name} has invalid assistance native-runtime evidence.`);
		validateDesktopNativeAddonSummary(manifest, targetId, {
			stableSoundscaper: identity?.[1] === 'soundscaper'
				&& options.admissionProfile === 'soundscaper-stable-1',
		});
		if (identity?.[1] === 'framescaper') validateFramescaperNativeHostSummary(manifest, targetId);
		else {
			assert(manifest.value.framescaperNativeHosts === null
				|| manifest.value.framescaperNativeHosts === undefined,
			`${manifest.name} unexpectedly carries Framescaper native-host state.`);
			if (options.admissionProfile === 'soundscaper-stable-1') {
				validateSoundscaperStableProfessionalNativeSummary(
					manifest.value.soundscaperProfessionalNative, targetId, manifest.name,
					manifest.value.sourceRevision,
				);
			}
		}
	}
}

export function validateFramescaperNativeHostSummary(manifest, targetId) {
	const summary = manifest.value.framescaperNativeHosts;
	assert(summary && typeof summary === 'object',
		`${manifest.name} does not record Framescaper native-host payloads.`);
	assert(summary.target === targetId && summary.targetSource === 'declared',
		`${manifest.name} has an invalid Framescaper target or target source.`);
	for (const [field, label] of [['mediaHost', 'media host'], ['openFxHost', 'OpenFX host']]) {
		const host = summary[field];
		assert(host && typeof host === 'object' && ['built', 'pending-external'].includes(host.status),
			`${manifest.name} has an invalid Framescaper ${label} status.`);
		assert(host.payloadManifest && typeof host.payloadManifest.id === 'string'
			&& /^[a-f\d]{64}$/u.test(host.payloadManifest.sha256),
		`${manifest.name} has an invalid Framescaper ${label} manifest pin.`);
		assert(host.status === 'built'
			? host.blockedBy === null && Array.isArray(host.payloads) && host.payloads.length > 0
			: typeof host.blockedBy === 'string' && host.blockedBy.trim().length >= 8
				&& Array.isArray(host.payloads) && host.payloads.length === 0,
		`${manifest.name} has inconsistent Framescaper ${label} payload state.`);
	}
}

/**
 * Native payload summaries are deliberately different per target, so each is
 * checked against the target its filename declares. A release-shaped build
 * must also have declared its target: a summary that fell back to the build
 * host is a local build and is never release evidence.
 */
export function validateDesktopNativeAddonSummary(manifest, targetId, options = {}) {
	const summary = manifest.value.nativeAddons;
	if (options.stableSoundscaper === true) {
		assert(manifest.value.productId === 'soundscaper' && summary === null,
			`${manifest.name} Stable Soundscaper retains the legacy development native addon.`);
		return;
	}
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
