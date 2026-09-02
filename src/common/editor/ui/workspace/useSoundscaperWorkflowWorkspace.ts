/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useRef, useState } from 'react';

import {
	TRACK_AUTOMATION_MODES,
	normalizeTrackAutomationMode,
	type TrackAutomationMode,
	type TrackAutomationRuntime,
} from '../../track-automation-runtime.ts';
import type { SoundscaperFreezeStatus } from '../soundscaper-workflow-application-menu.ts';

type FreezeOperation = 'freeze' | 'refresh' | 'unfreeze' | 'commit';
type FreezeAction = (trackId: string) => unknown;

interface AutomationControllerPort {
	getSnapshot(): Readonly<{
		readonly mode?: unknown;
		readonly laneId?: unknown;
		readonly gestureActive?: unknown;
	}>;
	setMode(mode: TrackAutomationMode, laneId?: string | null): unknown;
	beginGesture?(laneId?: string | null, controlValue?: number): unknown;
	previewGesture?(token: unknown, controlValue: number): unknown;
	releaseGesture?(token: unknown, controlValue?: number): unknown;
	cancelGesture?(token?: unknown): unknown;
}

interface FreezeControllerPort {
	readonly getStatus?: (trackId: string) => unknown;
	readonly freeze?: FreezeAction;
	readonly refresh?: FreezeAction;
	readonly unfreeze?: FreezeAction;
	readonly commit?: FreezeAction;
}

export interface SoundscaperWorkflowControllerPort {
	readonly actions: Readonly<{
		readonly audioAutomation?: AutomationControllerPort;
		readonly audioFreeze?: FreezeControllerPort;
	}>;
}

export interface SoundscaperWorkflowWorkspaceRuntime {
	readonly automationRuntime: TrackAutomationRuntime;
	readonly freezeStatus: SoundscaperFreezeStatus;
	readonly freezeActionsAvailable: boolean;
	freezeStatusForTrack(trackId: string): SoundscaperFreezeStatus;
	openMasteringSequences(): void;
	restoreFocus(): void;
	freeze(operation: FreezeOperation, trackId: string): unknown;
}

export function useSoundscaperWorkflowWorkspace(input: Readonly<{
	productId: string;
	controller: SoundscaperWorkflowControllerPort;
	project: unknown;
	selectedTrackId?: string | null;
	openSurface(surface: string): void;
}>): Readonly<SoundscaperWorkflowWorkspaceRuntime> | null {
	const activeGesture = useRef<unknown>(null);
	const menuReturnFocus = useRef<HTMLElement | null>(null);
	const mounted = useRef(true);
	const [revision, setRevision] = useState(0);
	const projectIdentity = workflowProjectIdentity(input.project);
	useEffect(() => {
		mounted.current = true;
		setRevision((current) => current + 1);
		return () => {
			mounted.current = false;
			const token = activeGesture.current;
			activeGesture.current = null;
			if (token !== null) void input.controller.actions.audioAutomation?.cancelGesture?.(token);
		};
	}, [input.controller, projectIdentity]);
	return useMemo(() => {
		if (input.productId !== 'soundscaper') return null;
		const automation = input.controller.actions.audioAutomation;
		const freeze = input.controller.actions.audioFreeze;
		const refresh = (): void => {
			if (mounted.current) setRevision((current) => current + 1);
		};
		const automationSnapshot = normalizedAutomationSnapshot(automation, activeGesture.current !== null);
		const requireGesture = (token: unknown): unknown => {
			if (activeGesture.current === null || token !== activeGesture.current) {
				throw new Error('The automation gesture token is stale or no longer active.');
			}
			return token;
		};
		const clearGestureAfterSuccess = (token: unknown, result: unknown): unknown => {
			const clear = (): void => {
				if (activeGesture.current === token) activeGesture.current = null;
				refresh();
			};
			if (!isPromiseLike(result)) {
				clear();
				return result;
			}
			return Promise.resolve(result).then((value) => {
				clear();
				return value;
			});
		};
		const cancelActiveGesture = (): unknown => {
			const token = activeGesture.current;
			if (token === null) return undefined;
			if (!automation?.cancelGesture) {
				throw new Error('Automation gesture cancellation is unavailable in this runtime.');
			}
			return clearGestureAfterSuccess(token, automation.cancelGesture(token));
		};
		const setMode = (mode: TrackAutomationMode, laneId: string | null): unknown => {
			if (!TRACK_AUTOMATION_MODES.includes(mode)) {
				throw new RangeError('The automation mode is unsupported.');
			}
			if (!automation) throw new Error('Automation control is unavailable in this runtime.');
			const apply = (): unknown => refreshAfterSuccess(
				automation.setMode(mode, laneId), refresh,
			);
			const canceled = cancelActiveGesture();
			return isPromiseLike(canceled) ? Promise.resolve(canceled).then(apply) : apply();
		};
		const automationRuntime: TrackAutomationRuntime = Object.freeze({
			snapshot: automationSnapshot,
			setMode,
			beginGesture: (laneId: string, controlValue: number): unknown => {
				if (activeGesture.current !== null) throw new Error('An automation gesture is already active.');
				if (!automation?.beginGesture) throw new Error('Automation gesture authoring is unavailable.');
				const token = automation.beginGesture(laneId, controlValue);
				if (token === null || token === undefined) {
					throw new TypeError('The automation controller returned no gesture token.');
				}
				activeGesture.current = token;
				refresh();
				return token;
			},
			previewGesture: (token: unknown, controlValue: number): unknown => {
				if (!automation?.previewGesture) throw new Error('Automation gesture preview is unavailable.');
				return refreshAfterSuccess(
					automation.previewGesture(requireGesture(token), controlValue), refresh,
				);
			},
			releaseGesture: (token: unknown, controlValue?: number): unknown => {
				if (!automation?.releaseGesture) throw new Error('Automation gesture release is unavailable.');
				return clearGestureAfterSuccess(
					requireGesture(token),
					automation.releaseGesture(token, controlValue),
				);
			},
			cancelGesture: (token?: unknown): unknown => {
				const owned = token === undefined ? activeGesture.current : requireGesture(token);
				if (owned === null) return false;
				if (!automation?.cancelGesture) throw new Error('Automation gesture cancellation is unavailable.');
				return clearGestureAfterSuccess(owned, automation.cancelGesture(owned));
			},
		});
		return Object.freeze({
			automationRuntime,
			freezeStatus: resolveSoundscaperFreezeStatus(
				input.controller, input.project, input.selectedTrackId,
			),
			freezeActionsAvailable: freezePort(freeze) !== null,
			freezeStatusForTrack: (trackId: string) => resolveSoundscaperFreezeStatus(
				input.controller, input.project, trackId,
			),
			openMasteringSequences: () => {
				menuReturnFocus.current = resolveWorkflowMenuReturnFocus(
					typeof document === 'undefined' ? null : document,
				);
				input.openSurface('mastering-sequences');
			},
			restoreFocus: () => {
				const target = menuReturnFocus.current;
				menuReturnFocus.current = null;
				scheduleWorkflowMenuFocus(target);
			},
			freeze: (operation: FreezeOperation, trackId: string): unknown => {
				const action = freezePort(freeze)?.[operation];
				if (!action) throw new Error('Audio track freeze rendering is unavailable in this runtime.');
				return refreshAfterSuccess(action(trackId), refresh);
			},
		});
	}, [input.controller, input.openSurface, input.productId, input.project,
		input.selectedTrackId, projectIdentity, revision]);
}

export function resolveSoundscaperFreezeStatus(
	controller: SoundscaperWorkflowControllerPort,
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
	const project = dataRecord(projectValue);
	const track = records(project?.tracks).find((candidate) => candidate.id === selectedTrackId);
	return track && Object.hasOwn(track, 'audioFreeze') ? 'unknown' : 'none';
}

export function resolveWorkflowMenuReturnFocus(documentValue: Document | null): HTMLElement | null {
	if (!documentValue) return null;
	const expanded = documentValue.documentElement?.querySelector(
		'[data-application-menubar] > [aria-expanded="true"]',
	) ?? null;
	if (isConnectedFocusTarget(expanded)) return expanded;
	const active = documentValue.activeElement;
	return isConnectedFocusTarget(active)
		&& active.matches('[role="menuitem"]')
		&& active.parentElement?.matches('[data-application-menubar]')
		? active
		: null;
}

export function scheduleWorkflowMenuFocus(
	target: HTMLElement | null,
	schedule: (callback: () => void) => unknown = (callback) => requestAnimationFrame(callback),
): void {
	if (!target) return;
	schedule(() => {
		if (target.isConnected) target.focus({ preventScroll: true });
	});
}

function normalizedAutomationSnapshot(
	automation: AutomationControllerPort | undefined,
	gestureOwned: boolean,
): TrackAutomationRuntime['snapshot'] {
	const value = automation?.getSnapshot() ?? {};
	return Object.freeze({
		mode: normalizeTrackAutomationMode(value.mode),
		laneId: typeof value.laneId === 'string' && value.laneId ? value.laneId : null,
		gestureActive: gestureOwned || value.gestureActive === true,
	});
}

function refreshAfterSuccess(result: unknown, refresh: () => void): unknown {
	if (!isPromiseLike(result)) {
		refresh();
		return result;
	}
	return Promise.resolve(result).then((value) => {
		refresh();
		return value;
	});
}

function freezePort(value: FreezeControllerPort | undefined): Readonly<Record<FreezeOperation, FreezeAction>> | null {
	if (!value || !['freeze', 'refresh', 'unfreeze', 'commit'].every((name) => (
		typeof value[name as FreezeOperation] === 'function'
	))) return null;
	return value as Readonly<Record<FreezeOperation, FreezeAction>>;
}

function workflowProjectIdentity(project: unknown): unknown {
	const record = dataRecord(project);
	return typeof record?.id === 'string' ? record.id : project;
}

function dataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: null;
}

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	return Array.isArray(value)
		? value.map(dataRecord).filter((item): item is Readonly<Record<string, unknown>> => item !== null)
		: [];
}

function isConnectedFocusTarget(value: Element | null): value is HTMLElement {
	return value?.isConnected === true && typeof (value as HTMLElement).focus === 'function';
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return value !== null
		&& (typeof value === 'object' || typeof value === 'function')
		&& typeof Reflect.get(value, 'then') === 'function';
}
