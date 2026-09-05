#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	STARTUP_GRAPH_BUDGET_CONFIGURATION_URL,
	STARTUP_GRAPH_REPORT_FILE,
} from './lib/startup-graph-budget.mjs';

/**
 * Byte ceilings ratchet down; request ceilings never do.
 *
 * A graph that shrinks should keep the win, which is what makes the byte
 * ceilings a ratchet rather than a high-water mark nobody lowers. Requests are
 * deliberately excluded: splitting a file adds a chunk by construction, so a
 * request ceiling tightened to the measured graph would fail the very
 * file-splitting the maintainability guard asks for. Raising a request ceiling
 * stays a deliberate, reasoned edit to the configuration.
 */
export const STARTUP_GRAPH_TIGHTENED_METRICS = Object.freeze(['rawBytes', 'brotliBytes']);

/** The headroom a tightened ceiling keeps over the measurement it was set from. */
export const STARTUP_GRAPH_TIGHTEN_HEADROOM = 1.05;

/**
 * @param {Record<string, { ceilings: Record<string, number>, reasons: Record<string, string> }>} configuration
 * @param {{ product?: string, graphs?: Record<string, Record<string, number>> }} report
 * @param {{ headroom?: number }} [options]
 */
export function tightenStartupGraphBudgets(configuration, report, { headroom = STARTUP_GRAPH_TIGHTEN_HEADROOM } = {}) {
	const graphs = report?.graphs;
	if (!graphs || typeof graphs !== 'object') {
		throw new TypeError('A startup graph report must carry the observed graphs of a completed build.');
	}
	if (Object.keys(graphs).length === 0) {
		throw new RangeError('The startup graph report has no measured startup graphs; build before tightening.');
	}

	const tightened = { ...configuration };
	const changes = [];
	for (const [graph, observation] of Object.entries(graphs)) {
		const budget = configuration[graph];
		if (!budget) throw new RangeError(`The startup graph report measures an unbudgeted graph: ${graph}.`);
		const ceilings = { ...budget.ceilings };
		let lowered = false;
		for (const metric of STARTUP_GRAPH_TIGHTENED_METRICS) {
			const ceiling = ceilings[metric];
			const observed = observation[metric];
			if (typeof ceiling !== 'number' || typeof observed !== 'number') continue;
			const candidate = Math.ceil(observed * headroom);
			if (candidate >= ceiling) continue;
			ceilings[metric] = candidate;
			lowered = true;
			changes.push({ graph, metric, observed, from: ceiling, to: candidate });
		}
		if (lowered) tightened[graph] = { ...budget, ceilings };
	}
	return { configuration: tightened, changes };
}

/**
 * @param {readonly string[]} argv
 */
export function parseTightenArguments(argv) {
	let reportPath = null;
	for (const argument of argv) {
		const match = /^--report=(.+)$/u.exec(argument);
		if (!match) throw new RangeError(`Unknown startup graph tighten argument: ${argument}`);
		reportPath = match[1];
	}
	return { reportPath };
}

function main(argv) {
	const { reportPath } = parseTightenArguments(argv);
	const repositoryRoot = resolve(import.meta.dirname, '..');
	const path = reportPath === null
		? join(repositoryRoot, 'dist', STARTUP_GRAPH_REPORT_FILE)
		: resolve(repositoryRoot, reportPath);
	if (!existsSync(path)) {
		throw new Error(
			`No startup graph report at ${path}. Run the production build first; every build writes one beside its bundle.`,
		);
	}
	const configurationPath = fileURLToPath(STARTUP_GRAPH_BUDGET_CONFIGURATION_URL);
	const configuration = JSON.parse(readFileSync(configurationPath, 'utf8'));
	const report = JSON.parse(readFileSync(path, 'utf8'));
	const { configuration: tightened, changes } = tightenStartupGraphBudgets(configuration, report);
	if (changes.length === 0) {
		console.log(`No startup graph byte ceiling has room to tighten against ${path}.`);
		return;
	}
	writeFileSync(configurationPath, `${JSON.stringify(tightened, null, '\t')}\n`);
	console.log(`Tightened ${changes.length} startup graph byte ceiling(s) against ${path}:`);
	for (const { graph, metric, observed, from, to } of changes) {
		console.log(`  ${graph}.${metric}: ${from.toLocaleString('en-US')} -> ${to.toLocaleString('en-US')}`
			+ ` (measured ${observed.toLocaleString('en-US')})`);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2));
}
