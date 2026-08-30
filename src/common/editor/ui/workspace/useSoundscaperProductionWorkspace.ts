/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useRef, useState } from 'react';

import type {
	MasteringSequenceDialogOperation,
	SoundscaperProductionDialogOperation,
} from '../dialogs/SoundscaperProductionDialog.tsx';
import {
	SOUNDSCAPER_AUTOMATION_MODES,
	type SoundscaperAutomationMode,
	type SoundscaperFreezeStatus,
	type SoundscaperProductionSurface,
} from '../soundscaper-production-application-menu.ts';

const SURFACE_PREFIX = 'soundscaper-production:';

export interface SoundscaperProductionControllerPort {
	readonly actions: Readonly<{
		readonly edit: Readonly<{ commit(command: unknown): unknown }>;
		readonly effects?: Readonly<{
			applySelection?(request: unknown): unknown;
			captureNoiseProfile?(): unknown;
		}>;
		readonly macros?: Readonly<{ run(request: unknown): unknown }>;
		readonly metering?: Readonly<{ reset?(kind?: string): unknown }>;
		readonly audioFreeze?: Readonly<Record<string, ((trackId: string) => unknown) | undefined>>;
		readonly audioAutomation?: Readonly<{
			getSnapshot(): Readonly<{ readonly mode?: unknown }>;
			setMode(mode: SoundscaperAutomationMode, laneId?: string | null): unknown;
			beginGesture?(laneId?: string | null, controlValue?: number): SoundscaperProductionAutomationGestureToken;
			previewGesture?(token: SoundscaperProductionAutomationGestureToken, controlValue: number): unknown;
			releaseGesture?(token: SoundscaperProductionAutomationGestureToken, controlValue?: number): unknown;
			cancelGesture?(token?: SoundscaperProductionAutomationGestureToken): boolean;
		}>;
	}>;
}

export interface SoundscaperProductionAutomationGestureToken {
	readonly type: 'soundscaper-automation-gesture-v21';
	readonly laneId: string;
	readonly generation: number;
}

export interface SoundscaperProductionAutomationGestureState {
	token: SoundscaperProductionAutomationGestureToken | null;
}

type SoundscaperProductionAutomationGestureOperation = Extract<
	SoundscaperProductionDialogOperation,
	Readonly<{ readonly type: `automation-gesture/${string}` }>
>;

export interface SoundscaperProductionWorkspaceRuntime {
	readonly automationMode: SoundscaperAutomationMode;
	readonly freezeStatus: SoundscaperFreezeStatus;
	readonly freezeActionsAvailable: boolean;
	readonly reviewedPackagesAvailable: boolean;
	open(surface: SoundscaperProductionSurface): void;
	restoreFocus(): void;
	setAutomationMode(mode: SoundscaperAutomationMode): void;
	freeze(operation: 'freeze' | 'refresh' | 'unfreeze' | 'commit', trackId: string): unknown;
	execute(operation: SoundscaperProductionDialogOperation): unknown;
}

export function useSoundscaperProductionWorkspace(input: Readonly<{
	productId: string;
	controller: SoundscaperProductionControllerPort;
	project: unknown;
	selectedTrackId?: string | null;
	openSurface(surface: string): void;
}>): Readonly<SoundscaperProductionWorkspaceRuntime> | null {
	const automationGesture = useRef<SoundscaperProductionAutomationGestureState>({ token: null });
	const menuReturnFocus = useRef<HTMLElement | null>(null);
	const projectIdentity = soundscaperProductionWorkspaceProjectIdentity(input.project);
	const [automationMode, setAutomationModeState] = useState<SoundscaperAutomationMode>(() => (
		controllerAutomationMode(input.controller)
	));
	const [freezeStatusRevision, setFreezeStatusRevision] = useState(0);
	useEffect(() => {
		setAutomationModeState(controllerAutomationMode(input.controller));
	}, [input.controller, projectIdentity]);
	useEffect(() => () => {
		cancelAutomationGesture(input.controller, automationGesture.current);
	}, [input.controller, projectIdentity]);
	return useMemo(() => {
		if (input.productId !== 'soundscaper') return null;
		const freeze = freezePort(input.controller);
		const automation = input.controller.actions.audioAutomation;
		const selectedLaneId = selectedTrackAutomationLaneId(input.project, input.selectedTrackId);
		const setAutomationMode = (mode: SoundscaperAutomationMode, laneId?: string | null): void => {
			if (!SOUNDSCAPER_AUTOMATION_MODES.includes(mode)) {
				throw new RangeError('The Soundscaper automation mode is unsupported.');
			}
			cancelAutomationGesture(input.controller, automationGesture.current);
			automation?.setMode(mode, laneId === undefined ? selectedLaneId : laneId);
			setAutomationModeState(mode);
		};
		return Object.freeze({
			automationMode,
			freezeStatus: resolveSoundscaperFreezeStatus(input.controller, input.project, input.selectedTrackId),
			freezeActionsAvailable: freeze !== null,
			reviewedPackagesAvailable: true,
			open: (surface: SoundscaperProductionSurface) => {
				menuReturnFocus.current = resolveSoundscaperProductionMenuReturnFocus(
					typeof document === 'undefined' ? null : document,
				);
				input.openSurface(`${SURFACE_PREFIX}${surface}`);
			},
			restoreFocus: () => {
				const target = menuReturnFocus.current;
				menuReturnFocus.current = null;
				scheduleSoundscaperProductionMenuFocus(target);
			},
			setAutomationMode,
			freeze: (operation: 'freeze' | 'refresh' | 'unfreeze' | 'commit', trackId: string) => {
				const action = freeze?.[operation];
				if (!action) throw new Error('Audio track freeze rendering is unavailable in this runtime.');
				const result = action(trackId);
				setFreezeStatusRevision((revision) => revision + 1);
				return Promise.resolve(result).finally(() => {
					setFreezeStatusRevision((revision) => revision + 1);
				});
			},
			execute: (operation: SoundscaperProductionDialogOperation) => executeSoundscaperProductionOperation(
				input.controller,
				operation,
				setAutomationMode,
				input.selectedTrackId ?? null,
				automationGesture.current,
			),
		});
	}, [automationMode, freezeStatusRevision, input.controller, input.openSurface,
		input.productId, input.project, input.selectedTrackId]);
}

export function resolveSoundscaperProductionMenuReturnFocus(
	documentValue: Document | null,
): HTMLElement | null {
	if (!documentValue) return null;
	const expanded = documentValue.querySelector('[data-application-menubar] > [aria-expanded="true"]');
	if (isConnectedFocusTarget(expanded)) return expanded;
	const active = documentValue.activeElement;
	return isConnectedFocusTarget(active)
		&& active.matches('[role="menuitem"]')
		&& active.parentElement?.matches('[data-application-menubar]')
		? active
		: null;
}

export function scheduleSoundscaperProductionMenuFocus(
	target: HTMLElement | null,
	schedule: (callback: () => void) => unknown = (callback) => requestAnimationFrame(callback),
): void {
	if (!target) return;
	schedule(() => {
		if (target.isConnected) target.focus({ preventScroll: true });
	});
}

function isConnectedFocusTarget(value: Element | null): value is HTMLElement {
	return value?.isConnected === true && typeof (value as HTMLElement).focus === 'function';
}

export function soundscaperProductionSurface(
	activeSurface: unknown,
): SoundscaperProductionSurface | null {
	if (typeof activeSurface !== 'string' || !activeSurface.startsWith(SURFACE_PREFIX)) return null;
	const surface = activeSurface.slice(SURFACE_PREFIX.length);
	return ['automation', 'routing', 'restoration', 'metering', 'mastering-sequences', 'reviewed-effects'].includes(surface)
		? surface as SoundscaperProductionSurface
		: null;
}

export function executeSoundscaperProductionOperation(
	controller: SoundscaperProductionControllerPort,
	operation: SoundscaperProductionDialogOperation,
	setAutomationMode: (mode: SoundscaperAutomationMode, laneId?: string | null) => void,
	selectedTrackId: string | null = null,
	automationGesture: SoundscaperProductionAutomationGestureState = { token: null },
): unknown {
	if (isAutomationGestureOperation(operation)) {
		return executeAutomationGesture(controller, operation, automationGesture);
	}
	if (operation.type === 'automation-lane/set'
		|| operation.type === 'mixer-graph/set'
		|| isMasteringSequenceOperation(operation)) {
		return controller.actions.edit.commit(operation);
	}
	if (operation.type === 'automation-mode/set') {
		setAutomationMode(operation.mode, operation.laneId);
		return operation.mode;
	}
	if (operation.type === 'production-meter/reset') {
		return controller.actions.metering?.reset?.('playback');
	}
	if (operation.type === 'restoration/capture-noise-profile') {
		const capture = controller.actions.effects?.captureNoiseProfile;
		if (!capture) throw new Error('Restoration noise-profile capture is unavailable in this runtime.');
		return capture();
	}
	if (operation.type === 'restoration/apply') {
		return import('../../production-audio/restoration-workflow.ts').then(({ compileRestorationWorkflowPlan }) => {
			const plan = compileRestorationWorkflowPlan(operation.workflow);
			const run = controller.actions.macros?.run;
			if (!run) throw new Error('Restoration is reviewed, but this runtime has no transactional restoration executor.');
			if (!selectedTrackId) throw new Error('Restoration requires a selected audio track.');
			return run({
				name: 'Restoration',
				trackId: selectedTrackId,
				effects: plan.operations.map(({ stageId, processorId, params }) => ({
					id: stageId, type: processorId, enabled: true, params,
				})),
			});
		});
	}
	return import('../../reviewed-effects/catalog.ts').then(({ resolveReviewedEffectCatalogEntry }) => {
		resolveReviewedEffectCatalogEntry(operation.package);
		const apply = controller.actions.effects?.applySelection;
		if (!apply) throw new Error('The reviewed package is approved, but this runtime has no reviewed-effect executor.');
		return apply({ type: 'reviewed-utility-gain', params: operation.params });
	});
}

function executeAutomationGesture(
	controller: SoundscaperProductionControllerPort,
	operation: SoundscaperProductionAutomationGestureOperation,
	state: SoundscaperProductionAutomationGestureState,
): unknown {
	const actions = controller.actions.audioAutomation;
	if (!actions) throw new Error('Automation gesture authoring is unavailable in this runtime.');
	if (operation.type === 'automation-gesture/begin') {
		if (state.token) throw new Error('An automation gesture is already active.');
		if (!actions.beginGesture) throw new Error('Automation gesture authoring is unavailable in this runtime.');
		state.token = normalizeAutomationGestureToken(actions.beginGesture(operation.laneId, operation.controlValue));
		return state.token;
	}
	const token = state.token;
	if (!token) throw new Error('There is no active automation gesture.');
	if (operation.type === 'automation-gesture/preview') {
		if (!actions.previewGesture) throw new Error('Automation gesture preview is unavailable in this runtime.');
		return actions.previewGesture(token, operation.controlValue);
	}
	if (operation.type === 'automation-gesture/release') {
		if (!actions.releaseGesture) throw new Error('Automation gesture release is unavailable in this runtime.');
		return clearAutomationGestureAfterSuccess(
			state,
			token,
			actions.releaseGesture(token, operation.controlValue),
		);
	}
	if (!actions.cancelGesture) throw new Error('Automation gesture cancellation is unavailable in this runtime.');
	return clearAutomationGestureAfterSuccess(state, token, actions.cancelGesture(token));
}

function clearAutomationGestureAfterSuccess(
	state: SoundscaperProductionAutomationGestureState,
	token: SoundscaperProductionAutomationGestureToken,
	result: unknown,
): unknown {
	const clear = (): void => {
		if (state.token === token) state.token = null;
	};
	if (!isPromiseLike(result)) {
		clear();
		return result;
	}
	return Promise.resolve(result).then((value) => {
		clear();
		return value;
	});
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return value !== null
		&& (typeof value === 'object' || typeof value === 'function')
		&& typeof Reflect.get(value, 'then') === 'function';
}

/**
 * Mastering-sequence operations are already ordinary commands, including the
 * batch used to apply all fields of one entry atomically.
 */
function isMasteringSequenceOperation(
	operation: SoundscaperProductionDialogOperation,
): operation is MasteringSequenceDialogOperation {
	return operation.type === 'batch' || operation.type.startsWith('mastering-sequence/');
}

function isAutomationGestureOperation(
	operation: SoundscaperProductionDialogOperation,
): operation is SoundscaperProductionAutomationGestureOperation {
	return operation.type === 'automation-gesture/begin'
		|| operation.type === 'automation-gesture/preview'
		|| operation.type === 'automation-gesture/release'
		|| operation.type === 'automation-gesture/cancel';
}

function cancelAutomationGesture(
	controller: SoundscaperProductionControllerPort,
	state: SoundscaperProductionAutomationGestureState,
): void {
	const token = state.token;
	state.token = null;
	if (token) controller.actions.audioAutomation?.cancelGesture?.(token);
}

function normalizeAutomationGestureToken(value: unknown): SoundscaperProductionAutomationGestureToken {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('The automation controller returned an invalid gesture token.');
	}
	const token = value as Readonly<Record<string, unknown>>;
	if (token.type !== 'soundscaper-automation-gesture-v21'
		|| typeof token.laneId !== 'string' || token.laneId.length === 0
		|| !Number.isSafeInteger(token.generation) || Number(token.generation) < 1) {
		throw new TypeError('The automation controller returned an invalid gesture token.');
	}
	return value as SoundscaperProductionAutomationGestureToken;
}

function freezePort(
	controller: SoundscaperProductionControllerPort,
): Readonly<Record<string, ((trackId: string) => unknown) | undefined>> | null {
	const port = controller.actions.audioFreeze;
	return port && ['freeze', 'refresh', 'unfreeze', 'commit'].every((name) => (
		typeof port[name] === 'function'
	)) ? port : null;
}

export function resolveSoundscaperFreezeStatus(
	controller: SoundscaperProductionControllerPort,
	projectValue: unknown,
	selectedTrackId?: string | null,
): SoundscaperFreezeStatus {
	const getStatus = controller.actions.audioFreeze?.getStatus;
	if (selectedTrackId && typeof getStatus === 'function') {
		const status = getStatus(selectedTrackId);
		if (['none', 'fresh', 'stale', 'verifying', 'unknown'].includes(String(status))) {
			return status as SoundscaperFreezeStatus;
		}
	}
	if (!projectValue || typeof projectValue !== 'object' || Array.isArray(projectValue)) return 'none';
	const tracks = (projectValue as Readonly<Record<string, unknown>>).tracks;
	if (!Array.isArray(tracks)) return 'none';
	const track = tracks.find((candidate) => candidate && typeof candidate === 'object'
		&& !Array.isArray(candidate) && (candidate as Readonly<Record<string, unknown>>).id === selectedTrackId);
	return track && Object.hasOwn(track, 'audioFreeze') ? 'unknown' : 'none';
}

function controllerAutomationMode(
	controller: SoundscaperProductionControllerPort,
): SoundscaperAutomationMode {
	const mode = controller.actions.audioAutomation?.getSnapshot().mode;
	return SOUNDSCAPER_AUTOMATION_MODES.includes(mode as SoundscaperAutomationMode)
		? mode as SoundscaperAutomationMode
		: 'read';
}

function soundscaperProductionWorkspaceProjectIdentity(project: unknown): unknown {
	if (project === null || typeof project !== 'object' || Array.isArray(project)) return null;
	const id = (project as Readonly<Record<string, unknown>>).id;
	return typeof id === 'string' ? id : project;
}

export function selectedTrackAutomationLaneId(
	projectValue: unknown,
	selectedTrackId?: string | null,
): string | null {
	if (!selectedTrackId || !projectValue || typeof projectValue !== 'object'
		|| Array.isArray(projectValue)) return null;
	const lanes = (projectValue as Readonly<Record<string, unknown>>).automationLanes;
	if (!Array.isArray(lanes)) return null;
	for (const candidate of lanes) {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
		const lane = candidate as Readonly<Record<string, unknown>>;
		const address = lane.address;
		if (!address || typeof address !== 'object' || Array.isArray(address)) continue;
		const strip = (address as Readonly<Record<string, unknown>>).strip;
		if (!strip || typeof strip !== 'object' || Array.isArray(strip)) continue;
		const stripRecord = strip as Readonly<Record<string, unknown>>;
		if (stripRecord.kind === 'track' && stripRecord.id === selectedTrackId
			&& typeof lane.id === 'string' && lane.id) return lane.id;
	}
	return null;
}
