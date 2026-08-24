/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

const SOURCE_REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;
const QUALIFICATION_REGISTER = 'config/milestone-5-qualification-evidence.json';
const QUALITY_BUDGETS = 'config/quality-budgets.json';

export function authenticateHandoffSourceRevision(repositoryRoot, assertedRevision) {
	assert(SOURCE_REVISION.test(assertedRevision),
		'Milestone 5 asserted handoff revision must be one Git object ID.');
	const resolved = gitText(repositoryRoot, ['rev-parse', '--verify', `${assertedRevision}^{commit}`]);
	const head = gitText(repositoryRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
	assert(resolved === head, 'Milestone 5 asserted handoff revision does not resolve to HEAD.');
	const status = execFileSync(
		'git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
		{ cwd: repositoryRoot, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
	);
	assert(status.byteLength === 0,
		'Milestone 5 release handoff worktree and index must be clean.');
	return Object.freeze({ status: 'authenticated-clean-head', sourceRevision: head });
}

/**
 * Admit the unavoidable evidence commit without letting measurements for an
 * older runtime qualify changed product code. Only raw/register evidence and
 * the named workload publication markers may differ from the measured commit.
 */
export function validateQualificationRevisionCompatibility(options) {
	const {
		repositoryRoot,
		qualificationSourceRevision,
		handoffSourceRevision,
		currentQualityBudgets,
		workloadIds,
	} = options;
	assert(SOURCE_REVISION.test(qualificationSourceRevision)
		&& SOURCE_REVISION.test(handoffSourceRevision),
	'Qualification revision binding requires two Git object IDs.');
	assert(Array.isArray(workloadIds) && workloadIds.length > 0
		&& workloadIds.every((id) => typeof id === 'string')
		&& new Set(workloadIds).size === workloadIds.length,
	'Qualification revision binding requires unique workload IDs.');
	if (qualificationSourceRevision === handoffSourceRevision) {
		return Object.freeze({
			kind: 'same-revision',
			qualificationSourceRevision,
			handoffSourceRevision,
			changedPathCount: 0,
			changedPathsSha256: sha256(Buffer.alloc(0)),
		});
	}
	const ancestry = spawnSync(
		'git',
		['merge-base', '--is-ancestor', qualificationSourceRevision, handoffSourceRevision],
		{ cwd: repositoryRoot, encoding: 'utf8' },
	);
	assert(ancestry.status === 0,
		'Qualification source must be an ancestor of the handoff source.');
	const changedBytes = execFileSync(
		'git',
		['diff', '--name-only', '--no-renames', '-z', qualificationSourceRevision, handoffSourceRevision],
		{ cwd: repositoryRoot, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
	);
	const changedPaths = changedBytes.toString('utf8').split('\0').filter(Boolean).sort();
	for (const path of changedPaths) {
		assert(isQualificationEvidenceBridgePath(path),
			`Milestone 5 changed path ${path} is outside the evidence-only bridge.`);
	}
	const historicalBytes = execFileSync(
		'git',
		['show', `${qualificationSourceRevision}:${QUALITY_BUDGETS}`],
		{ cwd: repositoryRoot, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
	);
	let historicalQualityBudgets;
	try {
		historicalQualityBudgets = JSON.parse(historicalBytes.toString('utf8'));
	} catch (error) {
		throw new Error('Milestone 5 historical quality budgets are invalid JSON.', { cause: error });
	}
	assert(isDeepStrictEqual(
		normalizeQualificationPublicationState(historicalQualityBudgets, workloadIds),
		normalizeQualificationPublicationState(currentQualityBudgets, workloadIds),
	), 'Milestone 5 quality budgets changed beyond qualification publication markers.');
	return Object.freeze({
		kind: 'qualification-evidence-only-descendant',
		qualificationSourceRevision,
		handoffSourceRevision,
		changedPathCount: changedPaths.length,
		changedPathsSha256: sha256(Buffer.from(`${changedPaths.join('\0')}\0`, 'utf8')),
	});
}

function isQualificationEvidenceBridgePath(path) {
	if (path === QUALITY_BUDGETS || path === QUALIFICATION_REGISTER) return true;
	const prefix = 'qualification/milestone-5/';
	if (!path.startsWith(prefix) || path.includes('\\') || path.includes('\0')) return false;
	const segments = path.slice(prefix.length).split('/');
	return segments.length > 0 && segments.every((segment) => (
		segment !== '' && segment !== '.' && segment !== '..'
	));
}

function normalizeQualificationPublicationState(value, workloadIds) {
	const config = snapshotStrictJsonData(value, 'Milestone 5 quality-budget revision binding');
	assert(Array.isArray(config.workloads), 'Milestone 5 revision-bound workloads must be an array.');
	for (const workloadId of workloadIds) {
		const matches = config.workloads.filter(({ id }) => id === workloadId);
		assert(matches.length === 1 && typeof matches[0].status === 'string',
			`Milestone 5 revision binding needs workload ${workloadId}.`);
		delete matches[0].status;
	}
	assert(Array.isArray(config.qualification?.qualifiedWorkloadIds),
		'Milestone 5 revision-bound qualifiedWorkloadIds must be an array.');
	config.qualification.qualifiedWorkloadIds = config.qualification.qualifiedWorkloadIds
		.filter((id) => !workloadIds.includes(id));
	return config;
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function gitText(repositoryRoot, arguments_) {
	return execFileSync('git', arguments_, {
		cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 1024 * 1024,
	}).trim();
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
