/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	validateSoundscaperStable1CandidateWorkflowEvidence,
	validateSoundscaperStable1CandidateWorkflowRun,
} from '../scripts/lib/soundscaper-stable-1-candidate-workflow.mjs';
import {
	authenticateSoundscaperStable1CandidateArtifact,
} from '../scripts/lib/soundscaper-stable-1-release-admission.mjs';

test('Stable lifecycle authority accepts only exact Soundscaper jobs, artifacts, and bytes', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-stable-candidate-'));
	context.after(() => rm(root, { force: true, recursive: true }));
	const inventoryRoot = join(root, 'inventory');
	const artifactRoot = join(root, 'artifact');
	await Promise.all([mkdir(inventoryRoot), mkdir(artifactRoot)]);
	const names = stableCandidateInventoryNames();
	const bodies = new Map(names.map((name) => [name, Buffer.from(`candidate:${name}`)]));
	const inventoryBytes = Buffer.from(`${names.map((name) => `${sha256(bodies.get(name))}  ${name}`)
		.join('\n')}\n`);
	await writeFile(join(inventoryRoot, 'SHA256SUMS'), inventoryBytes);
	for (const name of names.filter((value) => /linux-x64|linux-(?:x64|x86_64|amd64)/u.test(value))) {
		await writeFile(join(artifactRoot, name), bodies.get(name));
	}
	const candidate = candidateIdentity(inventoryBytes);
	const run = candidateRun(candidate);
	assert.equal(validateSoundscaperStable1CandidateWorkflowRun(run, candidate).databaseId,
		candidate.desktopPreviewWorkflowRunId);
	assert.equal(validateSoundscaperStable1CandidateWorkflowRun({ ...run, conclusion: 'failure' },
		candidate).conclusion, 'failure', 'unrelated product failure is not a Soundscaper blocker');
	const evidence = candidateWorkflowEvidence(candidate);
	assert.equal(validateSoundscaperStable1CandidateWorkflowEvidence(evidence, candidate)
		.artifactNames.length, 6);
	assertWorkflowEvidenceRefusals(evidence, candidate);

	const authenticated = await authenticateSoundscaperStable1CandidateArtifact({
		candidate, targetId: 'linux-x64', inventoryPath: join(inventoryRoot, 'SHA256SUMS'), artifactRoot,
	});
	assert.deepEqual(authenticated.artifactNames, [
		'Soundscaper-1.0.0-rc.1-linux-amd64.deb',
		'Soundscaper-1.0.0-rc.1-linux-x86_64.AppImage',
		'runtime-manifest-soundscaper-linux-x64.json',
	]);
	for (const [field, value] of [
		['databaseId', candidate.desktopPreviewWorkflowRunId + 1], ['headSha', 'f'.repeat(40)],
		['headBranch', 'soundscaper-v1.0.0-rc.2'], ['workflowName', 'Another workflow'],
		['event', 'workflow_dispatch'], ['status', 'in_progress'], ['conclusion', 'cancelled'],
	]) assert.throws(() => validateSoundscaperStable1CandidateWorkflowRun({ ...run, [field]: value },
		candidate), /workflow run identity/iu, field);
	await writeFile(join(artifactRoot, 'Soundscaper-1.0.0-rc.1-linux-amd64.deb'), 'tampered');
	await assert.rejects(authenticateSoundscaperStable1CandidateArtifact({
		candidate, targetId: 'linux-x64', inventoryPath: join(inventoryRoot, 'SHA256SUMS'), artifactRoot,
	}), /inventory digest/iu);
});

function candidateIdentity(inventoryBytes) {
	return {
		version: '1.0.0-rc.1', tag: 'soundscaper-v1.0.0-rc.1',
		commitSha: '0123456789abcdef0123456789abcdef01234567',
		desktopPreviewWorkflowRunId: 12_345_678_901,
		packageInventorySha256: sha256(inventoryBytes),
	};
}

function candidateRun(candidate) {
	return {
		databaseId: candidate.desktopPreviewWorkflowRunId, headSha: candidate.commitSha,
		headBranch: candidate.tag, workflowName: 'Desktop preview and nightly', event: 'push',
		status: 'completed', conclusion: 'success',
	};
}

function candidateWorkflowEvidence(candidate) {
	const targets = ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'];
	return {
		jobs: [...targets.map((target) => {
			const separator = target.lastIndexOf('-');
			return {
				name: `Package soundscaper / ${target.slice(0, separator)} / ${target.slice(separator + 1)}`,
				run_id: candidate.desktopPreviewWorkflowRunId, head_sha: candidate.commitSha,
				status: 'completed', conclusion: 'success',
			};
		}), {
			name: 'Assemble the release inventory', run_id: candidate.desktopPreviewWorkflowRunId,
			head_sha: candidate.commitSha, status: 'completed', conclusion: 'success',
		}, {
			name: 'Package framescaper / linux / x64', run_id: candidate.desktopPreviewWorkflowRunId,
			head_sha: candidate.commitSha, status: 'completed', conclusion: 'failure',
		}],
		artifacts: [...targets.map((target) => ({
			name: `nightly-soundscaper-${target}`, expired: false, size_in_bytes: 1,
			workflow_run: { id: candidate.desktopPreviewWorkflowRunId, head_sha: candidate.commitSha },
		})), {
			name: 'release-inventory', expired: false, size_in_bytes: 1,
			workflow_run: { id: candidate.desktopPreviewWorkflowRunId, head_sha: candidate.commitSha },
		}],
	};
}

function assertWorkflowEvidenceRefusals(evidence, candidate) {
	for (const [changed, reason] of [
		[{ jobs: evidence.jobs.filter(({ name }) => name !== 'Package soundscaper / linux / x64') },
			/required.*job/iu],
		[{ jobs: evidence.jobs.map((job, index) => index === 0
			? { ...job, head_sha: 'f'.repeat(40) } : job) }, /admitted source/iu],
		[{ artifacts: evidence.artifacts.filter(({ name }) => name !== 'release-inventory') },
			/required.*artifact/iu],
		[{ artifacts: evidence.artifacts.map((artifact, index) => index === 0
			? { ...artifact, expired: true } : artifact) }, /source-bound and available/iu],
	]) assert.throws(() => validateSoundscaperStable1CandidateWorkflowEvidence({
		...evidence, ...changed,
	}, candidate), reason);
}

function stableCandidateInventoryNames() {
	return [
		'Soundscaper-1.0.0-rc.1-linux-arm64.AppImage', 'Soundscaper-1.0.0-rc.1-linux-arm64.deb',
		'Soundscaper-1.0.0-rc.1-linux-amd64.deb', 'Soundscaper-1.0.0-rc.1-linux-x86_64.AppImage',
		'Soundscaper-1.0.0-rc.1-mac-arm64.dmg', 'Soundscaper-1.0.0-rc.1-win-arm64.exe',
		'Soundscaper-1.0.0-rc.1-win-arm64.zip', 'Soundscaper-1.0.0-rc.1-win-x64.exe',
		'Soundscaper-1.0.0-rc.1-win-x64.zip', 'runtime-manifest-soundscaper-linux-arm64.json',
		'runtime-manifest-soundscaper-linux-x64.json', 'runtime-manifest-soundscaper-mac-arm64.json',
		'runtime-manifest-soundscaper-win-arm64.json', 'runtime-manifest-soundscaper-win-x64.json',
	].sort();
}

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
