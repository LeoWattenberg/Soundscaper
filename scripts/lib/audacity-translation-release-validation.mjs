/* SPDX-License-Identifier: AGPL-3.0-only */

// What an upstream Audacity translation artifact has to prove before it is
// converted: the workflow run it came from, the artifact's identity and
// official digest, and the licence text at that commit.

import {
	ARTIFACT_NAME_PATTERN,
	AUDACITY,
	MAX_ARCHIVE_BYTES,
	SHA256_PATTERN,
	assert,
	fail,
	isPlainObject,
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
