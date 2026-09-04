/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';

/**
 * Read GitHub Actions workflows as text.
 *
 * Nothing here parses YAML on purpose: the workflow files are the contract, and
 * the assertions that use these helpers are about what a reader of the file sees
 * — job names, their order, the literal `needs:` edges and the commands each job
 * runs. Slicing the text keeps a failure pointing at the line that has to change.
 */

const ROOT = new URL('../../', import.meta.url);
const NEXT_JOB = /^ {2}[a-z][a-z0-9-]*:\s*$/mu;
const NPM_RUN = /npm run ([\w:-]+)/gu;
const MATRIX_BLOCK = /^ +matrix:\n/mu;

export async function readWorkflow(workflowName) {
	return readFile(new URL(`.github/workflows/${workflowName}`, ROOT), 'utf8');
}

export function extractJob(workflow, jobName) {
	const marker = `\n  ${jobName}:\n`;
	const start = workflow.indexOf(marker);
	if (start === -1) throw new Error(`missing ${jobName} workflow job`);
	const remainder = workflow.slice(start + marker.length);
	const nextJob = remainder.search(NEXT_JOB);
	return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
}

export function npmScriptsRunBy(job) {
	return new Set(matrixExpansionsOf(job).flatMap((text) => [...text.matchAll(NPM_RUN)].map((match) => match[1])));
}

/**
 * A sharded job names its script through the matrix — `npm run typecheck:${{
 * matrix.project }}` — so the text has to be read once per combination or the
 * scripts it runs read as one script that does not exist.
 */
function matrixExpansionsOf(job) {
	let texts = [job];
	for (const [key, values] of scalarMatrixEntries(job)) {
		texts = texts.flatMap((text) => values.map((value) => text.replaceAll(`\${{ matrix.${key} }}`, value)));
	}
	return texts;
}

/** Matrix keys whose values are plain strings; a key holding mappings has no name to substitute. */
function scalarMatrixEntries(job) {
	const block = MATRIX_BLOCK.exec(job);
	if (block === null) return [];
	const lines = job.slice(block.index + block[0].length).split('\n');
	const keyIndent = indentOf(lines[0]);
	const entries = [];
	let open = null;
	for (const line of lines) {
		if (line.trim().length === 0) continue;
		if (indentOf(line) < keyIndent) break;
		if (indentOf(line) > keyIndent) {
			const item = /^ *- ([\w.-]+)$/u.exec(line);
			if (open !== null && item !== null) open[1].push(item[1]);
			continue;
		}
		const inline = /^ *([\w-]+): \[(.+)\]$/u.exec(line);
		if (inline !== null) {
			entries.push([inline[1], inline[2].split(',').map((value) => value.trim())]);
			open = null;
			continue;
		}
		const nested = /^ *([\w-]+):$/u.exec(line);
		open = nested === null ? null : [nested[1], []];
		if (open !== null) entries.push(open);
	}
	return entries.filter(([, values]) => values.length > 0);
}

function indentOf(line) {
	return /^ */u.exec(line)[0].length;
}

/** Expand an npm script to the leaf scripts it ultimately runs. */
export function expandNpmScript(scripts, name, seen = new Set()) {
	if (seen.has(name)) return [];
	seen.add(name);
	const body = scripts[name];
	if (body === undefined) throw new Error(`package.json has no "${name}" script`);
	const referenced = [...body.matchAll(NPM_RUN)].map((match) => match[1]);
	return referenced.length === 0
		? [name]
		: referenced.flatMap((reference) => expandNpmScript(scripts, reference, seen));
}
