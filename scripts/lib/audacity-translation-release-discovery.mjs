/* SPDX-License-Identifier: AGPL-3.0-only */

// Finding the newest reviewed Audacity translation artifact: the latest
// successful scheduled run of Audacity's translation workflow, its single
// artifact, the archive's official digest, and the licence text at that
// commit, all fetched over authenticated GitHub API calls and written to a
// directory for `scripts/audacity-qt-translations.mjs commit` to convert.
// The publication, snapshot and rollback commands that used to live beside
// this were retired when the converted strings became committed source.

import { appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { canonicalJsonDocument as canonicalJson } from './canonical-json.mjs';
import {
	AUDACITY,
	MAX_API_BYTES,
	MAX_ARCHIVE_BYTES,
	MAX_LICENSE_BYTES,
	assert,
	ensureEmptyDirectory,
	fetchJson,
	fetchLimited,
	githubHeaders,
	isPlainObject,
	rejectUnknownOptions,
	requiredOption,
	sha256,
	writeAtomic,
} from './audacity-translation-release-values.mjs';
import {
	validateAudacityArtifactResult,
	validateAudacityWorkflowRun,
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
