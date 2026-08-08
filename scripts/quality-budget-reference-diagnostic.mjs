/* SPDX-License-Identifier: AGPL-3.0-only */

import { writeStructuralQualityBudgetEvidence } from './quality-budget-evidence.mjs';

export async function collectReferenceDiagnosticEvidence(options, dependencies = {}) {
	const writeEvidence = dependencies.writeEvidence ?? writeStructuralQualityBudgetEvidence;
	const { stdout, stderr } = await dependencies.runReference();
	const diagnostic = parseReferenceDiagnostic(`${stdout}\n${stderr}`, options);
	const { budgetMetrics, workloadId: _workloadId, ...observations } = diagnostic;
	return writeEvidence({
		configPath: options.configPath,
		outputDirectory: options.outputDirectory,
		workloadId: options.workloadId,
		metrics: budgetMetrics,
		observations,
	});
}

export function parseReferenceDiagnostic(output, identity) {
	const matches = [];
	for (const line of output.split(/\r?\n/u)) {
		const jsonStart = line.indexOf('{');
		if (jsonStart < 0) continue;
		let candidate;
		try {
			candidate = JSON.parse(line.slice(jsonStart));
		} catch {
			continue;
		}
		if (isRecord(candidate)
			&& candidate.profile === identity.profile
			&& candidate.workloadId === identity.workloadId
			&& candidate.fixtureId === identity.workloadId) matches.push(candidate);
	}
	if (matches.length !== 1) {
		throw new Error(
			`Expected exactly one ${identity.workloadId} reference diagnostic; received ${matches.length}.`,
		);
	}
	return matches[0];
}

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
