/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectFeatureRequirementsReport } from '../project-feature-requirements.ts';
import type { ScapeProjectInput } from '../scape-project-input.ts';
import type { EditorControllerLifetime } from './lifecycle.ts';
import { createProjectFeatureCompatibilityService } from './project-feature-compatibility-service.ts';
import {
	createScapeInspectionService,
	type ScapeInspectionOptions,
	type ScapeInspectionStore,
	type ScapeProjectInspector,
} from './scape-inspection-service.ts';
import {
	createScapeInspectionQuiescence,
	type ScapeInspectionQuiescence,
	type ScapeInspectionQuiescenceOptions,
} from './scape-inspection-quiescence.ts';
import {
	createScapeOpenRequestService,
	type ScapeOpenInspection,
	type ScapeOpenDecisionRequester,
	type ScapeOpenRequestOptions,
} from './scape-open-request-service.ts';

export interface ScapeProjectInspection extends ScapeOpenInspection {
	readonly id: string;
	readonly title: string;
	readonly schemaVersion: number;
	readonly readOnly: boolean;
	readonly manifest: Readonly<Record<string, unknown>>;
	readonly featureRequirementsCompatibility: ProjectFeatureRequirementsReport | null;
}

export interface ScapeProjectFileServiceRuntime<
	Inspection extends ScapeOpenInspection,
	Result,
> {
	readonly lifetime: Pick<EditorControllerLifetime, 'startTask'>;
	readonly scapeInspectionQuiescence?: ScapeInspectionQuiescence;
	readonly scapeInspectionQuiescenceOptions?: ScapeInspectionQuiescenceOptions;
	readonly store: ScapeInspectionStore | null;
	readonly productCapabilities: Readonly<Record<string, unknown>>;
	readonly inspectScapeProject?: ScapeProjectInspector<Inspection>;
	readonly openScape: (
		file: ScapeProjectInput,
		options: Readonly<{
			collision: 'copy' | 'replace';
			signal: AbortSignal;
		}>,
	) => PromiseLike<Result> | Result;
}

export function createScapeProjectFileService<
	Inspection extends ScapeOpenInspection = ScapeProjectInspection,
	Result = unknown,
>(runtime: ScapeProjectFileServiceRuntime<Inspection, Result>) {
	const scapeInspectionQuiescence = runtime.scapeInspectionQuiescence
		?? createScapeInspectionQuiescence(runtime.scapeInspectionQuiescenceOptions);
	const projectFeatureCompatibility = createProjectFeatureCompatibilityService(runtime.productCapabilities);
	const inspectionService = createScapeInspectionService<Inspection>({
		lifetime: runtime.lifetime,
		scapeInspectionQuiescence,
		store: runtime.store,
		providerOptions: { projectFeatureCompatibility },
		inspectScapeProject: runtime.inspectScapeProject,
	});
	const openRequestService = createScapeOpenRequestService<Inspection, Result>({
		lifetime: runtime.lifetime,
		inspectScape: inspectionService.inspect,
		openScape: runtime.openScape,
	});
	return Object.freeze({
		inspectScape: inspectionService.inspect,
		openScapeFile: openRequestService.openScapeFile,
		scapeInspectionQuiescence,
	});
}

export type ScapeProjectFileInspectOptions = ScapeInspectionOptions;
export type ScapeProjectFileOpenOptions = ScapeOpenRequestOptions;
export type ScapeProjectOpenDecisionRequester<Inspection extends ScapeOpenInspection> =
	ScapeOpenDecisionRequester<Inspection>;
