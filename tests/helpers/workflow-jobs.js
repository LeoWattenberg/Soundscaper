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
	return new Set([...job.matchAll(NPM_RUN)].map((match) => match[1]));
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
