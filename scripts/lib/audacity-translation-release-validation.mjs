/* SPDX-License-Identifier: AGPL-3.0-only */

// What a translation release has to prove before it can be staged or published.
// The packs come from an upstream Audacity workflow run, so the run, its
// artifact, every descriptor's digest and byte length, every pack's shape and
// placeholders, the licence text and the manifest that ties them together are
// each checked by name — including against the release the pointer currently
// names. Split out of manage-audacity-translation-release.mjs; no behaviour
// changes here.

import { readdir } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';

import {
	AUDACITY_QT_MAPPING,
	AUDACITY_QT_MAPPING_VERSION,
} from '../../src/common/i18n/audacity-qt-mapping.js';
import { ENGLISH_COPY } from '../../src/common/i18n/catalogs.js';
import { COMMITTED_LOCALE_TAGS, LOCALE_BY_TAG } from '../../src/common/i18n/locales.js';
import { canonicalJsonDocument as canonicalJson } from './canonical-json.mjs';
import { safeRelativePath } from './r2-client.mjs';
import {
	ARTIFACT_NAME_PATTERN,
	AUDACITY,
	ELLIPSIS_PATTERN,
	MAPPING_BY_KEY,
	MAX_ARCHIVE_BYTES,
	MAX_AUDIT_BYTES,
	MAX_LICENSE_BYTES,
	MAX_MANIFEST_BYTES,
	MAX_PACK_BYTES,
	MODIFICATION_NOTICE,
	RELEASE_ID_PATTERN,
	SHA256_PATTERN,
	assert,
	canonicalLocale,
	fail,
	isPlainObject,
	parseJson,
	readLimitedFile,
	sha256,
} from './audacity-translation-release-values.mjs';

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

export function validateDescriptor(value, label, maximum) {
	assert(isPlainObject(value), `${label} must be an object`);
	const path = safeRelativePath(value.path, `${label}.path`);
	assert(SHA256_PATTERN.test(value.sha256), `${label}.sha256 is invalid`);
	assert(Number.isSafeInteger(value.byteLength) && value.byteLength > 0 && value.byteLength <= maximum,
		`${label}.byteLength is invalid`);
	return { path, sha256: value.sha256, byteLength: value.byteLength };
}

export function validatePackShape(pack, locale, label, descriptor, { canonicalCatalog = false } = {}) {
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

export function namedPlaceholders(value) {
	return [...String(value).matchAll(/\{[A-Za-z][A-Za-z0-9_]*\}/g)].map(([placeholder]) => placeholder).sort();
}

export function validateHistoricalPack(pack, locale, descriptor) {
	return validatePackShape(pack, locale, `historical ${locale} pack`, descriptor, { canonicalCatalog: true });
}

export function validateAudacityLicense(bytes, label) {
	let text;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		fail(`${label} is not valid UTF-8`);
	}
	assert(text.includes('Audacity is released under the GNU General Public License version 3 (GPLv3).'),
		`${label} does not contain Audacity's GPLv3 notice`);
}

export function normalizedPointerLocale(descriptor) {
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

export function normalizedReleaseIdentity(mappingVersion, mappingSha256, locales, pendingLocales) {
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

export function legacyReleaseIdentity(locales) {
	return sha256(Buffer.from(canonicalJson(Object.fromEntries(
		Object.entries(locales).map(([locale, descriptor]) => [locale, descriptor.sha256]),
	))));
}

export function validateManifestShape(manifest, expectedReleaseId) {
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

export async function collectFiles(root, current = root) {
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

export async function findManifest(root, releaseId) {
	const releases = join(root, 'releases');
	const entries = await readdir(releases, { withFileTypes: true });
	const candidates = entries.filter((entry) => entry.isDirectory()
		&& (releaseId === undefined || entry.name === String(releaseId)));
	assert(candidates.length === 1, 'Staged release must contain exactly one release directory');
	return join(releases, candidates[0].name, 'manifest.json');
}

export async function verifyContent(root, descriptor, label, referenced) {
	const path = safeRelativePath(descriptor.path, `${label}.path`);
	const bytes = await readLimitedFile(join(root, path), descriptor.byteLength, label);
	assert(bytes.byteLength === descriptor.byteLength, `${label} byte length does not match the manifest`);
	assert(sha256(bytes) === descriptor.sha256, `${label} SHA-256 does not match the manifest`);
	referenced.add(path);
	return bytes;
}

export async function validateStage(rootOption, expectedReleaseId) {
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

export function validateLatest(value) {
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
