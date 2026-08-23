/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoRetimeProgramOrdinalBridge } from '../video-retime-program-ordinal-bridge.ts';
import type { VideoRetimeProgramState } from './video-edit-service.ts';

type DataRecord = Readonly<Record<string, unknown>>;
type BridgeFactory = (
	ownerProject: DataRecord,
	authorityProject: DataRecord,
) => VideoRetimeProgramOrdinalBridge;

export interface VideoRetimeProgramStateResolverDependencies {
	readonly getProject: () => unknown;
	readonly projectRuntime: Readonly<{
		readonly projectForCommandConsumers: (project: unknown) => unknown;
		readonly projectForRuntimeConsumers: (project: unknown) => unknown;
	}>;
	readonly createBridge?: BridgeFactory;
}

/** Cache one selected product projection and bridge for the immutable document identity. */
export function createVideoRetimeProgramStateResolver(
	dependencies: VideoRetimeProgramStateResolverDependencies,
): (() => VideoRetimeProgramState) | undefined {
	if (typeof dependencies.createBridge !== 'function') return undefined;
	const createBridge = dependencies.createBridge;
	let ownerProject: unknown = null;
	let state: VideoRetimeProgramState | null = null;
	return () => {
		const currentProject = dependencies.getProject();
		if (!currentProject) throw new Error('A current project is required for exact video retime addressing.');
		if (state === null || ownerProject !== currentProject) {
			ownerProject = currentProject;
			const project = record(
				dependencies.projectRuntime.projectForCommandConsumers(currentProject),
				'video retime command project',
			);
			state = Object.freeze({
				project,
				bridge: createBridge(
					project,
					record(
						dependencies.projectRuntime.projectForRuntimeConsumers(currentProject),
						'video retime runtime project',
					),
				),
			});
		}
		return state;
	};
}

function record(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a record.`);
	}
	return value as DataRecord;
}
