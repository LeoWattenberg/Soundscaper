/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateSoundscaperStable1ReleaseCandidateIdentity } from
	'./soundscaper-stable-1-release-admission.mjs';

const TARGET_IDS = Object.freeze([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
]);
const REQUIRED_JOB_NAMES = Object.freeze([
	...TARGET_IDS.map((target) => {
		const separator = target.lastIndexOf('-');
		return `Package soundscaper / ${target.slice(0, separator)} / ${target.slice(separator + 1)}`;
	}),
	'Assemble the release inventory',
]);
const REQUIRED_ARTIFACT_NAMES = Object.freeze([
	...TARGET_IDS.map((target) => `nightly-soundscaper-${target}`),
	'release-inventory',
]);

export function validateSoundscaperStable1CandidateWorkflowRun(value, candidateValue) {
	const candidate = validateSoundscaperStable1ReleaseCandidateIdentity(candidateValue);
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| value.databaseId !== candidate.desktopPreviewWorkflowRunId
		|| value.headSha !== candidate.commitSha || value.headBranch !== candidate.tag
		|| value.workflowName !== 'Desktop preview and nightly' || value.event !== 'push'
		|| value.status !== 'completed' || !['success', 'failure'].includes(value.conclusion)) {
		throw new Error('The admitted desktop-preview workflow run identity does not match GitHub.');
	}
	return Object.freeze({
		databaseId: value.databaseId, headSha: value.headSha, headBranch: value.headBranch,
		workflowName: value.workflowName, event: value.event, status: value.status,
		conclusion: value.conclusion,
	});
}

export function validateSoundscaperStable1CandidateWorkflowEvidence(value, candidateValue) {
	const candidate = validateSoundscaperStable1ReleaseCandidateIdentity(candidateValue);
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| !Array.isArray(value.jobs) || !Array.isArray(value.artifacts)) {
		throw new TypeError('The Soundscaper release-candidate workflow evidence is invalid.');
	}
	for (const name of REQUIRED_JOB_NAMES) validateJob(value.jobs, name, candidate);
	for (const name of REQUIRED_ARTIFACT_NAMES) validateArtifact(value.artifacts, name, candidate);
	return Object.freeze({ jobNames: REQUIRED_JOB_NAMES, artifactNames: REQUIRED_ARTIFACT_NAMES });
}

function validateJob(jobs, name, candidate) {
	const matches = jobs.filter((job) => job?.name === name);
	if (matches.length !== 1) {
		throw new Error(`The exact required Soundscaper candidate job ${name} is missing or duplicated.`);
	}
	const [job] = matches;
	if (job.run_id !== candidate.desktopPreviewWorkflowRunId
		|| job.head_sha !== candidate.commitSha || job.status !== 'completed'
		|| job.conclusion !== 'success') {
		throw new Error(`The required Soundscaper candidate job ${name} did not succeed for the admitted source.`);
	}
}

function validateArtifact(artifacts, name, candidate) {
	const matches = artifacts.filter((artifact) => artifact?.name === name);
	if (matches.length !== 1) {
		throw new Error(`The exact required Soundscaper candidate artifact ${name} is missing or duplicated.`);
	}
	const [artifact] = matches;
	if (artifact.expired !== false || !Number.isSafeInteger(artifact.size_in_bytes)
		|| artifact.size_in_bytes < 1
		|| artifact.workflow_run?.id !== candidate.desktopPreviewWorkflowRunId
		|| artifact.workflow_run?.head_sha !== candidate.commitSha) {
		throw new Error(`The required Soundscaper candidate artifact ${name} is not source-bound and available.`);
	}
}
