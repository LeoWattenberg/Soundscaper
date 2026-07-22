#!/usr/bin/env node

import { createHash, createHmac } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
	AUDACITY_QT_MAPPING,
	AUDACITY_QT_MAPPING_VERSION,
} from '../src/common/i18n/audacity-qt-mapping.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { COMMITTED_LOCALE_TAGS, LOCALE_BY_TAG } from '../src/common/i18n/locales.js';

const AUDACITY = Object.freeze({
	repository: 'audacity/audacity',
	repositoryId: 32921736,
	workflowPath: '.github/workflows/translate_tx_pull_to_s3.yml',
	branch: 'master',
});
const ROOT_PREFIX = 'runtime/translations/audacity/4';
const PUBLIC_ROOT = `https://translations.soundscaper.org/${ROOT_PREFIX}`;
const API_VERSION = '2026-03-10';
const MAX_API_BYTES = 4 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_POINTER_BYTES = 512 * 1024;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_AUDIT_BYTES = 8 * 1024 * 1024;
const MAX_LICENSE_BYTES = 2 * 1024 * 1024;
const MAX_PACK_BYTES = 2 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RELEASE_ID_PATTERN = /^[1-9][0-9]*$/;
const ARTIFACT_NAME_PATTERN = /^Audacity_locale_[0-9]+$/;
const ELLIPSIS_PATTERN = /\u2026|\.{3}/u;
const TRANSLATION_ORIGIN = 'https://soundscaper.org';
const MODIFICATION_NOTICE = 'Soundscaper converts reviewed Audacity Qt TS messages to per-locale JSON packs, excludes unsafe or inapplicable entries, adapts reviewed placeholders and mnemonics, and removes ellipsis punctuation.';
const MAPPING_BY_KEY = new Map(AUDACITY_QT_MAPPING.map((entry) => [entry.key, entry]));

function fail(message) {
	throw new Error(message);
}

function assert(condition, message) {
	if (!condition) fail(message);
}

function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& Object.getPrototypeOf(value) === Object.prototype;
}

function parseArgs(argv) {
	const [command, ...rest] = argv;
	const options = {};
	for (let index = 0; index < rest.length; index += 2) {
		const flag = rest[index];
		assert(flag?.startsWith('--'), `Unexpected argument: ${flag ?? '<missing>'}`);
		const value = rest[index + 1];
		assert(value !== undefined && !value.startsWith('--'), `Missing value for ${flag}`);
		const key = flag.slice(2);
		assert(!(key in options), `Duplicate option: ${flag}`);
		options[key] = value;
	}
	return { command, options };
}

function requiredOption(options, name) {
	const value = options[name];
	assert(typeof value === 'string' && value.length > 0, `Missing --${name}`);
	return value;
}

function rejectUnknownOptions(options, allowed) {
	for (const name of Object.keys(options)) {
		assert(allowed.includes(name), `Unknown option: --${name}`);
	}
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function hmac(key, value, encoding) {
	return createHmac('sha256', key).update(value).digest(encoding);
}

function canonicalJson(value) {
	const serialize = (entry) => {
		if (entry === null || typeof entry !== 'object') return JSON.stringify(entry);
		if (Array.isArray(entry)) return `[${entry.map(serialize).join(',')}]`;
		return `{${Object.keys(entry).sort((left, right) => left.localeCompare(right))
			.map((key) => `${JSON.stringify(key)}:${serialize(entry[key])}`).join(',')}}`;
	};
	return `${serialize(value)}\n`;
}

function parseJson(bytes, label) {
	try {
		return JSON.parse(Buffer.from(bytes).toString('utf8'));
	} catch (error) {
		fail(`${label} is not valid JSON: ${error.message}`);
	}
}

function safeRelativePath(value, label = 'path') {
	assert(typeof value === 'string' && value.length > 0, `${label} must be a non-empty string`);
	assert(!value.startsWith('/') && !value.startsWith('\\'), `${label} must be relative`);
	assert(!value.includes('\\') && !value.includes('\0'), `${label} contains unsafe characters`);
	const segments = value.split('/');
	assert(segments.every((segment) => segment && segment !== '.' && segment !== '..'), `${label} is not normalized`);
	return value;
}

function canonicalLocale(value, label = 'locale') {
	assert(typeof value === 'string' && value.length <= 64, `${label} must be a BCP-47 string`);
	let canonical;
	try {
		[canonical] = Intl.getCanonicalLocales(value);
	} catch {
		fail(`${label} is not a valid BCP-47 locale: ${value}`);
	}
	assert(canonical === value, `${label} must use canonical BCP-47 spelling: ${value}`);
	return value;
}

async function ensureEmptyDirectory(path) {
	await mkdir(path, { recursive: true });
	const entries = await readdir(path);
	assert(entries.length === 0, `Output directory is not empty: ${path}`);
}

async function writeAtomic(path, bytes) {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
	await writeFile(temporary, bytes, { flag: 'wx' });
	try {
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}

async function readLimitedFile(path, maximum, label) {
	const info = await stat(path);
	assert(info.isFile(), `${label} is not a regular file: ${path}`);
	assert(info.size <= maximum, `${label} exceeds ${maximum} bytes: ${path}`);
	return readFile(path);
}

async function fetchLimited(url, {
	maximum,
	label,
	headers = {},
	acceptedStatuses = [200],
	timeout = 30_000,
} = {}) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout);
	try {
		let response;
		try {
			response = await fetch(url, {
				headers,
				redirect: 'follow',
				signal: controller.signal,
			});
		} catch (error) {
			fail(`${label} request failed: ${error.message}`);
		}
		assert(acceptedStatuses.includes(response.status), `${label} returned HTTP ${response.status}`);
		const declaredLength = Number(response.headers.get('content-length'));
		if (Number.isFinite(declaredLength)) {
			assert(declaredLength <= maximum, `${label} declares more than ${maximum} bytes`);
		}
		const chunks = [];
		let byteLength = 0;
		if (response.body) {
			for await (const chunk of response.body) {
				byteLength += chunk.byteLength;
				assert(byteLength <= maximum, `${label} exceeds ${maximum} bytes`);
				chunks.push(Buffer.from(chunk));
			}
		}
		return { response, bytes: Buffer.concat(chunks, byteLength) };
	} finally {
		clearTimeout(timer);
	}
}

async function fetchJson(url, options) {
	const result = await fetchLimited(url, options);
	return { ...result, json: parseJson(result.bytes, options.label) };
}

function githubHeaders() {
	const headers = {
		Accept: 'application/vnd.github+json',
		'User-Agent': 'Soundscaper-translation-sync',
		'X-GitHub-Api-Version': API_VERSION,
	};
	const token = process.env.GITHUB_TOKEN;
	if (token) {
		assert(!/[\r\n]/u.test(token), 'GITHUB_TOKEN contains unsafe characters');
		headers.Authorization = `Bearer ${token}`;
	}
	return headers;
}

export function validateAudacityWorkflowRun(run, expectedRunId) {
	assert(isPlainObject(run), 'Audacity workflow run response is invalid');
	assert(run.repository?.id === AUDACITY.repositoryId && run.repository?.full_name === AUDACITY.repository,
		'Workflow run repository identity is unexpected');
	assert(run.path === AUDACITY.workflowPath, `Workflow run path is unexpected: ${run.path}`);
	assert(run.head_branch === AUDACITY.branch && run.event === 'schedule', 'Workflow run branch or event is unexpected');
	assert(run.status === 'completed' && run.conclusion === 'success', 'Workflow run is not completed successfully');
	assert(Number.isSafeInteger(run.id) && run.id > 0, 'Workflow run ID is invalid');
	if (expectedRunId !== undefined) assert(run.id === expectedRunId, 'Workflow run ID does not match the staged release');
	assert(typeof run.head_sha === 'string' && /^[a-f0-9]{40}$/.test(run.head_sha), 'Workflow head SHA is invalid');
	assert(typeof run.html_url === 'string' && run.html_url.startsWith('https://github.com/audacity/audacity/actions/runs/'),
		'Workflow run URL is invalid');
	return run;
}

export function validateAudacityArtifactResult(artifactResult, run, expected = {}) {
	assert(isPlainObject(artifactResult) && artifactResult.total_count === 1
		&& Array.isArray(artifactResult.artifacts) && artifactResult.artifacts.length === 1,
		'Expected exactly one artifact from the Audacity translation run');
	const artifact = artifactResult.artifacts[0];
	assert(Number.isSafeInteger(artifact.id) && artifact.id > 0, 'Artifact ID is invalid');
	if (expected.artifactId !== undefined) assert(artifact.id === expected.artifactId, 'Artifact ID does not match the staged release');
	assert(ARTIFACT_NAME_PATTERN.test(artifact.name), `Artifact name is unexpected: ${artifact.name}`);
	if (expected.archiveName !== undefined) assert(`${artifact.name}.zip` === expected.archiveName,
		'Artifact name does not match the staged source archive');
	assert(artifact.expired === false, 'Audacity translation artifact is expired');
	assert(Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0
		&& artifact.size_in_bytes <= MAX_ARCHIVE_BYTES, 'Artifact size is invalid or exceeds the compressed limit');
	if (expected.byteLength !== undefined) assert(artifact.size_in_bytes === expected.byteLength,
		'Artifact byte length does not match the staged source archive');
	assert(typeof artifact.digest === 'string' && artifact.digest.startsWith('sha256:'), 'Artifact has no official SHA-256 digest');
	const expectedSha256 = artifact.digest.slice('sha256:'.length).toLowerCase();
	assert(SHA256_PATTERN.test(expectedSha256), 'Artifact SHA-256 digest is malformed');
	if (expected.sha256 !== undefined) assert(expectedSha256 === expected.sha256,
		'Artifact SHA-256 does not match the staged source archive');
	const artifactCreatedAt = new Date(artifact.created_at);
	assert(!Number.isNaN(artifactCreatedAt.getTime()), 'Artifact creation timestamp is invalid');
	if (artifact.workflow_run) {
		assert(artifact.workflow_run.id === run.id && artifact.workflow_run.repository_id === AUDACITY.repositoryId,
			'Artifact workflow identity does not match the selected run');
		assert(artifact.workflow_run.head_sha === run.head_sha, 'Artifact head SHA does not match the selected run');
	}
	return { artifact, artifactCreatedAt, expectedSha256 };
}

async function discover(options) {
	rejectUnknownOptions(options, ['output', 'max-age-hours', 'github-env', 'github-output']);
	const output = resolve(requiredOption(options, 'output'));
	const maxAgeHours = Number(options['max-age-hours'] ?? 24);
	assert(Number.isFinite(maxAgeHours) && maxAgeHours >= 1 && maxAgeHours <= 168, '--max-age-hours must be between 1 and 168');
	await ensureEmptyDirectory(output);

	const runsUrl = new URL(`https://api.github.com/repos/${AUDACITY.repository}/actions/workflows/translate_tx_pull_to_s3.yml/runs`);
	runsUrl.searchParams.set('branch', AUDACITY.branch);
	runsUrl.searchParams.set('event', 'schedule');
	runsUrl.searchParams.set('status', 'success');
	runsUrl.searchParams.set('per_page', '10');
	const { json: runs } = await fetchJson(runsUrl, {
		maximum: MAX_API_BYTES,
		label: 'Audacity workflow runs',
		headers: githubHeaders(),
	});
	assert(isPlainObject(runs) && Array.isArray(runs.workflow_runs) && runs.workflow_runs.length > 0,
		'GitHub returned no successful scheduled Audacity translation run');
	const run = validateAudacityWorkflowRun(runs.workflow_runs[0]);
	const updatedAt = Date.parse(run.updated_at);
	const age = Date.now() - updatedAt;
	assert(Number.isFinite(updatedAt) && age >= -5 * 60_000 && age <= maxAgeHours * 3_600_000,
		`Latest successful scheduled translation run is stale: ${run.updated_at}`);

	const artifactsUrl = `https://api.github.com/repos/${AUDACITY.repository}/actions/runs/${run.id}/artifacts?per_page=100`;
	const { json: artifactResult } = await fetchJson(artifactsUrl, {
		maximum: MAX_API_BYTES,
		label: 'Audacity workflow artifacts',
		headers: githubHeaders(),
	});
	const { artifact, artifactCreatedAt, expectedSha256 } = validateAudacityArtifactResult(artifactResult, run);
	const convertedAt = new Date().toISOString();

	const nightlyUrl = `https://nightly.link/${AUDACITY.repository}/actions/runs/${run.id}/${artifact.name}.zip`;
	const { bytes: archive } = await fetchLimited(nightlyUrl, {
		maximum: MAX_ARCHIVE_BYTES,
		label: 'nightly.link Audacity translation artifact',
		headers: { 'User-Agent': 'Soundscaper-translation-sync' },
		timeout: 120_000,
	});
	assert(archive.byteLength === artifact.size_in_bytes,
		`Artifact byte length mismatch: expected ${artifact.size_in_bytes}, received ${archive.byteLength}`);
	assert(sha256(archive) === expectedSha256, 'Artifact SHA-256 does not match GitHub metadata');
	const archiveName = `${artifact.name}.zip`;
	await writeAtomic(join(output, archiveName), archive);

	const licenseUrl = `https://raw.githubusercontent.com/${AUDACITY.repository}/${run.head_sha}/LICENSE.txt`;
	const { bytes: license } = await fetchLimited(licenseUrl, {
		maximum: MAX_LICENSE_BYTES,
		label: 'Audacity license',
		headers: { 'User-Agent': 'Soundscaper-translation-sync' },
	});
	const licenseText = license.toString('utf8');
	assert(licenseText.includes('GNU GENERAL PUBLIC LICENSE') && licenseText.includes('Audacity'),
		'Audacity license response does not contain the expected notice');
	await writeAtomic(join(output, 'LICENSE.txt'), license);

	const metadata = {
		schemaVersion: 1,
		discoveredAt: new Date().toISOString(),
		repository: AUDACITY.repository,
		workflowPath: AUDACITY.workflowPath,
		run: {
			id: run.id,
			htmlUrl: run.html_url,
			headSha: run.head_sha,
			createdAt: run.created_at,
			updatedAt: run.updated_at,
		},
		artifact: {
			id: artifact.id,
			name: artifact.name,
			archiveName,
			createdAt: artifactCreatedAt.toISOString(),
			sizeInBytes: archive.byteLength,
			sha256: expectedSha256,
			nightlyUrl,
		},
		license: {
			path: 'LICENSE.txt',
			byteLength: license.byteLength,
			sha256: sha256(license),
			sourceUrl: licenseUrl,
		},
	};
	await writeAtomic(join(output, 'discovery.json'), canonicalJson(metadata));
	if (options['github-env']) {
		const values = {
			AUDACITY_TRANSLATION_ARTIFACT_ID: String(artifact.id),
			AUDACITY_TRANSLATION_ARCHIVE_NAME: archiveName,
			AUDACITY_TRANSLATION_ARCHIVE_SHA256: expectedSha256,
			AUDACITY_TRANSLATION_ARCHIVE_BYTE_LENGTH: String(archive.byteLength),
			AUDACITY_TRANSLATION_CONVERTED_AT: convertedAt,
			AUDACITY_TRANSLATION_RUN_ID: String(run.id),
			AUDACITY_TRANSLATION_HEAD_SHA: run.head_sha,
			AUDACITY_TRANSLATION_WORKFLOW_URL: run.html_url,
		};
		assert(Object.values(values).every((value) => !value.includes('\n') && !value.includes('\r')),
			'Discovery metadata cannot be written safely to GITHUB_ENV');
		await appendFile(resolve(options['github-env']), `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`);
	}
	if (options['github-output']) {
		await appendFile(resolve(options['github-output']), `stage_artifact=audacity-translation-release-${artifact.id}\n`);
	}
	console.log(`Verified Audacity artifact ${artifact.id} (${archive.byteLength} bytes, sha256:${expectedSha256})`);
}

function validateDescriptor(value, label, maximum) {
	assert(isPlainObject(value), `${label} must be an object`);
	const path = safeRelativePath(value.path, `${label}.path`);
	assert(SHA256_PATTERN.test(value.sha256), `${label}.sha256 is invalid`);
	assert(Number.isSafeInteger(value.byteLength) && value.byteLength > 0 && value.byteLength <= maximum,
		`${label}.byteLength is invalid`);
	return { path, sha256: value.sha256, byteLength: value.byteLength };
}

function validatePackShape(pack, locale, label, descriptor, { canonicalCatalog = false } = {}) {
	assert(isPlainObject(pack) && pack.schemaVersion === 1 && pack.locale === locale && isPlainObject(pack.messages),
		`${label} has an invalid schema`);
	assert(Object.entries(pack.messages).every(([key, value]) => /^[A-Za-z][A-Za-z0-9_.-]*$/.test(key)
		&& typeof value === 'string' && value.trim() && !ELLIPSIS_PATTERN.test(value)),
		`${label} has an invalid key, empty value, or ellipsis punctuation`);
	const keys = Object.keys(pack.messages);
	if (descriptor) assert(keys.length === descriptor.mapped, `${label} message count disagrees with mapped`);
	for (const key of keys) {
		const mapping = MAPPING_BY_KEY.get(key);
		const canonicalSource = ENGLISH_COPY[key];
		if (canonicalCatalog) assert(typeof canonicalSource === 'string', `${label} contains a key absent from the current canonical catalog: ${key}`);
		else assert(mapping, `${label} contains a key absent from the current reviewed mapping: ${key}`);
		const expected = canonicalCatalog
			? namedPlaceholders(canonicalSource)
			: Object.values(mapping.placeholders || {}).sort();
		const actual = [...pack.messages[key].matchAll(/\{[A-Za-z][A-Za-z0-9_]*\}/g)].map(([value]) => value).sort();
		assert(actual.join('\0') === expected.join('\0'), `${label} has incompatible named placeholders for ${key}`);
	}
	return pack;
}

function namedPlaceholders(value) {
	return [...String(value).matchAll(/\{[A-Za-z][A-Za-z0-9_]*\}/g)].map(([placeholder]) => placeholder).sort();
}

export function validateHistoricalPack(pack, locale, descriptor) {
	return validatePackShape(pack, locale, `historical ${locale} pack`, descriptor, { canonicalCatalog: true });
}

function validateAudacityLicense(bytes, label) {
	let text;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		fail(`${label} is not valid UTF-8`);
	}
	assert(text.includes('Audacity is released under the GNU General Public License version 3 (GPLv3).'),
		`${label} does not contain Audacity's GPLv3 notice`);
}

function normalizedPointerLocale(descriptor) {
	return {
		name: descriptor.name,
		direction: descriptor.direction,
		eligible: descriptor.eligible,
		coverage: descriptor.coverage,
		mapped: descriptor.mapped,
		total: descriptor.total,
		path: descriptor.path,
		sha256: descriptor.sha256,
		byteLength: descriptor.byteLength,
	};
}

function normalizedReleaseIdentity(mappingVersion, mappingSha256, locales, pendingLocales) {
	const identity = {
		mappingVersion,
		mappingSha256,
		locales: Object.fromEntries(Object.entries(locales).map(([locale, descriptor]) => [
			locale,
			normalizedPointerLocale(descriptor),
		])),
	};
	if (pendingLocales !== undefined) identity.pendingLocales = pendingLocales;
	return sha256(Buffer.from(canonicalJson(identity)));
}

function legacyReleaseIdentity(locales) {
	return sha256(Buffer.from(canonicalJson(Object.fromEntries(
		Object.entries(locales).map(([locale, descriptor]) => [locale, descriptor.sha256]),
	))));
}

function validateManifestShape(manifest, expectedReleaseId) {
	assert(isPlainObject(manifest) && manifest.schemaVersion === 1, 'Release manifest schemaVersion must be 1');
	const releaseId = String(manifest.artifactId ?? '');
	assert(RELEASE_ID_PATTERN.test(releaseId), 'Release manifest artifactId is invalid');
	if (expectedReleaseId !== undefined) assert(releaseId === String(expectedReleaseId), 'Release manifest artifactId does not match');
	assert(SHA256_PATTERN.test(manifest.normalizedContentSha256), 'Release normalizedContentSha256 is invalid');
	assert(manifest.eligibilityThreshold === 0.79, 'Release eligibility threshold must be 0.79');
	assert(isPlainObject(manifest.source), 'Release source metadata is missing');
	assert(manifest.source.repository === AUDACITY.repository, 'Release source repository is unexpected');
	assert(Number.isSafeInteger(manifest.source.runId) && manifest.source.runId > 0, 'Release source runId is invalid');
	assert(typeof manifest.source.headSha === 'string' && /^[a-f0-9]{40}$/.test(manifest.source.headSha), 'Release source headSha is invalid');
	const expectedProvenance = {
		licenseSpdx: 'GPL-3.0-only',
		upstreamProjectUrl: 'https://github.com/audacity/audacity',
		upstreamLicenseUrl: `https://github.com/audacity/audacity/blob/${manifest.source.headSha}/LICENSE.txt`,
		soundscaperProjectUrl: 'https://github.com/LeoWattenberg/Soundscaper',
		modificationNotice: MODIFICATION_NOTICE,
	};
	assert(isPlainObject(manifest.provenance)
		&& canonicalJson(manifest.provenance) === canonicalJson(expectedProvenance),
		'Release GPL provenance or modification notice is invalid');
	let workflowUrl;
	try {
		workflowUrl = new URL(manifest.source.workflowUrl);
	} catch {
		fail('Release source workflowUrl is invalid');
	}
	assert(workflowUrl.origin === 'https://github.com'
		&& workflowUrl.pathname === `/audacity/audacity/actions/runs/${manifest.source.runId}`
		&& !workflowUrl.search && !workflowUrl.hash, 'Release source workflowUrl is invalid');
	assert(isPlainObject(manifest.conversion), 'Release conversion metadata is missing');
	assert(Number.isSafeInteger(manifest.conversion.mappingVersion) && manifest.conversion.mappingVersion > 0,
		'Release conversion mappingVersion is invalid');
	assert(SHA256_PATTERN.test(manifest.conversion.mappingSha256), 'Release conversion mappingSha256 is invalid');
	assert(typeof manifest.conversion.toolRevision === 'string' && /^[a-f0-9]{40}$/.test(manifest.conversion.toolRevision),
		'Release conversion toolRevision is invalid');
	const convertedAt = new Date(manifest.conversion.convertedAt);
	assert(!Number.isNaN(convertedAt.getTime()) && convertedAt.toISOString() === manifest.conversion.convertedAt,
		'Release conversion convertedAt is invalid');
	const archive = validateDescriptor(manifest.source.archive, 'source.archive', MAX_ARCHIVE_BYTES);
	const license = validateDescriptor(manifest.source.license, 'source.license', MAX_LICENSE_BYTES);
	const audit = validateDescriptor(manifest.audit, 'audit', MAX_AUDIT_BYTES);
	const releasePrefix = `releases/${releaseId}/`;
	assert(archive.path.startsWith(`${releasePrefix}source/`) && archive.path.endsWith('.zip'), 'Source archive path is unexpected');
	assert(ARTIFACT_NAME_PATTERN.test(basename(archive.path, '.zip')), 'Source archive name is unexpected');
	assert(license.path === `${releasePrefix}source/LICENSE.txt`, 'Source license path is unexpected');
	assert(audit.path === `${releasePrefix}audit.json`, 'Audit path is unexpected');

	assert(isPlainObject(manifest.locales) && Object.keys(manifest.locales).length >= 2, 'Release locales are missing');
	const locales = {};
	let mappingTotal;
	for (const locale of Object.keys(manifest.locales).sort()) {
		canonicalLocale(locale, `locales.${locale}`);
		const value = manifest.locales[locale];
		assert(isPlainObject(value), `locales.${locale} must be an object`);
		assert(typeof value.name === 'string' && value.name.trim() && value.name.length <= 160,
			`locales.${locale}.name is invalid`);
		assert(value.direction === 'ltr' || value.direction === 'rtl', `locales.${locale}.direction is invalid`);
		assert(typeof value.eligible === 'boolean', `locales.${locale}.eligible must be boolean`);
		assert(Number.isFinite(value.coverage) && value.coverage >= 0 && value.coverage <= 1,
			`locales.${locale}.coverage is invalid`);
		assert(Number.isSafeInteger(value.mapped) && value.mapped >= 0, `locales.${locale}.mapped is invalid`);
		assert(Number.isSafeInteger(value.total) && value.total > 0 && value.mapped <= value.total,
			`locales.${locale}.total is invalid`);
		mappingTotal ??= value.total;
		assert(value.total === mappingTotal, `locales.${locale}.total disagrees with the mapping total`);
		assert(Math.abs(value.coverage - (value.mapped / value.total)) <= Number.EPSILON * 4,
			`locales.${locale}.coverage disagrees with mapped/total`);
		assert(value.eligible === (locale === 'en' || locale === 'de' || value.coverage >= 0.79),
			`locales.${locale}.eligible disagrees with the 79 percent gate`);
		const pack = validateDescriptor(value, `locales.${locale}`, MAX_PACK_BYTES);
		assert(pack.path === `packs/${pack.sha256}.json`, `locales.${locale}.path is not content-addressed`);
		locales[locale] = {
			name: value.name,
			direction: value.direction,
			eligible: value.eligible,
			coverage: value.coverage,
			mapped: value.mapped,
			total: value.total,
			...pack,
		};
	}
	assert(locales.en?.eligible === true && locales.de?.eligible === true,
		'English and German must remain eligible');

	const validateLocaleList = (name) => {
		assert(Array.isArray(manifest[name]), `${name} must be an array`);
		const normalized = [...new Set(manifest[name])].sort();
		assert(normalized.length === manifest[name].length && normalized.every((locale, index) => locale === manifest[name][index]),
			`${name} must be sorted and unique`);
		for (const locale of normalized) assert(locale in locales, `${name} contains an unknown locale: ${locale}`);
		return normalized;
	};
	const eligibleLocales = validateLocaleList('eligibleLocales');
	const pendingLocales = validateLocaleList('pendingLocales');
	const retainedLocales = validateLocaleList('retainedLocales');
	assert(eligibleLocales.join('\0') === Object.keys(locales).filter((locale) => locales[locale].eligible).sort().join('\0'),
		'eligibleLocales disagrees with locale descriptors');
	assert(pendingLocales.every((locale) => locales[locale].eligible), 'pendingLocales contains an ineligible locale');
	assert(retainedLocales.every((locale) => locales[locale].eligible), 'retainedLocales contains an ineligible locale');
	assert(manifest.normalizedContentSha256 === normalizedReleaseIdentity(
		manifest.conversion.mappingVersion,
		manifest.conversion.mappingSha256,
		locales,
		pendingLocales,
	), 'normalizedContentSha256 disagrees with the mapping and locale metadata');
	return { releaseId, archive, license, audit, locales, eligibleLocales, pendingLocales, retainedLocales };
}

async function collectFiles(root, current = root) {
	const files = [];
	for (const entry of await readdir(current, { withFileTypes: true })) {
		const absolute = join(current, entry.name);
		assert(!entry.isSymbolicLink(), `Staged release contains a symbolic link: ${absolute}`);
		if (entry.isDirectory()) files.push(...await collectFiles(root, absolute));
		else if (entry.isFile()) files.push(relative(root, absolute).split(sep).join('/'));
		else fail(`Staged release contains a non-regular entry: ${absolute}`);
	}
	return files.sort();
}

async function findManifest(root, releaseId) {
	const releases = join(root, 'releases');
	const entries = await readdir(releases, { withFileTypes: true });
	const candidates = entries.filter((entry) => entry.isDirectory()
		&& (releaseId === undefined || entry.name === String(releaseId)));
	assert(candidates.length === 1, 'Staged release must contain exactly one release directory');
	return join(releases, candidates[0].name, 'manifest.json');
}

async function verifyContent(root, descriptor, label, referenced) {
	const path = safeRelativePath(descriptor.path, `${label}.path`);
	const bytes = await readLimitedFile(join(root, path), descriptor.byteLength, label);
	assert(bytes.byteLength === descriptor.byteLength, `${label} byte length does not match the manifest`);
	assert(sha256(bytes) === descriptor.sha256, `${label} SHA-256 does not match the manifest`);
	referenced.add(path);
	return bytes;
}

async function validateStage(rootOption, expectedReleaseId) {
	const root = resolve(rootOption);
	const manifestPath = await findManifest(root, expectedReleaseId);
	const manifestBytes = await readLimitedFile(manifestPath, MAX_MANIFEST_BYTES, 'release manifest');
	const manifest = parseJson(manifestBytes, 'release manifest');
	const shape = validateManifestShape(manifest, expectedReleaseId);
	const currentMappingSha256 = sha256(Buffer.from(canonicalJson(AUDACITY_QT_MAPPING)));
	assert(manifest.conversion.mappingVersion === AUDACITY_QT_MAPPING_VERSION,
		'Release mappingVersion does not match the checked-out converter');
	assert(manifest.conversion.mappingSha256 === currentMappingSha256,
		'Release mappingSha256 does not match the checked-out converter');
	assert(Object.values(shape.locales).every((descriptor) => descriptor.total === AUDACITY_QT_MAPPING.length),
		'Release locale totals do not match the checked-out reviewed mapping');
	validateCommittedRouteEligibility(shape.locales);
	const committedLocales = new Set(COMMITTED_LOCALE_TAGS);
	const expectedPendingLocales = Object.keys(shape.locales)
		.filter((locale) => shape.locales[locale].eligible && !committedLocales.has(locale))
		.sort();
	assert(shape.pendingLocales.join('\0') === expectedPendingLocales.join('\0'),
		'Release pendingLocales disagrees with the checked-out static route allowlist');
	for (const [locale, descriptor] of Object.entries(shape.locales)) {
		const known = LOCALE_BY_TAG[locale];
		if (!known) continue;
		assert(descriptor.name === known.nativeName && descriptor.direction === known.direction,
			`Release locale metadata disagrees with the checked-out locale registry: ${locale}`);
	}
	const relativeManifestPath = relative(root, manifestPath).split(sep).join('/');
	assert(relativeManifestPath === `releases/${shape.releaseId}/manifest.json`, 'Release manifest path is unexpected');
	const referenced = new Set([relativeManifestPath]);
	await verifyContent(root, shape.archive, 'source archive', referenced);
	const licenseBytes = await verifyContent(root, shape.license, 'source license', referenced);
	validateAudacityLicense(licenseBytes, 'source license');
	const auditBytes = await verifyContent(root, shape.audit, 'translation audit', referenced);
	parseJson(auditBytes, 'translation audit');
	for (const [locale, descriptor] of Object.entries(shape.locales)) {
		const packBytes = await verifyContent(root, descriptor, `${locale} pack`, referenced);
		const pack = parseJson(packBytes, `${locale} pack`);
		validatePackShape(pack, locale, `${locale} pack`, descriptor);
	}
	const stagedFiles = await collectFiles(root);
	assert(stagedFiles.join('\0') === [...referenced].sort().join('\0'),
		`Staged release contains missing or unreferenced files: ${stagedFiles.filter((path) => !referenced.has(path)).join(', ')}`);
	return {
		root,
		manifest,
		manifestBytes,
		manifestDescriptor: {
			path: relativeManifestPath,
			sha256: sha256(manifestBytes),
			byteLength: manifestBytes.byteLength,
		},
		...shape,
		files: stagedFiles,
	};
}

export function validateCommittedRouteEligibility(locales, committedLocales = COMMITTED_LOCALE_TAGS) {
	for (const locale of committedLocales) {
		if (locale === 'en' || locale === 'de') continue;
		assert(locales[locale]?.eligible === true,
			`Committed locale route ${locale} is missing or no longer meets the eligibility threshold`);
	}
	return true;
}

async function verifyUpstreamProvenance(release) {
	const runUrl = `https://api.github.com/repos/${AUDACITY.repository}/actions/runs/${release.manifest.source.runId}`;
	const { json: runResult } = await fetchJson(runUrl, {
		maximum: MAX_API_BYTES,
		label: 'staged Audacity workflow run',
		headers: githubHeaders(),
	});
	const run = validateAudacityWorkflowRun(runResult, release.manifest.source.runId);
	const updatedAt = Date.parse(run.updated_at);
	const age = Date.now() - updatedAt;
	assert(Number.isFinite(updatedAt) && age >= -5 * 60_000 && age <= 24 * 3_600_000,
		`Staged Audacity workflow run is stale: ${run.updated_at}`);
	assert(run.head_sha === release.manifest.source.headSha, 'Staged source head SHA does not match GitHub');
	assert(run.html_url === release.manifest.source.workflowUrl, 'Staged source workflow URL does not match GitHub');
	const artifactsUrl = `https://api.github.com/repos/${AUDACITY.repository}/actions/runs/${run.id}/artifacts?per_page=100`;
	const { json: artifactResult } = await fetchJson(artifactsUrl, {
		maximum: MAX_API_BYTES,
		label: 'staged Audacity workflow artifacts',
		headers: githubHeaders(),
	});
	validateAudacityArtifactResult(artifactResult, run, {
		artifactId: Number(release.releaseId),
		archiveName: basename(release.archive.path),
		byteLength: release.archive.byteLength,
		sha256: release.archive.sha256,
	});
	const licenseUrl = `https://raw.githubusercontent.com/${AUDACITY.repository}/${run.head_sha}/LICENSE.txt`;
	const { bytes: upstreamLicense } = await fetchLimited(licenseUrl, {
		maximum: MAX_LICENSE_BYTES,
		label: 'staged Audacity commit license',
		headers: { 'User-Agent': 'Soundscaper-translation-sync' },
	});
	validateAudacityLicense(upstreamLicense, 'staged Audacity commit license');
	assert(upstreamLicense.byteLength === release.license.byteLength
		&& sha256(upstreamLicense) === release.license.sha256,
		'Staged source license does not exactly match the Audacity commit license');
}

async function loadPublicPreviousRelease(baseUrl) {
	const result = await fetchLimited(publicObjectUrl(baseUrl, 'latest.json'), {
		maximum: MAX_POINTER_BYTES,
		label: 'current public translation pointer for retained-pack verification',
		headers: { 'Cache-Control': 'no-cache' },
	});
	const latest = validateLatest(parseJson(result.bytes, 'current public translation pointer for retained-pack verification'));
	const currentMappingSha256 = sha256(Buffer.from(canonicalJson(AUDACITY_QT_MAPPING)));
	assert(latest.mappingVersion === AUDACITY_QT_MAPPING_VERSION && latest.mappingSha256 === currentMappingSha256,
		'Retained packs require a current public release with the same reviewed mapping');
	const packs = new Map();
	for (const [locale, descriptor] of Object.entries(latest.locales)) {
		if (!descriptor.eligible || packs.has(descriptor.path)) continue;
		const { bytes } = await fetchLimited(publicObjectUrl(baseUrl, descriptor.path), {
			maximum: descriptor.byteLength,
			label: `current retained-source ${locale} pack`,
			headers: { 'Cache-Control': 'no-cache' },
		});
		assert(bytes.byteLength === descriptor.byteLength && sha256(bytes) === descriptor.sha256,
			`Current retained-source ${locale} pack does not match latest.json`);
		validatePackShape(parseJson(bytes, `current retained-source ${locale} pack`), locale,
			`current retained-source ${locale} pack`, descriptor);
		packs.set(descriptor.path, bytes);
	}
	return { latest, packs };
}

async function verifyDeterministicRelease(release, publicBaseUrl) {
	const { buildAudacityTranslationRelease } = await import('./audacity-qt-translations.mjs');
	const archiveBytes = await readFile(join(release.root, release.archive.path));
	const licenseBytes = await readFile(join(release.root, release.license.path));
	const previousRelease = release.retainedLocales.length
		? await loadPublicPreviousRelease(publicBaseUrl)
		: undefined;
	const rebuilt = buildAudacityTranslationRelease({
		archiveBytes,
		licenseBytes,
		exposedLocales: COMMITTED_LOCALE_TAGS,
		previousRelease,
		source: {
			artifactId: Number(release.releaseId),
			archiveName: basename(release.archive.path),
			expectedSha256: release.archive.sha256,
			expectedByteLength: release.archive.byteLength,
			repository: release.manifest.source.repository,
			runId: release.manifest.source.runId,
			headSha: release.manifest.source.headSha,
			workflowUrl: release.manifest.source.workflowUrl,
		},
		conversion: release.manifest.conversion,
	});
	const rebuiltPaths = [...rebuilt.files.keys()].sort();
	assert(rebuiltPaths.join('\0') === release.files.join('\0'),
		'Staged release file set differs from deterministic conversion output');
	for (const [path, expectedBytes] of rebuilt.files) {
		const actualBytes = await readFile(join(release.root, path));
		assert(actualBytes.byteLength === expectedBytes.byteLength && sha256(actualBytes) === sha256(expectedBytes),
			`Staged ${path} differs from deterministic conversion output`);
	}
}

async function verifyPublication(options) {
	rejectUnknownOptions(options, ['root', 'expected-tool-revision', 'public-base-url']);
	const expectedToolRevision = requiredOption(options, 'expected-tool-revision');
	assert(/^[a-f0-9]{40}$/.test(expectedToolRevision), '--expected-tool-revision must be a Git commit SHA');
	const publicBaseUrl = normalizedPublicRoot(options['public-base-url']
		?? process.env.PUBLIC_TRANSLATIONS_BASE_URL ?? PUBLIC_ROOT);
	const release = await validateStage(requiredOption(options, 'root'));
	assert(release.manifest.conversion.toolRevision === expectedToolRevision,
		'Staged conversion toolRevision does not match the protected publisher checkout');
	await verifyUpstreamProvenance(release);
	await verifyDeterministicRelease(release, publicBaseUrl);
	console.log(`Independently verified staged release ${release.releaseId} against GitHub and deterministic conversion`);
}

function validateLatest(value) {
	assert(isPlainObject(value) && value.schemaVersion === 1, 'latest.json schemaVersion must be 1');
	assert(RELEASE_ID_PATTERN.test(String(value.releaseId ?? '')), 'latest.json releaseId is invalid');
	validateDescriptor(value.manifest, 'latest.manifest', MAX_MANIFEST_BYTES);
	assert(value.manifest.path === `releases/${value.releaseId}/manifest.json`, 'latest.json manifest path is unexpected');
	assert(SHA256_PATTERN.test(value.normalizedContentSha256), 'latest.json normalizedContentSha256 is invalid');
	assert(typeof value.publishedAt === 'string' && Number.isFinite(Date.parse(value.publishedAt)), 'latest.json publishedAt is invalid');
	assert(isPlainObject(value.locales) && Object.keys(value.locales).length >= 2, 'latest.json locales are missing');
	let mappingTotal;
	for (const [locale, descriptor] of Object.entries(value.locales)) {
		canonicalLocale(locale, `latest.locales.${locale}`);
		assert(isPlainObject(descriptor) && typeof descriptor.name === 'string' && descriptor.name.trim(),
			`latest.locales.${locale}.name is invalid`);
		assert(descriptor.direction === 'ltr' || descriptor.direction === 'rtl', `latest.locales.${locale}.direction is invalid`);
		assert(typeof descriptor.eligible === 'boolean', `latest.locales.${locale}.eligible is invalid`);
		assert(Number.isFinite(descriptor.coverage) && descriptor.coverage >= 0 && descriptor.coverage <= 1,
			`latest.locales.${locale}.coverage is invalid`);
		assert(Number.isSafeInteger(descriptor.mapped) && descriptor.mapped >= 0,
			`latest.locales.${locale}.mapped is invalid`);
		assert(Number.isSafeInteger(descriptor.total) && descriptor.total > 0 && descriptor.mapped <= descriptor.total,
			`latest.locales.${locale}.total is invalid`);
		mappingTotal ??= descriptor.total;
		assert(descriptor.total === mappingTotal, `latest.locales.${locale}.total disagrees with the mapping total`);
		assert(Math.abs(descriptor.coverage - (descriptor.mapped / descriptor.total)) <= Number.EPSILON * 4,
			`latest.locales.${locale}.coverage disagrees with mapped/total`);
		assert(descriptor.eligible === (locale === 'en' || locale === 'de' || descriptor.coverage >= 0.79),
			`latest.locales.${locale}.eligible disagrees with the 79 percent gate`);
		const pack = validateDescriptor(descriptor, `latest.locales.${locale}`, MAX_PACK_BYTES);
		assert(pack.path === `packs/${pack.sha256}.json`, `latest.locales.${locale}.path is invalid`);
	}
	assert(value.locales.en?.eligible === true && value.locales.de?.eligible === true,
		'latest.json must expose English and German');
	const hasMappingVersion = value.mappingVersion !== undefined;
	const hasMappingSha256 = value.mappingSha256 !== undefined;
	assert(hasMappingVersion === hasMappingSha256,
		'latest.json must provide both mappingVersion and mappingSha256 or neither');
	if (hasMappingVersion) {
		assert(Number.isSafeInteger(value.mappingVersion) && value.mappingVersion > 0,
			'latest.json mappingVersion is invalid');
		assert(SHA256_PATTERN.test(value.mappingSha256), 'latest.json mappingSha256 is invalid');
		let pendingLocales;
		if (value.pendingLocales !== undefined) {
			assert(Array.isArray(value.pendingLocales), 'latest.json pendingLocales must be an array');
			pendingLocales = [...new Set(value.pendingLocales)].sort();
			assert(pendingLocales.length === value.pendingLocales.length
				&& pendingLocales.every((locale, index) => locale === value.pendingLocales[index]
					&& value.locales[locale]?.eligible === true),
			'latest.json pendingLocales must be sorted, unique, known, and eligible');
		}
		assert(value.normalizedContentSha256 === normalizedReleaseIdentity(
			value.mappingVersion,
			value.mappingSha256,
			value.locales,
			pendingLocales,
		), 'latest.json normalizedContentSha256 disagrees with its mapping and locale metadata');
		const currentMappingSha256 = sha256(Buffer.from(canonicalJson(AUDACITY_QT_MAPPING)));
		if (value.mappingVersion === AUDACITY_QT_MAPPING_VERSION && value.mappingSha256 === currentMappingSha256) {
			assert(mappingTotal === AUDACITY_QT_MAPPING.length,
				'latest.json locale totals do not match the current reviewed mapping');
		}
	} else {
		assert(value.normalizedContentSha256 === legacyReleaseIdentity(value.locales),
			'Legacy latest.json normalizedContentSha256 disagrees with its locale packs');
	}
	return value;
}

async function snapshot(options) {
	rejectUnknownOptions(options, ['output', 'base-url']);
	const output = resolve(requiredOption(options, 'output'));
	const baseUrl = normalizedPublicRoot(options['base-url'] ?? process.env.PUBLIC_TRANSLATIONS_BASE_URL ?? PUBLIC_ROOT);
	await ensureEmptyDirectory(output);
	const latestUrl = publicObjectUrl(baseUrl, 'latest.json');
	const result = await fetchLimited(latestUrl, {
		maximum: MAX_POINTER_BYTES,
		label: 'current public translation pointer',
		headers: { 'Cache-Control': 'no-cache' },
		acceptedStatuses: [200, 404],
	});
	if (result.response.status === 404) {
		console.log('No current public translation release; preparing without regression retention');
		return;
	}
	const latest = validateLatest(parseJson(result.bytes, 'current public translation pointer'));
	const currentMappingSha256 = sha256(Buffer.from(canonicalJson(AUDACITY_QT_MAPPING)));
	if (latest.mappingVersion !== AUDACITY_QT_MAPPING_VERSION || latest.mappingSha256 !== currentMappingSha256) {
		console.log(`Current release ${latest.releaseId} uses a different mapping; preparing without regression retention`);
		return;
	}
	await writeAtomic(join(output, 'latest.json'), canonicalJson(latest));
	const seen = new Map();
	for (const [locale, descriptor] of Object.entries(latest.locales)) {
		const previous = seen.get(descriptor.path);
		if (previous) {
			assert(previous.sha256 === descriptor.sha256 && previous.byteLength === descriptor.byteLength,
				`Locales disagree about shared pack ${descriptor.path}`);
			continue;
		}
		const { bytes } = await fetchLimited(publicObjectUrl(baseUrl, descriptor.path), {
			maximum: descriptor.byteLength,
			label: `current ${locale} translation pack`,
			headers: { 'Cache-Control': 'no-cache' },
		});
		assert(bytes.byteLength === descriptor.byteLength && sha256(bytes) === descriptor.sha256,
			`Current ${locale} pack does not match latest.json`);
		const pack = parseJson(bytes, `current ${locale} translation pack`);
		validatePackShape(pack, locale, `current ${locale} translation pack`, descriptor);
		await writeAtomic(join(output, descriptor.path), bytes);
		seen.set(descriptor.path, descriptor);
	}
	console.log(`Verified current release ${latest.releaseId} for regression retention`);
}

function rfc3986(value) {
	return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function normalizeHeader(value) {
	return String(value).trim().replace(/\s+/g, ' ');
}

class R2Client {
	constructor() {
		const accessKeyId = process.env.R2_TRANSLATIONS_ACCESS_KEY_ID;
		const secretAccessKey = process.env.R2_TRANSLATIONS_SECRET_ACCESS_KEY;
		const endpointValue = process.env.R2_TRANSLATIONS_ENDPOINT;
		const bucket = process.env.R2_TRANSLATIONS_BUCKET ?? 'soundscaper-translations';
		assert(accessKeyId && secretAccessKey && endpointValue, 'R2 translation S3 credentials and endpoint are required');
		assert(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket), 'R2 translation bucket name is invalid');
		const endpoint = new URL(endpointValue);
		assert(endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash,
			'R2 endpoint must be a bare HTTPS URL');
		assert(endpoint.pathname === '/' || endpoint.pathname === '', 'R2 endpoint must not contain a path');
		assert(endpoint.hostname.endsWith('.r2.cloudflarestorage.com'), 'R2 endpoint is not a Cloudflare S3 endpoint');
		this.accessKeyId = accessKeyId;
		this.secretAccessKey = secretAccessKey;
		this.sessionToken = process.env.R2_TRANSLATIONS_SESSION_TOKEN;
		this.endpoint = endpoint;
		this.bucket = bucket;
	}

	async request(method, key, { body = Buffer.alloc(0), headers = {}, acceptedStatuses = [200] } = {}) {
		key = safeRelativePath(key, 'R2 object key');
		const now = new Date();
		const dateStamp = now.toISOString().slice(0, 10).replaceAll('-', '');
		const amzDate = `${dateStamp}T${now.toISOString().slice(11, 19).replaceAll(':', '')}Z`;
		const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
		const payloadHash = sha256(payload);
		const canonicalUri = `/${rfc3986(this.bucket)}/${key.split('/').map(rfc3986).join('/')}`;
		const signedHeaders = {
			host: this.endpoint.host,
			'x-amz-content-sha256': payloadHash,
			'x-amz-date': amzDate,
		};
		if (this.sessionToken) signedHeaders['x-amz-security-token'] = this.sessionToken;
		for (const [name, value] of Object.entries(headers)) signedHeaders[name.toLowerCase()] = normalizeHeader(value);
		const names = Object.keys(signedHeaders).sort();
		const canonicalHeaders = `${names.map((name) => `${name}:${normalizeHeader(signedHeaders[name])}`).join('\n')}\n`;
		const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, names.join(';'), payloadHash].join('\n');
		const scope = `${dateStamp}/auto/s3/aws4_request`;
		const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
		const dateKey = hmac(`AWS4${this.secretAccessKey}`, dateStamp);
		const regionKey = hmac(dateKey, 'auto');
		const serviceKey = hmac(regionKey, 's3');
		const signingKey = hmac(serviceKey, 'aws4_request');
		const signature = hmac(signingKey, stringToSign, 'hex');
		const requestHeaders = new Headers(headers);
		requestHeaders.set('x-amz-content-sha256', payloadHash);
		requestHeaders.set('x-amz-date', amzDate);
		if (this.sessionToken) requestHeaders.set('x-amz-security-token', this.sessionToken);
		requestHeaders.set('Authorization', `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`);
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 120_000);
		let response;
		try {
				response = await fetch(`${this.endpoint.origin}${canonicalUri}`, {
					method,
					headers: requestHeaders,
					body: method === 'GET' || method === 'HEAD' || method === 'DELETE' ? undefined : payload,
					signal: controller.signal,
				});
		} catch (error) {
			fail(`R2 ${method} ${key} failed: ${error.message}`);
		} finally {
			clearTimeout(timer);
		}
		if (!acceptedStatuses.includes(response.status)) {
			const errorBody = (await response.text()).slice(0, 2_000);
			fail(`R2 ${method} ${key} returned HTTP ${response.status}: ${errorBody}`);
		}
		return response;
	}

	async get(key, maximum, acceptedStatuses = [200]) {
		const response = await this.request('GET', key, { acceptedStatuses });
		if (response.status !== 200) return { response, bytes: Buffer.alloc(0) };
		const declaredLength = Number(response.headers.get('content-length'));
		if (Number.isFinite(declaredLength)) assert(declaredLength <= maximum, `R2 ${key} exceeds ${maximum} bytes`);
		const bytes = Buffer.from(await response.arrayBuffer());
		assert(bytes.byteLength <= maximum, `R2 ${key} exceeds ${maximum} bytes`);
		return { response, bytes };
	}

	async put(key, bytes, { contentType, cacheControl, ifMatch, ifNoneMatch } = {}) {
		const headers = {
			'Cache-Control': cacheControl,
			'Content-Type': contentType,
		};
		if (ifMatch) headers['If-Match'] = ifMatch;
		if (ifNoneMatch) headers['If-None-Match'] = ifNoneMatch;
		return this.request('PUT', key, { body: bytes, headers, acceptedStatuses: [200, 412] });
	}

	async delete(key) {
		return this.request('DELETE', key, { acceptedStatuses: [204] });
	}
}

function normalizedPublicRoot(value) {
	const url = new URL(value);
	assert(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash,
		'Public translation base URL must be HTTPS without credentials, query, or fragment');
	url.pathname = url.pathname.replace(/\/+$/, '');
	assert(url.pathname === `/${ROOT_PREFIX}`, `Public translation base URL must end in /${ROOT_PREFIX}`);
	return url.toString().replace(/\/$/, '');
}

function publicObjectUrl(baseUrl, path) {
	path = safeRelativePath(path, 'public object path');
	return `${baseUrl}/${path.split('/').map(rfc3986).join('/')}`;
}

function immutableContentType(path) {
	if (path.endsWith('.json')) return 'application/json; charset=utf-8';
	if (path.endsWith('.zip')) return 'application/zip';
	if (path.endsWith('.txt')) return 'text/plain; charset=utf-8';
	fail(`No content type registered for ${path}`);
}

function pointerFromRelease(release) {
	const locales = {};
	for (const [locale, descriptor] of Object.entries(release.locales)) {
		locales[locale] = {
			name: descriptor.name,
			direction: descriptor.direction,
			eligible: descriptor.eligible,
			coverage: descriptor.coverage,
			mapped: descriptor.mapped,
			total: descriptor.total,
			path: descriptor.path,
			sha256: descriptor.sha256,
			byteLength: descriptor.byteLength,
		};
	}
	return {
		schemaVersion: 1,
		releaseId: release.releaseId,
		manifest: release.manifestDescriptor,
		mappingVersion: release.manifest.conversion.mappingVersion,
		mappingSha256: release.manifest.conversion.mappingSha256,
		normalizedContentSha256: release.manifest.normalizedContentSha256,
		pendingLocales: release.pendingLocales,
		locales,
		source: {
			repository: release.manifest.source.repository,
			workflowUrl: release.manifest.source.workflowUrl,
			runId: release.manifest.source.runId,
			headSha: release.manifest.source.headSha,
			artifactId: Number(release.releaseId),
			archive: release.archive,
		},
		publishedAt: new Date().toISOString(),
	};
}

async function existingPointer(client) {
	const key = `${ROOT_PREFIX}/latest.json`;
	const result = await client.get(key, MAX_POINTER_BYTES, [200, 404]);
	if (result.response.status === 404) return { key, pointer: null, bytes: null, etag: null };
	const pointer = validateLatest(parseJson(result.bytes, 'stored latest.json'));
	const etag = result.response.headers.get('etag');
	assert(etag, 'Stored latest.json has no ETag');
	return { key, pointer, bytes: result.bytes, etag };
}

async function putImmutable(client, key, bytes, contentType) {
	const response = await client.put(key, bytes, {
		contentType,
		cacheControl: 'public, max-age=31536000, immutable',
		ifNoneMatch: '*',
	});
	if (response.status === 412) {
		const existing = await client.get(key, bytes.byteLength);
		assert(existing.bytes.byteLength === bytes.byteLength && sha256(existing.bytes) === sha256(bytes),
			`Immutable R2 object already exists with different contents: ${key}`);
		return;
	}
	const stored = await client.get(key, bytes.byteLength);
	assert(stored.bytes.byteLength === bytes.byteLength && sha256(stored.bytes) === sha256(bytes),
		`R2 verification failed after writing ${key}`);
}

function assertCors(response, label) {
	const allowedOrigin = response.headers.get('access-control-allow-origin');
	assert(allowedOrigin === TRANSLATION_ORIGIN || allowedOrigin === '*',
		`${label} does not allow ${TRANSLATION_ORIGIN} through CORS`);
}

async function publicFetchVerified(baseUrl, descriptor, label, parse = false) {
	const smokeUrl = `${publicObjectUrl(baseUrl, descriptor.path)}?smoke=${Date.now()}-${encodeURIComponent(label)}`;
	const { response, bytes } = await fetchLimited(smokeUrl, {
		maximum: descriptor.byteLength,
		label,
		headers: { Origin: TRANSLATION_ORIGIN, 'Cache-Control': 'no-cache' },
	});
	assertCors(response, label);
	assert(bytes.byteLength === descriptor.byteLength && sha256(bytes) === descriptor.sha256,
		`${label} does not match its published descriptor`);
	return parse ? parseJson(bytes, label) : bytes;
}

async function publicSmokeRelease(baseUrl, release, { canonicalCatalog = false } = {}) {
	await publicFetchVerified(baseUrl, release.manifestDescriptor, 'public release manifest', true);
	const seen = new Set();
	for (const [locale, descriptor] of Object.entries(release.locales)) {
		if (seen.has(descriptor.path)) continue;
		const pack = await publicFetchVerified(baseUrl, descriptor, `public ${locale} pack`, true);
		validatePackShape(pack, locale, `public ${locale} pack`, descriptor, { canonicalCatalog });
		seen.add(descriptor.path);
	}
}

async function publicSmokePointer(baseUrl, expectedBytes) {
	const { response, bytes } = await fetchLimited(`${publicObjectUrl(baseUrl, 'latest.json')}?smoke=${Date.now()}`, {
		maximum: MAX_POINTER_BYTES,
		label: 'public latest.json',
		headers: { Origin: TRANSLATION_ORIGIN, 'Cache-Control': 'no-cache' },
	});
	assertCors(response, 'public latest.json');
	assert(sha256(bytes) === sha256(expectedBytes), 'Public latest.json does not match the promoted pointer');
	validateLatest(parseJson(bytes, 'public latest.json'));
}

export async function promotePointer(client, current, pointer, publicBaseUrl, smokePointer = publicSmokePointer) {
	const bytes = Buffer.from(canonicalJson(pointer));
	assert(bytes.byteLength <= MAX_POINTER_BYTES, `latest.json exceeds ${MAX_POINTER_BYTES} bytes`);
	const response = await client.put(current.key, bytes, {
		contentType: 'application/json; charset=utf-8',
		cacheControl: 'no-store',
		...(current.etag ? { ifMatch: current.etag } : { ifNoneMatch: '*' }),
	});
	assert(response.status === 200, 'latest.json changed concurrently; refusing to overwrite it');
	const promotedEtag = response.headers.get('etag');
	assert(promotedEtag, 'Promoted latest.json has no ETag');
	const stored = await client.get(current.key, bytes.byteLength);
	assert(sha256(stored.bytes) === sha256(bytes), 'Stored latest.json does not match the promoted pointer');
	try {
		await smokePointer(publicBaseUrl, bytes);
	} catch (error) {
		if (current.bytes) {
			const restored = await client.put(current.key, current.bytes, {
				contentType: 'application/json; charset=utf-8',
				cacheControl: 'no-store',
				ifMatch: promotedEtag,
			});
			assert(restored.status === 200, `Public smoke test failed and restoring latest.json also failed: ${error.message}`);
			const check = await client.get(current.key, current.bytes.byteLength);
			assert(sha256(check.bytes) === sha256(current.bytes), 'Restored latest.json failed verification');
			fail(`Public smoke test failed; restored release ${current.pointer.releaseId}: ${error.message}`);
		}
		// R2's S3 DeleteObject has no conditional header. The workflow is serialized,
		// so re-read and match both ETag and bytes immediately before removing the
		// first pointer, then prove the key is absent.
		const candidate = await client.get(current.key, bytes.byteLength, [200, 404]);
		assert(candidate.response.status === 200
			&& candidate.response.headers.get('etag') === promotedEtag
			&& sha256(candidate.bytes) === sha256(bytes),
			`First-release public smoke test failed and latest.json changed before cleanup: ${error.message}`);
		await client.delete(current.key);
		const missing = await client.get(current.key, MAX_POINTER_BYTES, [200, 404]);
		assert(missing.response.status === 404,
			`First-release public smoke test failed and latest.json cleanup could not be verified: ${error.message}`);
		fail(`First-release public smoke test failed; removed the guarded latest.json pointer: ${error.message}`);
	}
	return bytes;
}

async function publish(options) {
	rejectUnknownOptions(options, ['root', 'public-base-url']);
	const root = requiredOption(options, 'root');
	const publicBaseUrl = normalizedPublicRoot(options['public-base-url']
		?? process.env.PUBLIC_TRANSLATIONS_BASE_URL ?? PUBLIC_ROOT);
	const release = await validateStage(root);
	const client = new R2Client();
	const current = await existingPointer(client);
	if (current.pointer?.normalizedContentSha256 === release.manifest.normalizedContentSha256) {
		console.log(`Translation content is unchanged from release ${current.pointer.releaseId}; nothing published`);
		return;
	}
	for (const path of release.files) {
		const bytes = await readFile(join(release.root, path));
		await putImmutable(client, `${ROOT_PREFIX}/${path}`, bytes, immutableContentType(path));
	}
	await publicSmokeRelease(publicBaseUrl, release);
	const pointer = pointerFromRelease(release);
	await promotePointer(client, current, pointer, publicBaseUrl);
	console.log(`Published Audacity translation release ${release.releaseId}`);
}

async function fetchRemoteDescriptor(client, descriptor, label) {
	const result = await client.get(`${ROOT_PREFIX}/${descriptor.path}`, descriptor.byteLength);
	assert(result.bytes.byteLength === descriptor.byteLength && sha256(result.bytes) === descriptor.sha256,
		`${label} does not match its release manifest`);
	return result.bytes;
}

async function loadRemoteRelease(client, releaseId) {
	assert(RELEASE_ID_PATTERN.test(releaseId), '--release-id must be a positive artifact ID');
	const manifestPath = `releases/${releaseId}/manifest.json`;
	const { bytes: manifestBytes } = await client.get(`${ROOT_PREFIX}/${manifestPath}`, MAX_MANIFEST_BYTES);
	const manifest = parseJson(manifestBytes, `release ${releaseId} manifest`);
	const shape = validateManifestShape(manifest, releaseId);
	await fetchRemoteDescriptor(client, shape.archive, 'rollback source archive');
	const licenseBytes = await fetchRemoteDescriptor(client, shape.license, 'rollback source license');
	validateAudacityLicense(licenseBytes, 'rollback source license');
	const audit = await fetchRemoteDescriptor(client, shape.audit, 'rollback audit');
	parseJson(audit, 'rollback audit');
	for (const [locale, descriptor] of Object.entries(shape.locales)) {
		const packBytes = await fetchRemoteDescriptor(client, descriptor, `rollback ${locale} pack`);
		const pack = parseJson(packBytes, `rollback ${locale} pack`);
		validatePackShape(pack, locale, `rollback ${locale} pack`, descriptor, { canonicalCatalog: true });
	}
	return {
		manifest,
		manifestBytes,
		manifestDescriptor: { path: manifestPath, sha256: sha256(manifestBytes), byteLength: manifestBytes.byteLength },
		...shape,
	};
}

async function rollback(options) {
	rejectUnknownOptions(options, ['release-id', 'public-base-url']);
	const releaseId = requiredOption(options, 'release-id');
	const publicBaseUrl = normalizedPublicRoot(options['public-base-url']
		?? process.env.PUBLIC_TRANSLATIONS_BASE_URL ?? PUBLIC_ROOT);
	const client = new R2Client();
	const current = await existingPointer(client);
	assert(current.pointer, 'Cannot roll back before an initial translation release exists');
	if (String(current.pointer.releaseId) === releaseId) {
		console.log(`Release ${releaseId} is already active`);
		return;
	}
	const release = await loadRemoteRelease(client, releaseId);
	await publicSmokeRelease(publicBaseUrl, release, { canonicalCatalog: true });
	const pointer = pointerFromRelease(release);
	await promotePointer(client, current, pointer, publicBaseUrl);
	console.log(`Promoted Audacity translation release ${releaseId}`);
}

async function verifyStage(options) {
	rejectUnknownOptions(options, ['root']);
	const release = await validateStage(requiredOption(options, 'root'));
	console.log(`Verified staged release ${release.releaseId}: ${release.files.length} immutable objects`);
}

function usage() {
	console.error(`Usage:
  node scripts/manage-audacity-translation-release.mjs discover --output <directory> [--max-age-hours 24] [--github-env <file>] [--github-output <file>]
  node scripts/manage-audacity-translation-release.mjs snapshot --output <directory> [--base-url ${PUBLIC_ROOT}]
  node scripts/manage-audacity-translation-release.mjs verify-stage --root <directory>
  node scripts/manage-audacity-translation-release.mjs verify-publication --root <directory> --expected-tool-revision <sha> [--public-base-url ${PUBLIC_ROOT}]
  node scripts/manage-audacity-translation-release.mjs publish --root <directory> [--public-base-url ${PUBLIC_ROOT}]
  node scripts/manage-audacity-translation-release.mjs rollback --release-id <artifact-id> [--public-base-url ${PUBLIC_ROOT}]`);
}

async function runCli(argv) {
	const { command, options } = parseArgs(argv);
	if (command === 'discover') await discover(options);
	else if (command === 'snapshot') await snapshot(options);
	else if (command === 'verify-stage') await verifyStage(options);
	else if (command === 'verify-publication') await verifyPublication(options);
	else if (command === 'publish') await publish(options);
	else if (command === 'rollback') await rollback(options);
	else {
		usage();
		process.exitCode = 2;
	}
}

function isMainModule() {
	if (!process.argv[1]) return false;
	return pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
	runCli(process.argv.slice(2)).catch((error) => {
		console.error(`Translation release error: ${error.message}`);
		process.exitCode = 1;
	});
}
