/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import type { EditorActionRuntime } from '../action-facade-runtime.ts';
import { projectForRuntimeConsumers } from '../../../project-current-runtime.ts';
import { canonicalParameterAddressKey, normalizeParameterAddress, type ParameterAddress } from '../../../parameter-address.ts';
import { createParameterGestureAdapter, type ParameterGestureSession } from '../../effects/effect-gesture-safety.ts';
import { createLocalizedError } from '../../../../i18n/presentation-message.ts';
import type { EditorProjectToken } from '../../shared/lifecycle.ts';

type StripAddress = Extract<ParameterAddress, { readonly kind: 'strip' }>;
type Runtime = Pick<EditorActionRuntime, 'getProject' | 'copy'> & Readonly<{
	commit: (command: AudioEditorCommand) => unknown;
	engine: Pick<EditorActionRuntime['engine'], 'previewScheduledParameter'>;
	state: Pick<EditorActionRuntime['state'], 'readOnly'>;
}>;
interface StripChannel extends Readonly<Record<string, unknown>> { readonly id?: string; readonly type?: string }
interface StripProject {
	readonly master: StripChannel;
	readonly tracks: readonly StripChannel[];
	readonly mixer?: Readonly<{ groups: readonly StripChannel[]; sends: readonly StripChannel[] }>;
}

/** Preview static mixer parameters during a gesture and commit one undoable edit. */
export function createMixerParameterActions(runtime: Runtime) {
	const addresses = new Map<string, StripAddress>();
	const sessions = new Map<string, ParameterGestureSession<number, number>>();
	let previewRevision = 0;
	const projectGenerations = new WeakMap<object, number>();
	let generation = 0;
	const captureProject = (): EditorProjectToken => {
		const project = runtime.getProject();
		if (!project) throw createLocalizedError(Error, runtime.copy, 'projectNotFound');
		let current = projectGenerations.get(project);
		if (current === undefined) { current = ++generation; projectGenerations.set(project, current); }
		return { projectId: project.id, generation: current };
	};
	const locate = (identity: string) => {
		const address = addresses.get(identity);
		if (!address) return null;
		const persisted = runtime.getProject();
		if (!persisted) return null;
		const project = projectForRuntimeConsumers(persisted) as unknown as StripProject;
		const strip = address.strip;
		if (strip.kind === 'master') return { address, scope: 'master' as const, id: null, channel: project.master };
		if (strip.kind === 'track') {
			const track = project.tracks.find((candidate) => candidate.id === strip.id && candidate.type === 'audio');
			return track ? { address, scope: 'track' as const, id: strip.id, channel: track } : null;
		}
		const group = project.mixer?.groups.find((candidate) => candidate.id === strip.id);
		if (group) return { address, scope: 'group' as const, id: strip.id, channel: group };
		const send = project.mixer?.sends.find((candidate) => candidate.id === strip.id);
		return send ? { address, scope: 'send' as const, id: strip.id, channel: send } : null;
	};
	const adapter = createParameterGestureAdapter({
		sessions,
		captureProject,
		assertProject: (token) => {
			const current = captureProject();
			if (token.projectId !== current.projectId || token.generation !== current.generation) throw new Error('Mixer project changed.');
		},
		captureAuthority: () => 0,
		assertAuthority: () => {
			if (runtime.state.readOnly) throw createLocalizedError(Error, runtime.copy, 'projectReadOnly');
		},
		resolveTarget: (identity: string) => {
			const target = locate(identity);
			if (!target) return null;
			const parameter = target.address.parameterId;
			const value = Number(target.channel[parameter] ?? (parameter === 'gain' ? 1 : 0));
			return { identity, revision: JSON.stringify([target.scope, target.id, parameter, value]), value };
		},
		normalize: (target, value: number) => {
			if (!Number.isFinite(value)) throw new TypeError('Mixer parameter must be finite.');
			const parameter = addresses.get(target.identity)?.parameterId;
			const normalized = Math.max(parameter === 'pan' ? -1 : 0, Math.min(parameter === 'gain' ? 4 : 1, value));
			return normalized === 0 ? 0 : normalized;
		},
		valuesEqual: (left: number, right: number) => left === right,
		applyPreview: (target, value: number) => runtime.engine.previewScheduledParameter(addresses.get(target.identity), value)
			? ++previewRevision : false,
		commitValue: (target, value: number) => {
			const location = locate(target.identity);
			if (!location) throw new Error('Mixer strip not found.');
			const changes = { [location.address.parameterId]: value };
			if (location.scope === 'master') return runtime.commit({ type: 'master/update', changes });
			if (location.scope === 'track') return runtime.commit({ type: 'track/update', trackId: location.id, changes });
			return runtime.commit({ type: 'mixer/bus-update', busType: location.scope, busId: location.id, changes });
		},
		currentValue: runtime.getProject,
		createTargetMissingError: () => new Error('Mixer strip not found.'),
		createTargetChangedError: () => new Error('Mixer parameter changed during its gesture.'),
	});
	const identify = (value: unknown) => {
		const address = normalizeParameterAddress(value);
		if (address.kind !== 'strip' || address.parameterId === 'mute') throw new RangeError('A continuous mixer strip parameter is required.');
		const identity = canonicalParameterAddressKey(address);
		addresses.set(identity, address);
		return identity;
	};
	return Object.freeze({
		beginParameterGesture: (address: unknown) => adapter.begin(identify(address)),
		previewParameterGesture: (address: unknown, value: number) => adapter.preview(identify(address), value),
		commitParameterGesture: (address: unknown, value: number) => adapter.commit(identify(address), value),
		cancelParameterGesture: (address: unknown) => adapter.cancel(identify(address)),
	});
}
