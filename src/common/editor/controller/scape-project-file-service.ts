/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorControllerLifetime } from './lifecycle.ts';
import {
	createScapeInspectionService,
	type ScapeInspectionOptions,
	type ScapeInspectionStore,
	type ScapeProjectInspector,
} from './scape-inspection-service.ts';
import {
	createScapeOpenRequestService,
	type ScapeCollisionRequester,
	type ScapeOpenInspection,
	type ScapeOpenRequestOptions,
} from './scape-open-request-service.ts';

export interface ScapeProjectInspection extends ScapeOpenInspection {
	readonly id: string;
	readonly title: string;
	readonly schemaVersion: number;
	readonly readOnly: boolean;
	readonly manifest: Readonly<Record<string, unknown>>;
}

export interface ScapeProjectFileServiceRuntime<
	Inspection extends ScapeOpenInspection,
	Result,
> {
	readonly lifetime: Pick<EditorControllerLifetime, 'startTask'>;
	readonly store: ScapeInspectionStore | null;
	readonly inspectScapeProject?: ScapeProjectInspector<Inspection>;
	readonly openScape: (
		file: Blob,
		options: Readonly<{ collision: 'copy' | 'replace' }>,
	) => PromiseLike<Result> | Result;
}

export function createScapeProjectFileService<
	Inspection extends ScapeOpenInspection = ScapeProjectInspection,
	Result = unknown,
>(runtime: ScapeProjectFileServiceRuntime<Inspection, Result>) {
	const inspectionService = createScapeInspectionService<Inspection>({
		lifetime: runtime.lifetime,
		store: runtime.store,
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
	});
}

export type ScapeProjectFileInspectOptions = ScapeInspectionOptions;
export type ScapeProjectFileOpenOptions = ScapeOpenRequestOptions;
export type ScapeProjectCollisionRequester<Inspection extends ScapeOpenInspection> =
	ScapeCollisionRequester<Inspection>;
