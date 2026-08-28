/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	isNativeMediaCapabilityUsable,
	nativeMediaCapabilityEntry,
	type NativeMediaCapabilityRefV1,
	type NativeMediaCapabilitySnapshotV1,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import { readProjectSchemaIdentity } from '../src/common/editor/project-schema-identity.ts';

export function assertFramescaperNativeOperationCapability(options: Readonly<{
	runtimeAvailable: boolean;
	nativeMediaEnabled: boolean;
	snapshot: NativeMediaCapabilitySnapshotV1;
	reference: NativeMediaCapabilityRefV1;
	label: string;
}>): void {
	if (!options.runtimeAvailable || !options.nativeMediaEnabled) {
		throw new Error(`The native ${options.label} is disabled or its runtime is unavailable.`);
	}
	const entry = nativeMediaCapabilityEntry(
		options.snapshot, options.reference.domain, options.reference.id,
	);
	if (!isNativeMediaCapabilityUsable(entry)) {
		throw new Error(`The native ${options.label} capability is unavailable or blocked by policy.`);
	}
}

export function assertFramescaperNativeWritableProject(
	projectId: unknown,
	projectState: (projectId: string) => Readonly<{
		schemaFamily: 'framescaper'; schemaVersion: 1; open: boolean; writable: boolean;
	}>,
): void {
	if (typeof projectId !== 'string') throw new TypeError('A native service requires an exact project id.');
	const project = projectState(projectId);
	const identity = readProjectSchemaIdentity(project);
	if (identity.schemaFamily !== 'framescaper' || identity.schemaVersion !== 1) {
		throw new Error('Native services require the exact Framescaper v1 project authority.');
	}
	if (!project.open || !project.writable) {
		throw new Error('Native services require the selected project to be open and writable.');
	}
}
