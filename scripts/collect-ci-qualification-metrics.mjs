#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	HOSTED_CI_ENVIRONMENT_ID,
	createCiQualificationMetricsEvidence,
	hostedCiMetricSpecs,
} from './lib/ci-qualification-metrics.mjs';

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONFIG_PATH = resolve(REPOSITORY_ROOT, 'config/quality-budgets.json');
const DEFAULT_OUTPUT_DIRECTORY = 'test-results/ci-qualification-metrics';

// One Playwright invocation per spec, exactly as the standalone collectors
// already run them. Batching them into a single invocation lets one spec's
// timing and storage disturb the next: the preview benchmark passes alone and
// loses its clip-properties surface when it shares a run.
const METRIC_SPECS = hostedCiMetricSpecs();

const COLLECTION_VARIABLES = Object.freeze({
	AUDIO_EDITOR_FFMPEG_BROWSER: '1',
	SOUNDSCAPER_M1_OBSERVED_ENVIRONMENT_ID: HOSTED_CI_ENVIRONMENT_ID,
	SOUNDSCAPER_M3_LONGFORM_BENCHMARK: '1',
	SOUNDSCAPER_M3_OBSERVED_ENVIRONMENT_ID: HOSTED_CI_ENVIRONMENT_ID,
	SOUNDSCAPER_M4B2_KEYFRAME_PARITY: '1',
	SOUNDSCAPER_M4_OBSERVED_ENVIRONMENT_ID: HOSTED_CI_ENVIRONMENT_ID,
	SOUNDSCAPER_M4_PRODUCTION_PARITY: '1',
	SOUNDSCAPER_VIDEO_PREVIEW_BENCHMARK: '1',
});

/** Run the four opt-in metric specs once and publish their hosted-CI evidence. */
export async function collectCiQualificationMetrics(options, dependencies = {}) {
	const { outputDirectory, allowLocal } = options;
	if (typeof outputDirectory !== 'string' || outputDirectory.length === 0) {
		throw new TypeError('Hosted CI metrics output directory must be a non-empty string.');
	}
	const processEnvironment = dependencies.processEnvironment ?? process.env;
	if (!allowLocal && processEnvironment.GITHUB_ACTIONS !== 'true') {
		throw new Error('Hosted CI metrics collection runs on a GitHub runner; pass --allow-local to rehearse it.');
	}
	const runRoot = resolve(REPOSITORY_ROOT, outputDirectory);
	await mkdir(dirname(runRoot), { recursive: true });
	await mkdir(runRoot, { recursive: false });
	const runPlaywright = dependencies.runPlaywright ?? runMetricSpecs;
	const { consoleOutput, exit } = await runPlaywright(processEnvironment);
	const configBytes = dependencies.configBytes ?? await readFile(CONFIG_PATH);
	const evidence = createCiQualificationMetricsEvidence({
		consoleOutput,
		config: JSON.parse(configBytes.toString('utf8')),
		sourceRevision: resolveSourceRevision(processEnvironment),
		budgetSha256: createHash('sha256').update(configBytes).digest('hex'),
		playwrightExit: exit,
	});
	await Promise.all([
		writeFile(resolve(runRoot, 'console.log'), consoleOutput, { flag: 'wx' }),
		writeFile(resolve(runRoot, 'raw.json'), `${JSON.stringify(evidence.raw, null, '\t')}\n`, { flag: 'wx' }),
		writeFile(resolve(runRoot, 'summary.json'), `${JSON.stringify(evidence.summary, null, '\t')}\n`, { flag: 'wx' }),
	]);
	return Object.freeze({ ...evidence, runRoot });
}

export function parseCiQualificationMetricsCliOptions(argv) {
	if (!Array.isArray(argv) || argv.some((value) => typeof value !== 'string')) {
		throw new TypeError('Hosted CI metrics CLI arguments must be strings.');
	}
	let outputDirectory = null;
	let allowLocal = false;
	for (const argument of argv) {
		if (argument === '--allow-local') {
			if (allowLocal) throw new Error('Repeated --allow-local option.');
			allowLocal = true;
			continue;
		}
		if (argument.startsWith('-')) throw new Error(`Unknown hosted CI metrics option ${argument}.`);
		if (outputDirectory !== null) throw new Error('Hosted CI metrics collection accepts one output directory.');
		outputDirectory = argument;
	}
	return Object.freeze({ outputDirectory: outputDirectory ?? DEFAULT_OUTPUT_DIRECTORY, allowLocal });
}

// A GitHub run always knows its own commit; a local rehearsal may not, and the
// evidence records `null` rather than inventing one.
function resolveSourceRevision(processEnvironment) {
	const revision = processEnvironment.GITHUB_SHA;
	return typeof revision === 'string' && /^[a-f\d]{40}$/u.test(revision) ? revision : null;
}

async function runMetricSpecs(processEnvironment) {
	const transcripts = [];
	let exit = { code: 0, signal: null };
	for (const spec of METRIC_SPECS) {
		const run = await runMetricSpec(spec, processEnvironment);
		transcripts.push(`=== ${spec} ===\n${run.consoleOutput}`);
		// The first non-zero exit is the one worth reporting; later specs still
		// run so a single broken spec cannot hide the other three diagnostics.
		if (exit.code === 0 && exit.signal === null) exit = run.exit;
	}
	return { consoleOutput: transcripts.join('\n'), exit };
}

async function runMetricSpec(spec, processEnvironment) {
	const args = ['run', 'test:browser:built', '--', spec, '--project=chromium', '--workers=1', '--retries=0'];
	const invocation = {
		cwd: REPOSITORY_ROOT,
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024,
		env: { ...processEnvironment, ...COLLECTION_VARIABLES },
	};
	try {
		const { stdout, stderr } = await execFileAsync('npm', args, invocation);
		return { consoleOutput: `${stdout}\n${stderr}`, exit: { code: 0, signal: null } };
	} catch (error) {
		return {
			consoleOutput: `${error.stdout ?? ''}\n${error.stderr ?? ''}`,
			exit: { code: typeof error.code === 'number' ? error.code : 1, signal: error.signal ?? null },
		};
	}
}

function isMainModule() {
	return process.argv[1] !== undefined
		&& pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
	collectCiQualificationMetrics(parseCiQualificationMetricsCliOptions(process.argv.slice(2)))
		.then((evidence) => {
			for (const workload of evidence.summary.workloads) {
				console.log(`${workload.diagnosticKey} (${workload.gate}): ${workload.status}`);
			}
			for (const skipped of evidence.summary.notAttempted) {
				console.log(`not attempted: ${skipped.diagnosticKey}: ${skipped.reason}`);
			}
			for (const observation of evidence.summary.observations) console.log(`observation: ${observation}`);
			for (const failure of evidence.summary.failures) console.error(`failure: ${failure}`);
			console.log(`Hosted CI qualification metrics written to ${evidence.runRoot}`);
			process.exitCode = evidence.passed ? 0 : 1;
		})
		.catch((error) => {
			console.error(`Hosted CI qualification metrics collection failed: ${error.message}`);
			process.exitCode = 1;
		});
}
