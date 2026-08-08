/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
	DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE,
	createDesktopProjectLibrarySourceBearingPlan,
	createDesktopProjectLibrarySourceBearingWorkflows,
	encodeDesktopProjectLibrarySourceBearingPlan,
	validateDesktopProjectLibrarySourceBearingResult,
} from '../../desktop/project-library-source-bearing-smoke.js';
import {
	packagedExecutableCandidates,
	resolveSmokeArchitecture,
} from './desktop-smoke.mjs';

export const DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_OUTPUT_PREFIX = 'SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING ';
export const DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_AGGREGATE_PREFIX = 'SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_HANDOFF ';

const MAXIMUM_CHILD_OUTPUT_BYTES = 1024 * 1024;
const MAXIMUM_AGGREGATE_BYTES = 64 * 1024;
const CHILD_TIMEOUT_MS = 45_000;

export function createDesktopProjectLibrarySourceBearingInvocation({
	arch,
	outputRoot,
	platform,
	profileRoot,
	workflowId,
	stage,
	previous,
}) {
	const targetArch = resolveSmokeArchitecture(arch, arch);
	const output = absolutePath(outputRoot, 'package output root');
	const profile = absolutePath(profileRoot, 'profile root');
	const workflow = createDesktopProjectLibrarySourceBearingWorkflows()
		.find((candidate) => candidate.id === workflowId);
	if (!workflow) throw new TypeError('Source-bearing packaged handoff invocation workflow is invalid');
	const definition = workflow.stages.find((candidate) => candidate.stage === stage);
	if (!definition) throw new TypeError('Source-bearing packaged handoff invocation stage is invalid');
	const plan = createDesktopProjectLibrarySourceBearingPlan({ workflowId, stage, previous });
	const encodedPlan = encodeDesktopProjectLibrarySourceBearingPlan(plan);
	const workflowRoot = resolve(profile, 'workflows', workflow.id);
	const userDataPath = resolve(workflowRoot, 'profiles', definition.profileId);
	const sharedAppDataPath = resolve(workflowRoot, 'application-data');
	const productName = definition.productId === 'framescaper' ? 'Framescaper' : 'Soundscaper';
	return deepFreeze({
		workflowId,
		stage,
		productId: definition.productId,
		plan,
		encodedPlan,
		userDataPath,
		sharedAppDataPath,
		executableCandidates: packagedExecutableCandidates({
			arch: targetArch,
			outputRoot: resolve(output, definition.productId),
			platform,
			productId: definition.productId,
			productName,
		}),
		appArguments: [
			`--user-data-dir=${userDataPath}`,
			'--soundscaper-smoke',
			`--soundscaper-smoke-mode=${DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE}`,
			`--soundscaper-smoke-plan=${encodedPlan}`,
			`--soundscaper-smoke-app-data=${sharedAppDataPath}`,
		],
	});
}

export function parseDesktopProjectLibrarySourceBearingOutput(output, invocation) {
	if (typeof output !== 'string') throw new TypeError('Source-bearing packaged child output must be text');
	if (Buffer.byteLength(output, 'utf8') > MAXIMUM_CHILD_OUTPUT_BYTES) {
		throw new RangeError('Source-bearing packaged child output exceeds its 1 MiB limit');
	}
	if (!invocation?.plan) throw new TypeError('Source-bearing packaged invocation plan is required');
	const matches = output.split(/\r?\n/u)
		.filter((line) => line.startsWith(DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_OUTPUT_PREFIX));
	if (matches.length !== 1) {
		throw new Error('Source-bearing packaged child must emit exactly one handoff result');
	}
	let payload;
	try {
		payload = JSON.parse(matches[0].slice(DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_OUTPUT_PREFIX.length));
	} catch (error) {
		throw new TypeError('Source-bearing packaged child emitted invalid result JSON', { cause: error });
	}
	return validateDesktopProjectLibrarySourceBearingResult(payload, invocation.plan);
}

export function createDesktopProjectLibrarySourceBearingAggregate(results) {
	if (!Array.isArray(results)) throw new TypeError('Source-bearing packaged results must be an array');
	const workflows = [];
	let offset = 0;
	for (const workflow of createDesktopProjectLibrarySourceBearingWorkflows()) {
		let previous = null;
		let fencingToken = 0;
		let catalogRevision = -1;
		const admitted = [];
		for (const definition of workflow.stages) {
			const result = results[offset];
			if (!result) throw new TypeError('Source-bearing packaged handoff result set is incomplete');
			const plan = createDesktopProjectLibrarySourceBearingPlan({
				workflowId: workflow.id,
				stage: definition.stage,
				previous,
			});
			const validated = validateDesktopProjectLibrarySourceBearingResult(result, plan);
			if (validated.host.fencingToken <= fencingToken) {
				throw new Error('Source-bearing packaged handoff fencing tokens must strictly increase');
			}
			if (validated.catalogRevision <= catalogRevision) {
				throw new Error('Source-bearing packaged handoff catalog revisions must strictly increase');
			}
			fencingToken = validated.host.fencingToken;
			catalogRevision = validated.catalogRevision;
			admitted.push(validated);
			previous = { project: validated.project, sources: validated.sources };
			offset += 1;
		}
		const final = admitted.at(-1);
		workflows.push({
			id: workflow.id,
			project: final.project,
			sources: final.sources,
			stages: admitted.map((result) => ({
				stage: result.stage,
				productId: result.productId,
				fencingToken: result.host.fencingToken,
				catalogRevision: result.catalogRevision,
			})),
		});
	}
	if (offset !== results.length) throw new TypeError('Source-bearing packaged handoff result set has extra entries');
	return deepFreeze({
		schemaVersion: 1,
		mode: DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE,
		workflows,
	});
}

export function formatDesktopProjectLibrarySourceBearingAggregate(aggregate) {
	assertAggregateShape(aggregate);
	const line = `${DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_AGGREGATE_PREFIX}${canonicalJson(aggregate)}`;
	if (Buffer.byteLength(line, 'utf8') > MAXIMUM_AGGREGATE_BYTES) {
		throw new RangeError('Source-bearing packaged handoff aggregate exceeds its 64 KiB output limit');
	}
	return line;
}

export async function runDesktopProjectLibrarySourceBearingHandoff({
	repositoryRoot,
	arch = process.env.SOUNDSCAPER_SMOKE_ARCH || process.arch,
	platform = process.platform,
	environment = process.env,
	outputRoot = resolve(repositoryRoot, 'release/desktop-handoff'),
} = {}) {
	const root = absolutePath(repositoryRoot, 'repository root');
	const profileRoot = await mkdtemp(join(tmpdir(), 'scape-source-bearing-handoff-'));
	try {
		const results = [];
		for (const workflow of createDesktopProjectLibrarySourceBearingWorkflows()) {
			let previous = null;
			for (const { stage } of workflow.stages) {
				const invocation = createDesktopProjectLibrarySourceBearingInvocation({
					arch, outputRoot, platform, profileRoot, workflowId: workflow.id, stage, previous,
				});
				const executable = await findPackagedExecutable(invocation);
				const useXvfb = platform === 'linux' && environment.SOUNDSCAPER_SMOKE_XVFB === 'true';
				const command = useXvfb ? 'xvfb-run' : executable;
				const args = useXvfb
					? ['-a', executable, ...invocation.appArguments]
					: invocation.appArguments;
				const childEnvironment = { ...environment };
				delete childEnvironment.ELECTRON_RUN_AS_NODE;
				delete childEnvironment.SCAPE_PRODUCT;
				const child = await runBoundedChild(command, args, {
					cwd: root,
					environment: childEnvironment,
				});
				if (child.code !== 0) {
					throw new Error(
						`Packaged ${invocation.productId} ${stage} source-bearing handoff exited with code ${String(child.code)}.\n${child.output}`,
					);
				}
				const result = parseDesktopProjectLibrarySourceBearingOutput(child.output, invocation);
				results.push(result);
				previous = { project: result.project, sources: result.sources };
			}
		}
		return createDesktopProjectLibrarySourceBearingAggregate(results);
	} finally {
		await rm(profileRoot, { recursive: true, force: true });
	}
}

async function findPackagedExecutable(invocation) {
	for (const candidate of invocation.executableCandidates) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Try the next electron-builder output convention.
		}
	}
	throw new Error(`No packaged ${invocation.productId} executable was found for the source-bearing handoff`);
}

function runBoundedChild(command, args, { cwd, environment }) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, { cwd, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		let failure = null;
		let settled = false;
		const append = (chunk) => {
			if (failure) return;
			output += String(chunk);
			if (Buffer.byteLength(output, 'utf8') <= MAXIMUM_CHILD_OUTPUT_BYTES) return;
			failure = new RangeError('Source-bearing packaged child output exceeds its 1 MiB limit');
			child.kill();
		};
		child.stdout.on('data', append);
		child.stderr.on('data', append);
		let timeout;
		child.once('error', (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			reject(error);
		});
		timeout = setTimeout(() => {
			failure = new Error('Source-bearing packaged child timed out after 45 seconds');
			child.kill();
		}, CHILD_TIMEOUT_MS);
		child.once('exit', (code, signal) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (failure) return reject(failure);
			if (signal) return reject(new Error(`Source-bearing packaged child exited with signal ${signal}`));
			resolvePromise({ code, output });
		});
	});
}

function assertAggregateShape(aggregate) {
	if (!aggregate || aggregate.schemaVersion !== 1
		|| aggregate.mode !== DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE
		|| !Array.isArray(aggregate.workflows) || aggregate.workflows.length !== 2) {
		throw new TypeError('Source-bearing packaged handoff aggregate is invalid');
	}
	for (const [index, expected] of createDesktopProjectLibrarySourceBearingWorkflows().entries()) {
		const workflow = aggregate.workflows[index];
		if (workflow?.id !== expected.id || !workflow.project
			|| !Array.isArray(workflow.sources) || workflow.sources.length !== 2
			|| !Array.isArray(workflow.stages) || workflow.stages.length !== 3
			|| workflow.stages.some((stage, stageIndex) => (
				stage?.stage !== expected.stages[stageIndex].stage
				|| stage?.productId !== expected.stages[stageIndex].productId
			))) {
			throw new TypeError('Source-bearing packaged handoff aggregate workflow is invalid');
		}
	}
}

function absolutePath(value, label) {
	if (typeof value !== 'string' || !value || value.includes('\0')) {
		throw new TypeError(`Source-bearing packaged handoff ${label} is required`);
	}
	const path = resolve(value);
	if (path !== value) throw new TypeError(`Source-bearing packaged handoff ${label} must be absolute`);
	return path;
}

function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) deepFreeze(child);
	return value;
}
