/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';

import { zipSync } from 'fflate';

import closureAdmission from '../../config/desktop-bundled-codec-corresponding-source.json' with { type: 'json' };
import {
	DESKTOP_BUNDLED_FLAC_WASM,
	DESKTOP_BUNDLED_LAME_WASM,
	DESKTOP_BUNDLED_MPG123_WASM,
	DESKTOP_BUNDLED_OPUS_WASM,
	DESKTOP_BUNDLED_TWOLAME_WASM,
	DESKTOP_BUNDLED_VORBIS_WASM,
	DESKTOP_BUNDLED_WAVPACK_WASM,
} from './desktop-external-ffmpeg-runtime-files.mjs';

const CONFIG_PATH = 'config/desktop-bundled-codec-corresponding-source.json';
const EXPECTED_CODEC_IDS = Object.freeze([
	'flac', 'lame', 'mpg123', 'opus', 'twolame', 'vorbis', 'wavpack',
]);
const EXPECTED_ARCHIVE_KEYS = Object.freeze({
	flac: ['flac:archive:flac-1.5.0.tar.xz'],
	lame: ['lame:archive:lame-4.0.tar.gz'],
	mpg123: ['mpg123:archive:mpg123-1.33.7.tar.bz2', 'mpg123:detached-signature:mpg123-1.33.7.tar.bz2.sig', 'mpg123:signing-key:mpg123-1.33.7-signing-key.asc'],
	opus: ['ogg:archive:libogg-1.3.6.tar.xz', 'opus:archive:opus-1.6.1.tar.gz'],
	twolame: ['twolame:archive:twolame-0.4.0.tar.gz'],
	vorbis: ['ogg:archive:libogg-1.3.6.tar.xz', 'vorbis:archive:libvorbis-1.3.7.tar.xz'],
	wavpack: [],
});
const EXPECTED_SUPPORT_FILES = Object.freeze([
	'scripts/lib/bundled-codec-source-input.mjs',
	'scripts/lib/wavpack-wasm-toolchain.mjs',
]);
const RUNTIME_BY_CODEC = Object.freeze({
	flac: DESKTOP_BUNDLED_FLAC_WASM,
	lame: DESKTOP_BUNDLED_LAME_WASM,
	mpg123: DESKTOP_BUNDLED_MPG123_WASM,
	opus: DESKTOP_BUNDLED_OPUS_WASM,
	twolame: DESKTOP_BUNDLED_TWOLAME_WASM,
	vorbis: DESKTOP_BUNDLED_VORBIS_WASM,
	wavpack: DESKTOP_BUNDLED_WAVPACK_WASM,
});
const ARCHIVE_FIELDS = Object.freeze({
	archive: Object.freeze({ url: 'archiveUrl', redirect: 'archiveRedirectUrl', sha256: 'archiveSha256' }),
	'detached-signature': Object.freeze({
		url: 'signatureUrl', redirect: 'signatureRedirectUrl', sha256: 'signatureSha256',
	}),
	'signing-key': Object.freeze({
		url: 'signingKeyUrl', redirect: 'signingKeyRedirectUrl', sha256: 'signingKeySha256',
	}),
});
const MAXIMUM_LOCAL_FILE_BYTES = 8 * 1024 * 1024;
const MAXIMUM_BUNDLE_BYTES = 128 * 1024 * 1024;

/** Validate the complete local input closure before any upstream request occurs. */
export async function validateDesktopBundledCodecSourceCheckout({
	repositoryRoot,
	closure = closureAdmission,
} = {}) {
	const repository = await validateRepositoryRoot(repositoryRoot);
	validateClosureShape(closure);
	const files = new Map();
	const addPinned = async (descriptor, destination = descriptor.path, label = 'source input') => {
		const input = await readPinnedRepositoryFile(repository, descriptor, label);
		addFile(files, destination, input.bytes);
		return input;
	};

	await addPinned(closure.instructions, 'README.md', 'rebuild instructions');
	await addPinned(
		closure.soundscaperLicense,
		'LICENSES/Soundscaper-AGPL-3.0.txt',
		'Soundscaper license',
	);
	for (const descriptor of closure.supportFiles) await addPinned(descriptor, descriptor.path, 'build support file');
	const archivesByName = new Map();
	const codecs = [];
	for (const codec of closure.codecs) {
		const manifestInput = await addPinned(codec.sourceManifest, codec.sourceManifest.path, `${codec.id} source manifest`);
		const buildInput = await addPinned(codec.buildScript, codec.buildScript.path, `${codec.id} build script`);
		const manifest = parseJson(manifestInput.bytes, codec.sourceManifest.path);
		validateSourceManifest(codec.id, manifest);
		const wasm = await validateRuntimeIdentity(repository, codec.id, manifest);
		const localDescriptors = localSourceDescriptors(codec.id, codec.sourceManifest.path, manifest);
		for (const descriptor of localDescriptors) {
			const input = await readPinnedRepositoryFile(repository, descriptor, `${codec.id} local source`);
			addFile(files, descriptor.path, input.bytes);
		}
		const codecArchives = codec.archives.map((admission) => (
			archiveDescriptor(codec.id, manifest, admission)
		));
		validateBuildImports(codec.id, buildInput.bytes, closure.supportFiles, codecArchives);
		validateArchiveClosure(codec.id, manifest, codecArchives);
		for (const archive of codecArchives) mergeArchive(archivesByName, archive, codec.id);
		codecs.push(Object.freeze({
			id: codec.id,
			wasm: Object.freeze(wasm),
			sourceManifestSha256: codec.sourceManifest.sha256,
			buildScriptSha256: codec.buildScript.sha256,
		}));
	}
	const configBytes = await readRegularRepositoryFile(repository, CONFIG_PATH, 'source closure configuration');
	if (JSON.stringify(parseJson(configBytes, CONFIG_PATH)) !== JSON.stringify(closure)) {
		throw new Error('Corresponding-source configuration differs from its configured admission.');
	}
	addFile(files, CONFIG_PATH, configBytes);
	const fileRows = [...files.entries()].map(([path, bytes]) => Object.freeze({ path, bytes }));
	const localBytes = fileRows.reduce((sum, file) => sum + file.bytes.byteLength, 0);
	if (localBytes > MAXIMUM_BUNDLE_BYTES) throw new Error('Corresponding-source local input budget is exceeded.');
	return Object.freeze({
		archiveTimestamp: closure.archiveTimestamp,
		archives: Object.freeze([...archivesByName.values()].sort(compareFileName)),
		codecs: Object.freeze(codecs),
		files: Object.freeze(fileRows.sort(comparePath)),
	});
}

/** Fetch one immutable upstream source input using the manifest-derived admission. */
export async function fetchVerifiedDesktopBundledCodecSource(descriptor, {
	fetchImpl = fetch,
} = {}) {
	validateFetchedDescriptor(descriptor);
	const response = await fetchImpl(descriptor.url, {
		redirect: 'follow', signal: AbortSignal.timeout(60_000),
	});
	if (!response?.ok) throw new Error(`Source request returned HTTP ${String(response?.status)}.`);
	validateFinalSourceUrl(descriptor, response.url);
	const declaredHeader = response.headers?.get?.('content-length');
	const declaredLength = Number(declaredHeader);
	if (declaredHeader !== null && declaredHeader !== undefined
		&& (!Number.isSafeInteger(declaredLength) || declaredLength !== descriptor.byteLength)) {
		throw new Error(`${descriptor.fileName} declared byte length does not match.`);
	}
	const reader = response.body?.getReader();
	if (!reader) throw new Error(`${descriptor.fileName} response has no body.`);
	const chunks = [];
	let byteLength = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		byteLength += value.byteLength;
		if (byteLength > descriptor.byteLength) {
			throw new Error(`${descriptor.fileName} exceeds its byte budget.`);
		}
		chunks.push(value);
	}
	if (byteLength !== descriptor.byteLength) throw new Error(`${descriptor.fileName} byte length does not match.`);
	const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), byteLength);
	if (sha256(bytes) !== descriptor.sha256) throw new Error(`${descriptor.fileName} digest does not match.`);
	return bytes;
}

/** Produce one deterministic ZIP and an internal per-file receipt. */
export function createDesktopBundledCodecCorrespondingSourceZip({
	applicationVersion,
	codecs,
	files,
	archiveTimestamp = closureAdmission.archiveTimestamp,
}) {
	const fileName = desktopBundledCodecCorrespondingSourceName(applicationVersion);
	if (!Array.isArray(codecs) || codecs.length === 0 || !Array.isArray(files) || files.length === 0) {
		throw new TypeError('Corresponding-source codecs and files are required.');
	}
	const orderedFiles = files.map(validateZipFile).sort(comparePath);
	assertUnique(orderedFiles.map(({ path }) => path), 'Corresponding-source ZIP path');
	const totalBytes = orderedFiles.reduce((sum, file) => sum + file.bytes.byteLength, 0);
	if (orderedFiles.length > 256 || totalBytes > MAXIMUM_BUNDLE_BYTES) {
		throw new Error('Corresponding-source ZIP exceeds its admission budget.');
	}
	const orderedCodecs = codecs.map(validateReceiptCodec).sort((a, b) => a.id.localeCompare(b.id));
	assertUnique(orderedCodecs.map(({ id }) => id), 'Corresponding-source codec');
	const receipt = {
		schemaVersion: 1,
		applicationVersion,
		purpose: 'preferred-corresponding-source-for-bundled-desktop-codec-wasm',
		buildEnvironment: {
			nodeVersion: closureAdmission.nodeVersion,
			emscriptenVersion: '3.1.64',
			dockerImage: 'emscripten/emsdk:3.1.64@sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc',
		},
		codecs: orderedCodecs,
		files: orderedFiles.map(({ path, bytes }) => ({
			path, byteLength: bytes.byteLength, sha256: sha256(bytes),
		})),
	};
	const rootName = fileName.slice(0, -'.zip'.length);
	const zipEntries = {};
	for (const { path, bytes } of orderedFiles) zipEntries[`${rootName}/${path}`] = bytes;
	zipEntries[`${rootName}/BUNDLE-MANIFEST.json`] = Buffer.from(`${JSON.stringify(receipt, null, '\t')}\n`);
	const timestamp = new Date(archiveTimestamp);
	if (Number.isNaN(timestamp.valueOf()) || timestamp.toISOString() !== archiveTimestamp) {
		throw new Error('Corresponding-source archive timestamp is invalid.');
	}
	return Object.freeze({
		fileName,
		bytes: Buffer.from(zipSync(zipEntries, { level: 9, mtime: timestamp })),
		receipt: Object.freeze(receipt),
	});
}

/** Validate, acquire, package, and atomically admit the release-side source ZIP. */
export async function stageDesktopBundledCodecCorrespondingSource({
	repositoryRoot,
	outputRoot,
	applicationVersion,
	fetchSource = fetchVerifiedDesktopBundledCodecSource,
}) {
	if (typeof outputRoot !== 'string' || !isAbsolute(outputRoot)) {
		throw new TypeError('Corresponding-source output root is invalid.');
	}
	const validated = await validateDesktopBundledCodecSourceCheckout({ repositoryRoot });
	const upstream = await Promise.all(validated.archives.map(async (descriptor) => ({
		path: `upstream/${descriptor.fileName}`,
		bytes: await fetchSource(descriptor),
	})));
	for (const [index, input] of upstream.entries()) {
		const descriptor = validated.archives[index];
		if (!(input.bytes instanceof Uint8Array)
			|| input.bytes.byteLength !== descriptor.byteLength
			|| sha256(input.bytes) !== descriptor.sha256) {
			throw new Error(`Fetched source does not match its admitted descriptor: ${descriptor.fileName}`);
		}
	}
	const archive = createDesktopBundledCodecCorrespondingSourceZip({
		applicationVersion,
		archiveTimestamp: validated.archiveTimestamp,
		codecs: validated.codecs,
		files: [...validated.files, ...upstream],
	});
	await writeFile(resolve(outputRoot, archive.fileName), archive.bytes, { flag: 'wx', mode: 0o644 });
	return Object.freeze({
		fileName: archive.fileName,
		byteLength: archive.bytes.byteLength,
		sha256: sha256(archive.bytes),
	});
}

export function desktopBundledCodecCorrespondingSourceName(applicationVersion) {
	if (typeof applicationVersion !== 'string'
		|| !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,127}$/u.test(applicationVersion)) {
		throw new TypeError('Corresponding-source application version is invalid.');
	}
	return `Soundscaper-${applicationVersion}-bundled-codecs-corresponding-source.zip`;
}

function validateClosureShape(closure) {
	assertExactKeys(closure, [
		'archiveTimestamp', 'codecs', 'instructions', 'nodeVersion', 'schemaVersion',
		'soundscaperLicense', 'supportFiles',
	], 'corresponding-source closure');
	if (closure.schemaVersion !== 1 || closure.nodeVersion !== '26.5.0'
		|| closure.archiveTimestamp !== '1980-01-01T00:00:00.000Z') {
		throw new Error('Corresponding-source closure schema or timestamp is not admitted.');
	}
	validatePinnedDescriptor(closure.instructions, 'rebuild instructions');
	validatePinnedDescriptor(closure.soundscaperLicense, 'Soundscaper license');
	if (closure.instructions.path !== 'docs/desktop-bundled-codec-corresponding-source.md'
		|| closure.soundscaperLicense.path !== 'LICENSE') {
		throw new Error('Corresponding-source document authority is invalid.');
	}
	if (!Array.isArray(closure.supportFiles)
		|| JSON.stringify(closure.supportFiles.map(({ path }) => path).sort())
			!== JSON.stringify(EXPECTED_SUPPORT_FILES)) {
		throw new Error('Corresponding-source build support closure is incomplete.');
	}
	for (const descriptor of closure.supportFiles) validatePinnedDescriptor(descriptor, 'build support file');
	if (!Array.isArray(closure.codecs)
		|| JSON.stringify(closure.codecs.map(({ id }) => id)) !== JSON.stringify(EXPECTED_CODEC_IDS)) {
		throw new Error('Corresponding-source codec closure is incomplete or unordered.');
	}
	for (const codec of closure.codecs) validateCodecAdmission(codec);
}

function validateCodecAdmission(codec) {
	assertExactKeys(codec, ['archives', 'buildScript', 'id', 'sourceManifest'], 'codec admission');
	if (!EXPECTED_CODEC_IDS.includes(codec.id)) throw new Error('Corresponding-source codec ID is invalid.');
	validatePinnedDescriptor(codec.sourceManifest, `${codec.id} source manifest`);
	validatePinnedDescriptor(codec.buildScript, `${codec.id} build script`);
	if (codec.sourceManifest.path !== `src/common/editor/${codec.id}/source-manifest.json`
		|| codec.buildScript.path !== `scripts/build-${codec.id}-wasm.mjs`) {
		throw new Error(`${codec.id} source/build authority is invalid.`);
	}
	if (!Array.isArray(codec.archives)) throw new Error(`${codec.id} archive closure is invalid.`);
	const actualKeys = codec.archives.map(({ manifestKey, kind, fileName }) => (
		`${manifestKey}:${kind}:${fileName}`
	)).sort();
	if (JSON.stringify(actualKeys) !== JSON.stringify(EXPECTED_ARCHIVE_KEYS[codec.id])) {
		throw new Error(`${codec.id} archive closure is incomplete.`);
	}
	for (const archive of codec.archives) {
		assertExactKeys(archive, [
			'byteLength', 'fileName', 'kind', 'manifestKey',
		], `${codec.id} archive admission`);
		if (!Object.hasOwn(ARCHIVE_FIELDS, archive.kind)) throw new Error(`${codec.id} archive kind is invalid.`);
		assertFileName(archive.fileName);
		if (!Number.isSafeInteger(archive.byteLength) || archive.byteLength <= 0
			|| archive.byteLength > 32 * 1024 * 1024) {
			throw new Error(`${codec.id} archive byte budget is invalid.`);
		}
	}
}

function validateSourceManifest(codecId, manifest) {
	if (!plainRecord(manifest) || manifest.schemaVersion !== 1 || !plainRecord(manifest.toolchain)
		|| manifest.toolchain.emscriptenVersion !== '3.1.64'
		|| manifest.toolchain.dockerImage !== 'emscripten/emsdk:3.1.64'
		|| manifest.toolchain.dockerImageDigest
			!== 'sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc'
		|| !/^[1-9][0-9]*$/u.test(manifest.toolchain.sourceDateEpoch)
		|| !plainRecord(manifest.wasm)) {
		throw new Error(`${codecId} source manifest lacks the exact reviewed toolchain or WASM identity.`);
	}
}

async function validateRuntimeIdentity(repository, codecId, manifest) {
	const runtime = RUNTIME_BY_CODEC[codecId];
	if (!runtime || manifest.wasm.path !== `${codecId}.wasm`
		|| runtime.file !== `src/common/editor/${codecId}/${manifest.wasm.path}`
		|| runtime.sha256 !== manifest.wasm.sha256
		|| !Number.isSafeInteger(runtime.byteLength) || runtime.byteLength <= 0
		|| runtime.byteLength > manifest.wasm.maximumBytes) {
		throw new Error(`${codecId} source manifest does not identify the exact shipped WASM.`);
	}
	const bytes = await readRegularRepositoryFile(repository, runtime.file, `${codecId} shipped WASM`);
	if (bytes.byteLength !== runtime.byteLength || sha256(bytes) !== runtime.sha256) {
		throw new Error(`${codecId} shipped WASM does not match its runtime identity.`);
	}
	return { path: runtime.file, byteLength: runtime.byteLength, sha256: runtime.sha256 };
}

function localSourceDescriptors(codecId, manifestPath, manifest) {
	const codecRoot = dirname(manifestPath);
	const rows = [];
	for (const item of manifest.localFiles ?? []) rows.push(localDescriptor(codecRoot, item));
	for (const item of manifest.licenseFiles ?? []) rows.push(localDescriptor(codecRoot, item));
	for (const item of manifest.localExtensions ?? []) rows.push(localDescriptor(codecRoot, item));
	for (const item of manifest.sourceFiles ?? []) rows.push(localDescriptor(`${codecRoot}/native`, item));
	if (codecId === 'wavpack') {
		if (manifest.sourceFiles?.length !== 20 || manifest.localExtensions?.length !== 7
			|| manifest.licenseFiles?.length !== 5) {
			throw new Error('WavPack corresponding-source snapshot is incomplete.');
		}
	} else if (!Array.isArray(manifest.localFiles) || manifest.localFiles.length < 3) {
		throw new Error(`${codecId} local corresponding-source closure is incomplete.`);
	}
	assertUnique(rows.map(({ path }) => path), `${codecId} local source path`);
	return rows;
}

function localDescriptor(base, item) {
	if (!plainRecord(item) || typeof item.path !== 'string' || !/^[a-f\d]{64}$/u.test(item.sha256)) {
		throw new Error('Local corresponding-source descriptor is invalid.');
	}
	if (item.path.startsWith('/') || item.path.includes('\\') || item.path.includes('\0')) {
		throw new Error('Local corresponding-source path is invalid.');
	}
	const path = normalizeRelative(resolve('/', base, item.path).slice(1));
	if (!path.startsWith('src/common/editor/')) {
		throw new Error('Local corresponding-source path leaves the codec source tree.');
	}
	return { path, sha256: item.sha256 };
}

function archiveDescriptor(codecId, manifest, admission) {
	const source = manifest[admission.manifestKey];
	const fields = ARCHIVE_FIELDS[admission.kind];
	if (!plainRecord(source)) throw new Error(`${codecId} archive source manifest key is invalid.`);
	const descriptor = {
		byteLength: admission.byteLength,
		fileName: admission.fileName,
		kind: admission.kind,
		url: source[fields.url],
		redirectUrl: source[fields.redirect] ?? null,
		sha256: source[fields.sha256],
	};
	validateFetchedDescriptor(descriptor);
	return descriptor;
}

function validateArchiveClosure(codecId, manifest, archives) {
	const coveredFields = new Set(archives.map(({ kind }) => ARCHIVE_FIELDS[kind].url));
	const sourceKeys = new Set(EXPECTED_ARCHIVE_KEYS[codecId].map((key) => key.split(':')[0]));
	for (const key of sourceKeys) {
		const source = manifest[key];
		for (const field of ['archiveUrl', 'signatureUrl', 'signingKeyUrl']) {
			if (typeof source?.[field] === 'string' && !coveredFields.has(field)) {
				throw new Error(`${codecId} source manifest acquisition is omitted: ${field}`);
			}
		}
	}
}

function mergeArchive(archives, descriptor, codecId) {
	const existing = archives.get(descriptor.fileName);
	if (!existing) {
		archives.set(descriptor.fileName, Object.freeze({ ...descriptor, codecs: Object.freeze([codecId]) }));
		return;
	}
	const comparable = ({ codecs: _codecs, ...value }) => value;
	if (JSON.stringify(comparable(existing)) !== JSON.stringify(descriptor)) {
		throw new Error(`Shared source archive admission disagrees: ${descriptor.fileName}`);
	}
	archives.set(descriptor.fileName, Object.freeze({
		...descriptor, codecs: Object.freeze([...existing.codecs, codecId].sort()),
	}));
}

function validateBuildImports(codecId, bytes, supportFiles, archives) {
	const source = String(bytes);
	const imports = [...source.matchAll(/from '\.\/lib\/([^']+)'/gu)]
		.map((match) => `scripts/lib/${match[1]}`).sort();
	const admitted = new Set(supportFiles.map(({ path }) => path));
	if (imports.some((path) => !admitted.has(path))) {
		throw new Error(`${codecId} build script has an unbundled local dependency.`);
	}
	const expectedImports = codecId === 'wavpack'
		? ['scripts/lib/wavpack-wasm-toolchain.mjs']
		: ['scripts/lib/bundled-codec-source-input.mjs'];
	if (JSON.stringify(imports) !== JSON.stringify(expectedImports)) {
		throw new Error(`${codecId} build script dependency closure is invalid.`);
	}
	if (archives.some(({ fileName }) => !source.includes(`'${fileName}'`))) {
		throw new Error(`${codecId} build script does not select its bundled source filename.`);
	}
}

async function validateRepositoryRoot(value) {
	if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) {
		throw new TypeError('Corresponding-source repository root is invalid.');
	}
	return realpath(resolve(value));
}

async function readPinnedRepositoryFile(repository, descriptor, label) {
	validatePinnedDescriptor(descriptor, label);
	const bytes = await readRegularRepositoryFile(repository, descriptor.path, label);
	if (sha256(bytes) !== descriptor.sha256) {
		throw new Error(`${label} does not match reviewed evidence: ${descriptor.path}`);
	}
	return { bytes };
}

async function readRegularRepositoryFile(repository, path, label) {
	const normalized = normalizeRelative(path);
	const source = resolve(repository, normalized);
	if (!source.startsWith(`${repository}${sep}`)) throw new Error(`${label} leaves the repository.`);
	const metadata = await lstat(source);
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0
		|| metadata.size > MAXIMUM_LOCAL_FILE_BYTES) {
		throw new Error(`${label} is not an admitted regular file: ${normalized}`);
	}
	const actual = await realpath(source);
	if (!actual.startsWith(`${repository}${sep}`)) throw new Error(`${label} leaves the real repository.`);
	return readFile(source);
}

function validatePinnedDescriptor(descriptor, label) {
	assertExactKeys(descriptor, ['path', 'sha256'], label);
	normalizeRelative(descriptor.path);
	if (!/^[a-f\d]{64}$/u.test(descriptor.sha256)) throw new Error(`${label} digest is invalid.`);
}

function validateFetchedDescriptor(descriptor) {
	if (!plainRecord(descriptor)) throw new TypeError('Source descriptor is invalid.');
	assertFileName(descriptor.fileName);
	const url = secureUrl(descriptor.url, `${descriptor.fileName} URL`);
	if (descriptor.redirectUrl !== null && descriptor.redirectUrl !== undefined) {
		secureUrl(descriptor.redirectUrl, `${descriptor.fileName} redirect URL`);
	}
	if (!/^[a-f\d]{64}$/u.test(descriptor.sha256)
		|| !Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength <= 0
		|| descriptor.byteLength > 32 * 1024 * 1024
		|| url.username || url.password) {
		throw new Error(`${descriptor.fileName} source descriptor is invalid.`);
	}
}

function validateFinalSourceUrl(descriptor, value) {
	const finalUrl = secureUrl(value, `${descriptor.fileName} final URL`);
	if (descriptor.redirectUrl) {
		if (finalUrl.href !== new URL(descriptor.redirectUrl).href) {
			throw new Error(`${descriptor.fileName} final URL does not match its admission.`);
		}
		return;
	}
	const requested = new URL(descriptor.url);
	if (requested.hostname === 'downloads.sourceforge.net') {
		if (!(finalUrl.hostname === 'downloads.sourceforge.net' || finalUrl.hostname.endsWith('.dl.sourceforge.net'))
			|| finalUrl.pathname !== requested.pathname) {
			throw new Error(`${descriptor.fileName} left its admitted SourceForge release path.`);
		}
	} else if (finalUrl.href !== requested.href) {
		throw new Error(`${descriptor.fileName} final URL does not match its request.`);
	}
}

function validateZipFile(value) {
	if (!plainRecord(value) || !(value.bytes instanceof Uint8Array)) {
		throw new TypeError('Corresponding-source ZIP file is invalid.');
	}
	const path = normalizeRelative(value.path);
	if (/\.wasm$/iu.test(path) || value.bytes.byteLength === 0
		|| value.bytes.byteLength > 32 * 1024 * 1024) {
		throw new Error(`Corresponding-source ZIP file is not admitted: ${path}`);
	}
	return { path, bytes: value.bytes };
}

function validateReceiptCodec(value) {
	assertExactKeys(value, [
		'buildScriptSha256', 'id', 'sourceManifestSha256', 'wasm',
	], 'corresponding-source receipt codec');
	if (!/^[a-z0-9][a-z0-9-]*$/u.test(value.id)
		|| !/^[a-f\d]{64}$/u.test(value.buildScriptSha256)
		|| !/^[a-f\d]{64}$/u.test(value.sourceManifestSha256) || !plainRecord(value.wasm)
		|| typeof value.wasm.path !== 'string' || !Number.isSafeInteger(value.wasm.byteLength)
		|| value.wasm.byteLength <= 0 || !/^[a-f\d]{64}$/u.test(value.wasm.sha256)) {
		throw new Error('Corresponding-source receipt codec identity is invalid.');
	}
	return { ...value, wasm: { ...value.wasm } };
}

function normalizeRelative(value) {
	if (typeof value !== 'string' || value.length === 0 || value.includes('\0')
		|| value.includes('\\') || value.startsWith('/') || value.endsWith('/')
		|| value.split('/').some((part) => part === '' || part === '.' || part === '..')) {
		throw new Error('Corresponding-source path is invalid.');
	}
	return value;
}

function addFile(files, path, bytes) {
	const normalized = normalizeRelative(path);
	const existing = files.get(normalized);
	if (existing && !Buffer.from(existing).equals(bytes)) {
		throw new Error(`Corresponding-source path has conflicting bytes: ${normalized}`);
	}
	files.set(normalized, bytes);
}

function secureUrl(value, label) {
	let url;
	try { url = new URL(value); }
	catch { throw new Error(`${label} is invalid.`); }
	if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
		throw new Error(`${label} is not an admitted HTTPS URL.`);
	}
	return url;
}

function assertFileName(value) {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(value)
		|| value === '.' || value === '..') throw new Error('Source archive filename is invalid.');
}

function assertExactKeys(value, expected, label) {
	if (!plainRecord(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
		throw new Error(`${label} has unknown or missing fields.`);
	}
}

function assertUnique(values, label) {
	if (new Set(values.map((value) => value.toLowerCase())).size !== values.length) {
		throw new Error(`${label} is duplicate or case-colliding.`);
	}
}

function parseJson(bytes, label) {
	try { return JSON.parse(String(bytes)); }
	catch (error) { throw new Error(`${label} is invalid JSON: ${error.message}`, { cause: error }); }
}

function plainRecord(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function comparePath(a, b) {
	return a.path.localeCompare(b.path);
}

function compareFileName(a, b) {
	return a.fileName.localeCompare(b.fileName);
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
