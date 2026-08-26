#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Verifies conversion recipes, or audits a retained external evidence bundle. */

import { readFile } from 'node:fs/promises';

import executionRegisterValue from '../../config/milestone-7-model-conversion-execution.json' with { type: 'json' };
import parityFixtureValue from '../../config/milestone-7-model-parity-fixtures.json' with { type: 'json' };
import modelSupplyValue from '../../config/milestone-7-model-supply-candidates.json' with { type: 'json' };
import {
	canonicalMilestone7ConversionExecutionPlan,
	validateMilestone7ConversionEvidence,
	validateMilestone7ConversionExecutionRegister,
	verifyPinnedConversionEvidenceFiles,
} from './milestone-7-conversion-execution.mjs';

const register = validateMilestone7ConversionExecutionRegister(
	executionRegisterValue, modelSupplyValue, parityFixtureValue,
);

const arguments_ = process.argv.slice(2);
if (arguments_.length === 0) {
	write({
		schemaVersion: 1,
		registerId: register.registerId,
		recipes: register.recipes.map((recipe) => ({
			candidateId: recipe.candidateId,
			status: recipe.evidenceStatus,
			blockedBy: recipe.blockedBy,
			executionPlanSha256:
				canonicalMilestone7ConversionExecutionPlan(register, recipe.candidateId).sha256,
			commands: recipe.commands.map(({ id, sha256 }) => ({ id, sha256 })),
			outputArtifacts: recipe.outputManifest.artifacts.map((artifact) => ({
				role: artifact.role,
				fileName: artifact.fileName,
				byteLength: artifact.byteLength,
				sha256: artifact.sha256,
			})),
			parityStatus: recipe.parity.status,
		})),
	});
} else {
	const options = parseOptions(arguments_);
	const evidence = JSON.parse(await readFile(options.bundlePath, 'utf8'));
	const admitted = validateMilestone7ConversionEvidence(evidence, {
		executionRegister: register,
		modelSupply: modelSupplyValue,
		parityFixtures: parityFixtureValue,
	});
	await verifyPinnedConversionEvidenceFiles(options.rootPath, admitted.files);
	write({
		schemaVersion: 1,
		candidateId: admitted.candidateId,
		status: 'verified',
		executionPlanSha256: admitted.executionPlanSha256,
		verifiedFiles: admitted.files.length,
	});
}

function parseOptions(value) {
	if (value.length !== 4 || value[0] !== '--bundle' || value[2] !== '--root'
		|| value[1].length === 0 || value[3].length === 0) {
		throw new TypeError('Usage: verify-milestone-7-conversion-execution.mjs --bundle FILE --root DIRECTORY');
	}
	return { bundlePath: value[1], rootPath: value[3] };
}

function write(value) {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
