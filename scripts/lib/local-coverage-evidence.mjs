/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { analyzeCoverageSummary } from './coverage-gates.mjs';

/** Keep a local Node run from silently reusing browser evidence from another build. */
export function replaceLocalNodeCoverage(directory, profile) {
	rmSync(directory, { recursive: true, force: true });
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, 'all.json'), JSON.stringify(profile));
}

/** Check that fresh Node evidence covers the production inventory, without applying union floors. */
export function assertLocalNodeCoverageStructure(summary, repositoryRoot) {
	const { failures } = analyzeCoverageSummary(summary, repositoryRoot);
	const structuralFailures = failures.filter((failure) =>
		failure.startsWith('Coverage reported unclassified production files:')
		|| failure.endsWith(' coverage reported no production files.'));
	if (structuralFailures.length > 0) throw new Error(structuralFailures.join('\n'));
}
