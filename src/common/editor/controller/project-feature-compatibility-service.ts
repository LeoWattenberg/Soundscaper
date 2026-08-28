/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	evaluateProjectFeatureRequirements,
	type ProjectFeatureRequirementsManifest,
	type ProjectFeatureRequirementsReport,
} from '../project-feature-requirements.ts';
import { snapshotProjectFeatureCapabilities } from '../project-feature-capabilities.ts';
import {
	PROJECT_SCHEMA_VERSION,
	readProjectSchemaIdentity,
	type ProjectSchemaFamily,
} from '../project-schema-identity.ts';
import { isMaintainedProjectFeatureSchema } from '../project-schema-version.ts';

interface ProjectWithFeatureRequirements {
	readonly schemaFamily?: unknown;
	readonly schemaVersion?: unknown;
	readonly featureRequirements?: unknown;
	readonly sources?: unknown;
	readonly clips?: unknown;
	readonly tracks?: unknown;
	readonly sampleRate?: unknown;
	readonly sequences?: unknown;
	readonly primarySequenceId?: unknown;
}

export interface ProjectFeatureCompatibilityService {
	evaluate(project: unknown): ProjectFeatureRequirementsReport | null;
}

/**
 * Snapshots host-owned product capabilities and evaluates only the maintained
 * outer project schema. Newer project documents remain opaque to this service.
 */
export function createProjectFeatureCompatibilityService(
	capabilities: Readonly<Record<string, unknown>>,
	currentProjectSchemaFamily?: ProjectSchemaFamily,
): ProjectFeatureCompatibilityService {
	const snapshot = snapshotProjectFeatureCapabilities(capabilities);
	const knownFeatureIds = new Set(snapshot.knownFeatureIds);
	const availableFeatureIds = new Set(snapshot.availableFeatureIds);
	return Object.freeze({ evaluate });

	function evaluate(project: unknown): ProjectFeatureRequirementsReport | null {
		if (!project || typeof project !== 'object' || Array.isArray(project)) return null;
		const candidate = project as ProjectWithFeatureRequirements;
		if (currentProjectSchemaFamily === undefined && isMaintainedProjectFeatureSchema(candidate)) {
			return evaluateMaintainedProject(candidate);
		}
		try {
			const identity = readProjectSchemaIdentity(candidate);
			if (identity.schemaVersion !== PROJECT_SCHEMA_VERSION
				|| identity.schemaFamily !== currentProjectSchemaFamily) return null;
		} catch {
			return null;
		}
		return evaluateMaintainedProject(candidate);
	}

	function evaluateMaintainedProject(
		candidate: ProjectWithFeatureRequirements,
	): ProjectFeatureRequirementsReport {
		return evaluateProjectFeatureRequirements(
			candidate.featureRequirements as ProjectFeatureRequirementsManifest,
			{
				knownFeatureIds,
				availableFeatureIds,
				sources: Array.isArray(candidate.sources) ? candidate.sources : [],
				clips: Array.isArray(candidate.clips) ? candidate.clips : [],
				tracks: Array.isArray(candidate.tracks) ? candidate.tracks : [],
				schemaVersion: candidate.schemaVersion,
				sampleRate: candidate.sampleRate,
				sequences: Array.isArray(candidate.sequences) ? candidate.sequences : [],
				primarySequenceId: candidate.primarySequenceId,
			},
		);
	}
}
