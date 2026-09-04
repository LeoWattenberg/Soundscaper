/* SPDX-License-Identifier: AGPL-3.0-only */

// Finding the Audacity workflow run a translation release comes from, staging
// its artifact, and proving the result is reproducible. The upstream run and
// artifact are identified before anything is downloaded, the conversion is
// repeated against the already-published release to show it lands on the same
// bytes, and a snapshot of what is currently public can be taken for
// comparison. Split out of manage-audacity-translation-release.mjs; no
// behaviour changes here.

import { appendFile, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import {
	AUDACITY_QT_MAPPING,
	AUDACITY_QT_MAPPING_VERSION,
} from '../../src/common/i18n/audacity-qt-mapping.js';
import { COMMITTED_LOCALE_TAGS } from '../../src/common/i18n/locales.js';
import { canonicalJsonDocument as canonicalJson } from './canonical-json.mjs';
import {
	AUDACITY,
	MAX_API_BYTES,
	MAX_ARCHIVE_BYTES,
	MAX_LICENSE_BYTES,
	MAX_POINTER_BYTES,
	PUBLIC_ROOT,
	assert,
	ensureEmptyDirectory,
	fetchJson,
	fetchLimited,
	githubHeaders,
	isPlainObject,
	normalizedPublicRoot,
	parseJson,
	publicObjectUrl,
	rejectUnknownOptions,
	requiredOption,
	sha256,
	writeAtomic,
} from './audacity-translation-release-values.mjs';
import {
	validateAudacityArtifactResult,
	validateAudacityLicense,
	validateAudacityWorkflowRun,
	validateLatest,
	validatePackShape,
	validateStage,
} from './audacity-translation-release-validation.mjs';

export async function discover(options) {
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

export async function verifyUpstreamProvenance(release) {
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

export async function loadPublicPreviousRelease(baseUrl) {
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

export async function verifyDeterministicRelease(release, publicBaseUrl) {
	const { buildAudacityTranslationRelease } = await import('../audacity-qt-translations.mjs');
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

export async function verifyPublication(options) {
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

export async function snapshot(options) {
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
