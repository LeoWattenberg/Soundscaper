/* SPDX-License-Identifier: AGPL-3.0-only */

import { isDeepStrictEqual } from 'node:util';

import {
	M6_REFERENCE_MASTER_ENVIRONMENT_IDS,
	M6_REFERENCE_MASTER_FIXTURE_IDS,
	M6_REFERENCE_MASTER_METRIC_IDS,
	M6_REFERENCE_MASTER_WORKLOAD_ID,
} from './m6-reference-master-metrics.mjs';
import { isRecord, requireRecord } from './measurement-admission.mjs';

export function assertPendingConfigDoesNotClaimQualification(configValue) {
	const config = requireRecord(configValue, 'current quality config');
	const workload = exactDescriptor(config.workloads, M6_REFERENCE_MASTER_WORKLOAD_ID, 'current workload');
	if (workload.status === 'qualified'
		|| config.qualification?.qualifiedWorkloadIds?.includes(M6_REFERENCE_MASTER_WORKLOAD_ID)) {
		throw new Error('Pending Milestone 6 evidence cannot coexist with a qualified workload claim.');
	}
}

export function assertCurrentConfigFinalQualification(configValue) {
	const config = requireRecord(configValue, 'current quality config');
	const workload = exactDescriptor(config.workloads, M6_REFERENCE_MASTER_WORKLOAD_ID, 'current workload');
	const fixtures = M6_REFERENCE_MASTER_FIXTURE_IDS.map(
		(id) => exactDescriptor(config.fixtures, id, 'current fixture'),
	);
	if (!isDeepStrictEqual(workload.fixtureIds, [...M6_REFERENCE_MASTER_FIXTURE_IDS])
		|| !isDeepStrictEqual(workload.environmentIds, [...M6_REFERENCE_MASTER_ENVIRONMENT_IDS])
		|| !isDeepStrictEqual(
			workload.thresholds?.map(({ metricId }) => metricId), [...M6_REFERENCE_MASTER_METRIC_IDS],
		)
		|| workload.status !== 'qualified'
		|| fixtures.some(({ status }) => status !== 'qualified')
		|| !config.qualification?.qualifiedWorkloadIds?.includes(M6_REFERENCE_MASTER_WORKLOAD_ID)) {
		throw new Error('Accepted Milestone 6 evidence requires final current qualified workload registration.');
	}
}

function exactDescriptor(values, id, label) {
	const matches = Array.isArray(values)
		? values.filter((value) => isRecord(value) && value.id === id)
		: [];
	if (matches.length !== 1) throw new Error(`${label} ${id} must occur exactly once.`);
	return matches[0];
}
