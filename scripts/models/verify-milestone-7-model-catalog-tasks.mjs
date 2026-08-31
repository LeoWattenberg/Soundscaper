#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Reports the exact non-activating state of every remaining Milestone 7 catalog task. */

import runtimeSupply from '../../config/assistance-runtime-family-supply-candidates.json' with { type: 'json' };
import checkedCatalog from '../../config/local-model-catalog.json' with { type: 'json' };
import executionRegister from '../../config/milestone-7-model-conversion-execution.json' with { type: 'json' };
import catalogTaskRegister from '../../config/milestone-7-model-catalog-tasks.json' with { type: 'json' };
import parityFixtures from '../../config/milestone-7-model-parity-fixtures.json' with { type: 'json' };
import modelSupply from '../../config/milestone-7-model-supply-candidates.json' with { type: 'json' };
import {
	validateMilestone7ModelCatalogTaskRegister,
} from './milestone-7-model-catalog-tasks.mjs';

if (process.argv.length !== 2) {
	throw new TypeError('The Milestone 7 catalog-task verifier accepts no arguments.');
}

const register = validateMilestone7ModelCatalogTaskRegister(catalogTaskRegister, {
	modelSupply,
	parityFixtures,
	conversionExecution: executionRegister,
	runtimeSupply,
	offeredModelIds: checkedCatalog.entries.map(({ modelId }) => modelId),
});

const report = Object.freeze({
	schemaVersion: 1,
	registerId: register.registerId,
	productionCatalogChanged: register.productionCatalogChanged,
	tasks: register.tasks.map((task) => Object.freeze({
		catalogModelId: task.catalogModelId,
		version: task.version,
		task: task.task,
		installTier: task.installTier,
		runtimeFamily: task.runtimeFamily,
		catalogStatus: task.catalogStatus,
		catalogBlockedBy: task.catalogBlockedBy,
		activationStatus: task.activationStatus,
		activationBlockedBy: task.activationBlockedBy,
		artifacts: task.artifacts.map((artifact) => Object.freeze({
			role: artifact.role,
			fileName: artifact.distributionFileName,
			byteLength: artifact.byteLength,
			sha256: artifact.sha256,
		})),
	})),
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
