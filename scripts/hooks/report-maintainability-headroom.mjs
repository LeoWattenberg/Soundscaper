#!/usr/bin/env node

/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

import { isMaintainedSourceFile } from '../lib/maintained-source-policy.mjs';
import {
	assessFile,
	loadMaintainabilityConfig,
} from '../lib/maintainability-ceiling.mjs';
import { sourceLineCount } from '../lib/source-line-count.mjs';

/**
 * PostToolUse hook: report how much room an edited file has left under the size ceiling.
 *
 * Agents used to learn a file was oversized only when the quality gate failed, long after
 * the code was written, which made splitting it a separate repair commit rather than part
 * of the work. Reporting the headroom at the moment of the edit turns the ceiling from a
 * cliff into a gradient. It never blocks: the message is advice, and the gate is still the
 * thing that enforces the policy.
 */

const root = resolve(import.meta.dirname, '..', '..');

/** The advice for one edited file, or null when it is nowhere near its ceiling. */
export function headroomAdvice(filePath, readFile = (path) => readFileSync(path, 'utf8')) {
	const absolute = resolve(root, filePath);
	const repositoryPath = relative(root, absolute).split(sep).join('/');
	if (repositoryPath.startsWith('..') || !isMaintainedSourceFile(repositoryPath)) return null;
	const config = loadMaintainabilityConfig(root);
	const assessment = assessFile(repositoryPath, sourceLineCount(readFile(absolute)), config);
	const { status, lines, ceiling, ratchet } = assessment;
	if (status === 'over-ceiling') {
		return `${repositoryPath} is ${lines} lines and has passed the ${ceiling}-line maintainability ceiling. `
			+ 'npm run check:architecture will fail until it is split; extract a focused module now, as part of this change.';
	}
	if (status === 'over-ratchet') {
		return `${repositoryPath} is ${lines} lines and has passed its allowlist ratchet of ${ratchet}. `
			+ 'npm run check:architecture will fail until it shrinks; extract a focused module now, as part of this change.';
	}
	if (status === 'near-ceiling') {
		return lines === ceiling
			? `${repositoryPath} is ${lines} lines, exactly on the ${ceiling}-line maintainability ceiling. `
				+ 'Any further line fails npm run check:architecture; extract a focused module before adding one.'
			: `${repositoryPath} is ${lines} lines, ${ceiling - lines} below the ${ceiling}-line maintainability ceiling. `
				+ 'Extract a focused module rather than filling the remaining room.';
	}
	return null;
}

/** The hook payload for an advice string, in the shape PostToolUse reads. */
export function hookOutput(advice) {
	return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: advice } };
}

async function main() {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
	const filePath = payload.tool_response?.filePath ?? payload.tool_input?.file_path;
	if (typeof filePath !== 'string' || !filePath) return;
	const advice = headroomAdvice(filePath);
	if (advice) process.stdout.write(JSON.stringify(hookOutput(advice)));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
	// A hook must never break the edit it reports on, so every failure here is silent.
	main().catch(() => {});
}
