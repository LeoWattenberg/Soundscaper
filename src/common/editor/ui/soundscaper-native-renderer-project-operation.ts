/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	NativePluginInstanceProjectionV1,
	NativePluginProjectStateV1,
} from './soundscaper-native-services-bridge.ts';

interface NativeProjectController {
	readonly project?: unknown;
	getSnapshot(): Readonly<{ readonly selectedTrackId?: string | null }>;
}

export interface SoundscaperNativeProjectOperation {
	readonly project: unknown;
	readonly projectId: string | null;
	readonly selectedTrackId: string | null;
	isCurrent(): boolean;
	assertCurrent(): void;
	commit<Value>(mutation: () => Value): Value;
}

/** Fences async renderer work to one exact project while admitting its own synchronous commits. */
export function captureSoundscaperNativeProjectOperation(
	controller: NativeProjectController | null | undefined,
): Readonly<SoundscaperNativeProjectOperation> {
	let project = controller?.project ?? null;
	const projectId = projectIdentity(project);
	const selectedTrackId = controller?.getSnapshot().selectedTrackId ?? null;
	const isCurrent = (): boolean => {
		const current = controller?.project ?? null;
		return current === project && projectIdentity(current) === projectId;
	};
	const assertCurrent = (): void => {
		if (!isCurrent()) throw projectChangedError();
	};
	const commit = <Value>(mutation: () => Value): Value => {
		assertCurrent();
		const value = mutation();
		const current = controller?.project ?? null;
		if (projectIdentity(current) !== projectId) throw projectChangedError();
		project = current;
		return value;
	};
	return Object.freeze({ get project() { return project; }, projectId,
		selectedTrackId, isCurrent, assertCurrent, commit });
}

export function projectPluginStates(project: unknown): readonly NativePluginProjectStateV1[] {
	const states = (project as { readonly nativePluginStates?: unknown } | null)?.nativePluginStates;
	return Array.isArray(states) ? states as readonly NativePluginProjectStateV1[] : Object.freeze([]);
}

export function withProjectLatency(
	state: NativePluginProjectStateV1,
	latencySamples: number,
): NativePluginProjectStateV1 {
	return Object.freeze({ ...state, latencySamples });
}

export function nativePluginProjectStateKey(state: NativePluginProjectStateV1, projectId: string | null): string {
	return [projectId, state.format, state.stablePluginId, state.binarySha256, state.stateBody.sha256,
		state.stateBody.byteLength, state.latencySamples, state.enabled, state.bypassed, state.continuity].join('\0');
}

export function nextNativePluginGeneration(
	generations: ReadonlyMap<string, number>, instanceId: string, requested: number,
): number {
	return Math.max(requested, (generations.get(instanceId) ?? 0) + 1);
}

export function assertRestoredNativePluginIdentity(
	instance: NativePluginInstanceProjectionV1,
	state: NativePluginProjectStateV1,
): void {
	if (instance.instanceId !== state.instanceId || instance.format !== state.format
		|| instance.stablePluginId !== state.stablePluginId
		|| instance.binarySha256 !== state.binarySha256) {
		throw new Error('The installed native plug-in no longer matches the persisted project identity.');
	}
}

function projectIdentity(project: unknown): string | null {
	if (project === null) return null;
	if (!project || typeof project !== 'object' || Array.isArray(project)
		|| typeof (project as { readonly id?: unknown }).id !== 'string'
		|| !(project as { readonly id: string }).id) {
		throw new TypeError('A native plug-in project operation requires an exact project identity.');
	}
	return (project as { readonly id: string }).id;
}

function projectChangedError(): DOMException {
	return new DOMException('The active project changed during the native plug-in operation.', 'AbortError');
}
