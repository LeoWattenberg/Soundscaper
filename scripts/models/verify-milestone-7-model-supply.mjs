#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Verifies candidate pins, recipes, and fixture bytes without fetching or converting models. */

import { createHash } from 'node:crypto';

import parityFixtureRegister from '../../config/milestone-7-model-parity-fixtures.json' with { type: 'json' };
import modelSupplyRegister from '../../config/milestone-7-model-supply-candidates.json' with { type: 'json' };
import runtimeSupplyRegister from '../../config/assistance-runtime-family-supply-candidates.json' with { type: 'json' };
import {
	canonicalMilestone7ConversionPlan,
	validateMilestone7ModelSupplyRegister,
	validateMilestone7ParityFixtureRegister,
} from './milestone-7-model-supply.mjs';
import { createMilestone7ParityFixture } from './milestone-7-parity-fixtures.mjs';
import { validateMilestone7RuntimeSupplyRegister } from './milestone-7-runtime-supply.mjs';

const supply = validateMilestone7ModelSupplyRegister(modelSupplyRegister);
const parity = validateMilestone7ParityFixtureRegister(parityFixtureRegister, supply);
const runtimes = validateMilestone7RuntimeSupplyRegister(runtimeSupplyRegister);

for (const fixture of parity.fixtures) {
	const bytes = createMilestone7ParityFixture(fixture.generator);
	const digest = createHash('sha256').update(bytes).digest('hex');
	if (bytes.byteLength !== fixture.input.byteLength || digest !== fixture.input.sha256) {
		throw new Error(`Parity fixture ${fixture.id} no longer matches its exact input identity.`);
	}
}

const report = Object.freeze({
	schemaVersion: 1,
	registerId: supply.registerId,
	productionCatalogChanged: supply.productionCatalogChanged,
	candidates: supply.candidates.map((candidate) => Object.freeze({
		id: candidate.id,
		sourceStatus: candidate.sourceStatus,
		status: candidate.conversion.status,
		recipeSha256: canonicalMilestone7ConversionPlan(supply, candidate.id).sha256,
		blockedBy: candidate.conversion.blockedBy,
	})),
	parityFixtures: parity.fixtures.map((fixture) => Object.freeze({
		id: fixture.id,
		candidateId: fixture.candidateId,
		status: fixture.evidenceStatus,
		blockedBy: fixture.blockedBy,
	})),
	directPins: supply.directPins.map((pin) => Object.freeze({
		id: pin.id,
		status: pin.activationStatus,
		blockedBy: pin.blockedBy,
	})),
	runtimeFamilies: Object.values(runtimes.manifests).map((manifest) => Object.freeze({
		id: manifest.familyId,
		status: 'pending-external',
		pendingTargets: manifest.targets.length,
	})),
	sherpaWindowsArm64: Object.freeze({
		status: runtimes.sherpaWindowsArm64.payloadStatus,
		blockedBy: runtimes.sherpaWindowsArm64.blockedBy,
	}),
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
