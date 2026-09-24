/* SPDX-License-Identifier: AGPL-3.0-only */

import { lstatSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, resolve } from 'node:path';

const require = createRequire(import.meta.url);

export const NATIVE_PAYLOAD_PRODUCERS_PATH = 'config/native-payload-producers.json';

const TARGETS = Object.freeze([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
]);
const CI_FIELDS = Object.freeze([
	'id', 'manifestPaths', 'workflowPath', 'dispatchWorkflowPath', 'buildCommand',
	'stageCommand', 'sourceCommands', 'runners', 'artifactPrefix',
]);
const PACKAGE_FIELDS = Object.freeze([
	'id', 'manifestPath', 'manifestTargetPath', 'targets', 'workflowPath',
	'packageCommand', 'pipelinePaths',
]);
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z\d._/-]+$/u;
const SAFE_TARGET_PATH = /^[A-Za-z\d-]+(?:\.[A-Za-z\d-]+)*$/u;
const PACKAGE_TARGET_PARTS = Object.freeze({
	'linux-x64': Object.freeze({ platform: 'linux', arch: 'x64' }),
	'linux-arm64': Object.freeze({ platform: 'linux', arch: 'arm64' }),
	'mac-arm64': Object.freeze({ platform: 'mac', arch: 'arm64' }),
	'win-x64': Object.freeze({ platform: 'win', arch: 'x64' }),
	'win-arm64': Object.freeze({ platform: 'win', arch: 'arm64' }),
});
const NIGHTLY_TARGET_MATRIX_HELPER = 'scripts/lib/desktop-nightly-tests-target-matrix.mjs';
const NIGHTLY_TARGET_MATRIX_REFERENCE = 'target: ${{ fromJSON(needs.nightly-test-targets.outputs.targets) }}';
const NIGHTLY_EXPECTED_ALL = Object.freeze([
	Object.freeze({ runner: 'windows-2025', platform: 'win', arch: 'x64', node_arch: 'x64' }),
	Object.freeze({ runner: 'windows-11-arm', platform: 'win', arch: 'arm64', node_arch: 'x64' }),
	Object.freeze({ runner: 'macos-15', platform: 'mac', arch: 'arm64', node_arch: 'arm64' }),
	Object.freeze({ runner: 'ubuntu-22.04', platform: 'linux', arch: 'x64', node_arch: 'x64' }),
	Object.freeze({ runner: 'ubuntu-24.04-arm', platform: 'linux', arch: 'arm64', node_arch: 'arm64' }),
]);

export function auditNativePayloadProducers(repositoryRoot) {
	const root = resolve(repositoryRoot);
	const findings = [];
	let register;
	try {
		register = JSON.parse(read(root, NATIVE_PAYLOAD_PRODUCERS_PATH));
	} catch (error) {
		return Object.freeze({ status: 'failed', findings: Object.freeze([
			`Native payload producer register is unreadable: ${message(error)}`,
		]) });
	}
	if (!exactKeys(register, ['schemaVersion', 'targets', 'ciProducers', 'packageProducers'])
		|| register.schemaVersion !== 1
		|| JSON.stringify(register.targets) !== JSON.stringify(TARGETS)
		|| !Array.isArray(register.ciProducers) || register.ciProducers.length !== 4
		|| !Array.isArray(register.packageProducers) || register.packageProducers.length !== 4) {
		findings.push('Native payload producer register identity or inventory is invalid.');
	}
	const ids = [...(register.ciProducers ?? []), ...(register.packageProducers ?? [])]
		.map(({ id }) => id);
	if (new Set(ids).size !== ids.length) findings.push('Native payload producer IDs are not unique.');
	for (const producer of register.ciProducers ?? []) auditCiProducer(root, producer, findings);
	for (const producer of register.packageProducers ?? []) auditPackageProducer(root, producer, findings);
	return Object.freeze({
		status: findings.length === 0 ? 'passed' : 'failed',
		findings: Object.freeze(findings),
	});
}

function auditCiProducer(root, producer, findings) {
	if (!exactKeys(producer, CI_FIELDS) || !safeText(producer.id)
		|| !Array.isArray(producer.manifestPaths) || producer.manifestPaths.length < 1
		|| !producer.manifestPaths.every(safePath)
		|| ![producer.workflowPath, producer.dispatchWorkflowPath, producer.buildCommand,
			producer.stageCommand].every(safePath)
		|| !Array.isArray(producer.sourceCommands) || !producer.sourceCommands.every(safePath)
		|| !exactKeys(producer.runners, TARGETS)
		|| !Object.values(producer.runners ?? {}).every(safeText)
		|| !safeText(producer.artifactPrefix)) {
		findings.push(`Native CI producer ${String(producer?.id)} is invalid.`);
		return;
	}
	for (const path of producer.manifestPaths) auditCiManifest(root, producer.id, path, findings);
	const workflowSource = readChecked(root, producer.workflowPath,
		`${producer.id} build workflow`, findings);
	const dispatchSource = readChecked(root, producer.dispatchWorkflowPath,
		`${producer.id} dispatch workflow`, findings);
	const workflow = workflowSource === null ? null : activeYaml(workflowSource);
	const dispatch = dispatchSource === null ? null : activeYaml(dispatchSource);
	readChecked(root, producer.buildCommand, `${producer.id} build command`, findings);
	readChecked(root, producer.stageCommand, `${producer.id} stage command`, findings);
	for (const command of producer.sourceCommands) {
		readChecked(root, command, `${producer.id} source command`, findings);
		if (workflow !== null && dispatch !== null && !`${workflow}\n${dispatch}`.includes(command)) {
			findings.push(`${producer.id} workflows do not invoke source command ${command}.`);
		}
	}
	if (workflow !== null) {
		for (const [target, runner] of Object.entries(producer.runners)) {
			const row = new RegExp(`-\\s+target:\\s*${escapePattern(target)}\\s+runner:\\s*${escapePattern(runner)}(?:\\s|$)`, 'u');
			if (!row.test(workflow)) {
				findings.push(`${producer.id} workflow omits the ${target}/${runner} build row.`);
			}
		}
		if (!workflow.includes(producer.buildCommand)) {
			findings.push(`${producer.id} workflow does not invoke its registered build command.`);
		}
		if (!`${workflow}\n${dispatch ?? ''}`.includes(producer.stageCommand)) {
			findings.push(`${producer.id} workflows do not invoke their registered stage command.`);
		}
		const buildIndex = workflow.indexOf(producer.buildCommand);
		const stageIndex = workflow.indexOf(producer.stageCommand);
		const artifactName = `name: ${producer.artifactPrefix}\${{ matrix.target }}`;
		const artifactIndex = workflow.indexOf(artifactName);
		const uploadIndex = workflow.lastIndexOf('uses: actions/upload-artifact@', artifactIndex);
		if (uploadIndex < 0 || artifactIndex < uploadIndex || buildIndex > uploadIndex) {
			findings.push(`${producer.id} workflow does not publish its registered artifact prefix.`);
		}
		if (stageIndex > uploadIndex) {
			const downloadIndex = workflow.indexOf('uses: actions/download-artifact@', uploadIndex);
			const downloadedArtifact = downloadIndex < 0 ? -1
				: workflow.indexOf(artifactName, downloadIndex);
			if (downloadIndex < uploadIndex || downloadedArtifact < downloadIndex
				|| stageIndex < downloadIndex || !workflow.slice(uploadIndex, stageIndex).includes('needs: build')) {
				findings.push(`${producer.id} staging does not consume its per-target build artifact.`);
			}
		} else if (stageIndex < buildIndex || stageIndex > uploadIndex) {
			findings.push(`${producer.id} staging is not on the build-result publication path.`);
		}
		if (workflow.includes('pending-external')) {
			findings.push(`${producer.id} workflow retains an external-payload state.`);
		}
	}
	if (dispatch !== null && !/workflow_dispatch\s*:/u.test(dispatch)) {
		findings.push(`${producer.id} has no dispatchable repository CI entry point.`);
	}
}

function auditCiManifest(root, producerId, path, findings) {
	const source = readChecked(root, path, `${producerId} manifest`, findings);
	if (source === null) return;
	if (source.includes('pending-external')) {
		findings.push(`${producerId} manifest ${path} retains an external-payload state.`);
	}
	let manifest;
	try { manifest = JSON.parse(source); }
	catch (error) {
		findings.push(`${producerId} manifest ${path} is invalid JSON: ${message(error)}`);
		return;
	}
	const groups = findTargetGroups(manifest);
	if (groups.length === 0) findings.push(`${producerId} manifest ${path} has no target inventory.`);
	for (const group of groups) {
		const targets = Array.isArray(group.value) ? group.value
			: Object.entries(group.value).map(([id, value]) => ({ id, ...value }));
		for (const target of TARGETS) {
			const matches = targets.filter(({ id }) => id === target);
			if (matches.length !== 1 || !['built', 'ci-generated'].includes(matches[0]?.status)) {
				findings.push(`${producerId} manifest ${path} ${group.path} has no built or CI-generated ${target} row.`);
			}
		}
	}
}

function auditPackageProducer(root, producer, findings) {
	if (!exactKeys(producer, PACKAGE_FIELDS) || !safeText(producer.id)
		|| typeof producer.manifestTargetPath !== 'string'
		|| !SAFE_TARGET_PATH.test(producer.manifestTargetPath)
		|| !Array.isArray(producer.targets) || producer.targets.length < 1
		|| new Set(producer.targets).size !== producer.targets.length
		|| !producer.targets.every((target) => TARGETS.includes(target))
		|| ![producer.manifestPath, producer.workflowPath, producer.packageCommand].every(safePath)
		|| !Array.isArray(producer.pipelinePaths) || producer.pipelinePaths.length < 2
		|| producer.pipelinePaths[0] !== producer.packageCommand
		|| !producer.pipelinePaths.every(safePath)) {
		findings.push(`Native package producer ${String(producer?.id)} is invalid.`);
		return;
	}
	const manifestSource = readChecked(root, producer.manifestPath,
		`${producer.id} manifest`, findings);
	const workflowSource = readChecked(root, producer.workflowPath, `${producer.id} workflow`, findings);
	const workflow = workflowSource === null ? null : activeYaml(workflowSource);
	if (manifestSource !== null) {
		try {
			const manifest = JSON.parse(manifestSource);
			const targets = valueAtPath(manifest, producer.manifestTargetPath);
			const rows = Array.isArray(targets) ? targets
				: Object.entries(targets ?? {}).map(([id, value]) => ({ id, ...value }));
			for (const target of producer.targets) {
				const matches = rows.filter(({ id }) => id === target);
				if (matches.length !== 1 || matches[0]?.status !== 'package-generated') {
					findings.push(`${producer.id} is not declared package-generated for ${target}.`);
				}
			}
		} catch (error) {
			findings.push(`${producer.id} manifest is invalid JSON: ${message(error)}`);
		}
	}
	if (workflow !== null) {
		const job = yamlJobContaining(workflow, producer.packageCommand);
		if (job === null) {
			findings.push(`${producer.id} workflow does not invoke its registered package command.`);
		} else {
			auditPackageWorkflowJob(root, producer, job, workflow, findings);
		}
	}
	for (const [index, path] of producer.pipelinePaths.entries()) {
		const source = readChecked(root, path, `${producer.id} pipeline entry`, findings);
		if (source === null || index === producer.pipelinePaths.length - 1) continue;
		const next = producer.pipelinePaths[index + 1];
		if (!activeJavascript(source).includes(basename(next))) {
			findings.push(`${producer.id} pipeline ${path} does not reach ${next}.`);
		}
	}
}

function auditPackageWorkflowJob(root, producer, job, workflow, findings) {
	if (job.includes(NIGHTLY_TARGET_MATRIX_REFERENCE)) {
		auditNightlyTargetMatrix(root, producer, workflow, findings);
	} else {
		for (const target of producer.targets) {
			const { platform, arch } = PACKAGE_TARGET_PARTS[target];
			const row = new RegExp(
				`-\\s+runner:[^\\n]+\\n\\s+platform:\\s*${escapePattern(platform)}\\s*\\n`
				+ `\\s+arch:\\s*${escapePattern(arch)}(?:\\s|$)`, 'u');
			if (!row.test(job)) findings.push(`${producer.id} workflow omits its ${target} package row.`);
		}
	}
	for (const [name, expression] of [
		['platform', 'SOUNDSCAPER_DESKTOP_TARGET_PLATFORM: ${{ matrix.target.platform }}'],
		['architecture', 'SOUNDSCAPER_DESKTOP_TARGET_ARCH: ${{ matrix.target.arch }}'],
	]) {
		if (!job.includes(expression)) {
			findings.push(`${producer.id} package command does not receive its target ${name}.`);
		}
	}
}

function auditNightlyTargetMatrix(root, producer, workflow, findings) {
	const bindings = [
		'targets: ${{ steps.resolve.outputs.targets }}',
		'needs: [nightly-test-targets, quality, tests, coverage, browser, firefox]',
		'NIGHTLY_TEST_TARGETS: ${{ inputs.nightly_tests_targets || \'all\' }}',
		`from './${NIGHTLY_TARGET_MATRIX_HELPER}'`,
		'selectDesktopNightlyTestTargets(process.env.NIGHTLY_TEST_TARGETS)',
	];
	if (!bindings.every((binding) => workflow.includes(binding))) {
		findings.push(`${producer.id} nightly-with-tests target matrix is not bound to its selector.`);
		return;
	}
	if (readChecked(root, NIGHTLY_TARGET_MATRIX_HELPER, 'Nightly target matrix helper', findings) === null) return;
	try {
		const { selectDesktopNightlyTestTargets } = require(resolve(root, NIGHTLY_TARGET_MATRIX_HELPER));
		const all = selectDesktopNightlyTestTargets('all');
		const windows = selectDesktopNightlyTestTargets('windows');
		const winX64 = selectDesktopNightlyTestTargets('win-x64');
		if (JSON.stringify(all) !== JSON.stringify(NIGHTLY_EXPECTED_ALL)
			|| JSON.stringify(windows) !== JSON.stringify(NIGHTLY_EXPECTED_ALL.slice(0, 2))
			|| JSON.stringify(winX64) !== JSON.stringify(NIGHTLY_EXPECTED_ALL.slice(0, 1))) {
			findings.push(`${producer.id} nightly-with-tests target matrix has an incorrect all, Windows, or win-x64 selection.`);
		}
	} catch (error) {
		findings.push(`${producer.id} nightly-with-tests target matrix cannot be evaluated: ${message(error)}`);
	}
}

function yamlJobContaining(source, command) {
	const commandIndex = source.indexOf(command);
	if (commandIndex < 0) return null;
	const prefix = source.slice(0, commandIndex);
	const headings = [...prefix.matchAll(/^ {2}[A-Za-z\d_-]+:\s*$/gmu)];
	const start = headings.at(-1)?.index ?? 0;
	const next = source.slice(commandIndex).match(/^ {2}[A-Za-z\d_-]+:\s*$/mu);
	const end = next?.index === undefined ? source.length : commandIndex + next.index;
	return source.slice(start, end);
}

function findTargetGroups(value, path = '$', result = []) {
	if (value === null || typeof value !== 'object') return result;
	for (const [key, child] of Object.entries(value)) {
		const childPath = `${path}.${key}`;
		if (key === 'targets' && child !== null && typeof child === 'object') {
			result.push({ path: childPath, value: child });
		} else findTargetGroups(child, childPath, result);
	}
	return result;
}

function valueAtPath(value, path) {
	return path.split('.').reduce((current, field) => current?.[field], value);
}

function activeYaml(source) {
	return source.split(/\r?\n/u).map((line) => {
		if (line.trimStart().startsWith('#')) return '';
		return line.replace(/\s+#.*$/u, '');
	}).join('\n');
}

function activeJavascript(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//gu, '')
		.replace(/^\s*\/\/.*$/gmu, '');
}

function readChecked(root, path, label, findings) {
	try { return read(root, path); }
	catch (error) {
		findings.push(`${label} is unreadable: ${message(error)}`);
		return null;
	}
}

function read(root, path) {
	if (!safePath(path)) throw new TypeError(`Unsafe repository path ${String(path)}.`);
	const absolute = resolve(root, path);
	const metadata = lstatSync(absolute);
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		throw new TypeError(`${path} is not a regular repository file.`);
	}
	return readFileSync(absolute, 'utf8');
}

function safePath(value) { return typeof value === 'string' && SAFE_PATH.test(value); }
function safeText(value) { return typeof value === 'string' && value.trim().length > 0; }
function escapePattern(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
function exactKeys(value, keys) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function message(error) { return error instanceof Error ? error.message : String(error); }
