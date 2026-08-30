/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	evaluateAutomationLaneAtFrameV21,
	normalizeAutomationLaneV21,
} from '../common/editor/automation-lane-v21.ts';
import {
	effectParameterInventory,
	stripParameterDescriptor,
} from '../common/editor/effect-parameter-descriptors.ts';
import {
	canonicalParameterAddressKey,
	type ParameterAddress,
	type ParameterDescriptor,
	type StripRef,
} from '../common/editor/parameter-address.ts';
import type { HoldTempoMap } from '../common/editor/timeline-time.ts';
import {
	createSoundscaperAutomationSession,
	type SoundscaperAutomationGestureToken,
	type SoundscaperAutomationSessionSnapshot,
	type SoundscaperAutomationSession,
	type SoundscaperAutomationTarget,
} from './editor-automation-session.ts';
import type { SoundscaperProject } from './editor-project.ts';
import { validateSoundscaperProject } from './editor-project-validation.ts';

type DataRecord = Readonly<Record<string, unknown>>;
type SubscriptionRelease = () => boolean | void;

export interface SoundscaperAutomationControllerHost {
	readonly project: unknown;
	readonly engine: Readonly<{
		getPositionFrames(): number;
		getState(): Readonly<{ readonly state: string }>;
		subscribePosition(listener: () => void): () => boolean | void;
		subscribeState(listener: () => void): () => boolean | void;
		previewScheduledParameter?(address: unknown, value: number): boolean;
	}>;
	readonly actions: Readonly<{
		readonly edit: Readonly<{ commit(command: unknown): unknown }>;
	}>;
	getSnapshot(): Readonly<{
		readonly readOnly?: boolean;
		readonly lockReadOnly?: boolean;
		readonly transportState?: string;
	}>;
	subscribe(listener: () => void): () => boolean | void;
}

export interface SoundscaperAutomationControllerActions {
	getSnapshot(): SoundscaperAutomationSessionSnapshot;
	setMode(mode: 'read' | 'trim' | 'touch' | 'latch' | 'write', laneId?: string | null): SoundscaperAutomationSessionSnapshot;
	beginGesture(laneId?: string | null, controlValue?: number): SoundscaperAutomationGestureToken;
	previewGesture(token: SoundscaperAutomationGestureToken, controlValue: number, frame?: number): unknown;
	releaseGesture(token: SoundscaperAutomationGestureToken, controlValue?: number, frame?: number): unknown;
	cancelGesture(token?: SoundscaperAutomationGestureToken): boolean;
	resetProject(): void;
}

export interface SoundscaperAutomationControllerBinding {
	readonly actions: Readonly<SoundscaperAutomationControllerActions>;
	readonly coordinator: Readonly<SoundscaperAutomationSession<unknown>>;
	dispose(): void;
}

export interface SoundscaperAutomationControllerBindingOptions {
	/**
	 * The document validator for the revision this binding serves. Later
	 * production revisions inherit this file unchanged, and validating a V23
	 * document as baseline fails on the field V23 adds — so the revision is a
	 * parameter rather than something this file names.
	 */
	readonly validateProject?: (project: unknown) => unknown;
}

/** Bind controller/engine lifecycle events without introducing persisted mode state. */
export function createSoundscaperAutomationControllerBinding(
	host: SoundscaperAutomationControllerHost,
	options: SoundscaperAutomationControllerBindingOptions = {},
): Readonly<SoundscaperAutomationControllerBinding> {
	assertHost(host);
	const validateProject = options.validateProject ?? validateSoundscaperProject;
	let disposed = false;
	const coordinator = createSoundscaperAutomationSession({
		captureAuthority: () => controllerAuthority(host),
		resolveTarget: (laneId) => resolveSoundscaperAutomationTarget(host.project, laneId, validateProject),
		commit: (command) => host.actions.edit.commit(command),
		preview: ({ laneId, value }) => {
			const target = resolveSoundscaperAutomationTarget(host.project, laneId, validateProject);
			if (target) host.engine.previewScheduledParameter?.(target.descriptor.address, value);
		},
		restoreReadback: ({ id }) => { restoreAutomationReadbackV21(host, id, validateProject); },
	});
	const synchronize = (): void => {
		if (disposed) return;
		coordinator.synchronize();
	};
	const subscriptionReleases: Record<'document' | 'position' | 'state', SubscriptionRelease | null> = {
		document: null,
		position: null,
		state: null,
	};
	let coordinatorOwned = true;
	const releaseOwnership = (): unknown[] => {
		const failures: unknown[] = [];
		for (const name of ['document', 'position', 'state'] as const) {
			const release = subscriptionReleases[name];
			if (!release) continue;
			subscriptionReleases[name] = null;
			try { release(); } catch (error) {
				subscriptionReleases[name] = release;
				failures.push(error);
			}
		}
		if (coordinatorOwned) {
			coordinatorOwned = false;
			try { coordinator.dispose(); } catch (error) { failures.push(error); }
		}
		return failures;
	};
	try {
		subscriptionReleases.document = subscriptionRelease(host.subscribe(synchronize), 'document');
		subscriptionReleases.position = subscriptionRelease(
			host.engine.subscribePosition(synchronize),
			'position',
		);
		subscriptionReleases.state = subscriptionRelease(host.engine.subscribeState(synchronize), 'state');
	} catch (error) {
		disposed = true;
		const cleanupFailures = releaseOwnership();
		if (cleanupFailures.length > 0) {
			throw new AggregateError(
				[error, ...cleanupFailures],
				'Soundscaper automation controller setup rollback failed.',
				{ cause: error },
			);
		}
		throw error;
	}
	const actions = Object.freeze({
		getSnapshot: () => coordinator.getSnapshot(),
		setMode: (
			mode: 'read' | 'trim' | 'touch' | 'latch' | 'write',
			laneId?: string | null,
		) => coordinator.setMode(mode, laneId),
		beginGesture: (laneId?: string | null, controlValue?: number) => (
			coordinator.beginGesture(laneId, controlValue)
		),
		previewGesture: (
			token: SoundscaperAutomationGestureToken,
			controlValue: number,
			frame?: number,
		) => coordinator.previewGesture(token, controlValue, frame),
		releaseGesture: (
			token: SoundscaperAutomationGestureToken,
			controlValue?: number,
			frame?: number,
		) => coordinator.releaseGesture(token, controlValue, frame),
		cancelGesture: (token?: SoundscaperAutomationGestureToken) => coordinator.cancelGesture(token),
		resetProject: () => { coordinator.resetProject(); },
	});
	return Object.freeze({
		actions,
		coordinator,
		dispose() {
			disposed = true;
			const failures = releaseOwnership();
			if (failures.length === 1) throw failures[0];
			if (failures.length > 1) {
				throw new AggregateError(failures, 'Soundscaper automation controller disposal failed.', {
					cause: failures[0],
				});
			}
		},
	});
}

function subscriptionRelease(value: unknown, name: string): SubscriptionRelease {
	if (typeof value !== 'function') {
		throw new TypeError(`Soundscaper automation ${name} subscription must return a release function.`);
	}
	return value as SubscriptionRelease;
}

function restoreAutomationReadbackV21(
	host: SoundscaperAutomationControllerHost,
	laneId: string,
	// The same injected revision authority the resolve and preview ports take:
	// this runs in the gesture's finally, so a validator that refuses the mounted
	// document turns every completed gesture into a reported failure.
	validateProject: (project: unknown) => unknown,
): void {
	if (!host.engine.previewScheduledParameter) return;
	const target = resolveSoundscaperAutomationTarget(host.project, laneId, validateProject);
	if (!target) return;
	const current = controllerAuthority(host);
	const value = evaluateAutomationLaneAtFrameV21(target.lane, current.positionFrame, {
		sampleRate: current.sampleRate,
		...(target.lane.timebase === 'musical-beats' && current.tempoMap
			? { tempoMap: current.tempoMap }
			: {}),
	});
	host.engine.previewScheduledParameter(target.descriptor.address, value);
}

/** Resolve the canonical lane, descriptor, current control value, and lock fact. */
export function resolveSoundscaperAutomationTarget(
	projectValue: unknown,
	laneId: string,
	/**
	 * Injected because later production revisions inherit this file unchanged: a
	 * hardcoded baseline validator would throw on every document of the next
	 * revision, in a file that has nothing else revision-specific in it.
	 */
	validateProject: (project: unknown) => unknown = validateSoundscaperProject,
): SoundscaperAutomationTarget | null {
	if (!projectValue) return null;
	validateProject(projectValue);
	const project = projectValue as SoundscaperProject;
	const laneValue = project.automationLanes.find(({ id }) => id === laneId);
	if (!laneValue) return null;
	const descriptor = parameterDescriptor(project, laneValue.address);
	const lane = normalizeAutomationLaneV21(laneValue, { descriptor });
	return Object.freeze({
		lane,
		descriptor,
		controlValue: parameterControlValue(project, descriptor),
		locked: addressLocked(project, descriptor.address),
	});
}

function controllerAuthority(
	host: SoundscaperAutomationControllerHost,
) {
	const project = record(host.project);
	const snapshot = host.getSnapshot();
	const engineState = host.engine.getState().state;
	const transportState = snapshot.transportState === 'recording'
		? 'recording'
		: engineState;
	const tempoMap = own(project, 'tempoMap');
	return Object.freeze({
		projectId: text(own(project, 'id')),
		projectRevision: integerOrNull(own(project, 'revision')),
		readOnly: snapshot.readOnly === true,
		lockReadOnly: snapshot.lockReadOnly === true,
		transportState,
		positionFrame: host.engine.getPositionFrames(),
		sampleRate: positiveIntegerOr(own(project, 'sampleRate'), 48_000),
		...(tempoMap === undefined ? {} : { tempoMap: tempoMap as HoldTempoMap }),
	});
}

function parameterDescriptor(
	project: SoundscaperProject,
	address: ParameterAddress,
): ParameterDescriptor {
	if (address.kind !== 'effect') return stripParameterDescriptor(address);
	const effect = effectForStrip(project, address.strip, address.effectId);
	if (!effect) throw new ReferenceError('Automation effect target is unavailable.');
	const key = canonicalParameterAddressKey(address);
	const descriptor = effectParameterInventory(address.strip, effect, {
		sampleRate: project.sampleRate,
	}).descriptors.find(({ id }) => id === key);
	if (!descriptor) throw new ReferenceError('Automation effect parameter descriptor is unavailable.');
	return descriptor;
}

function parameterControlValue(
	project: SoundscaperProject,
	descriptor: ParameterDescriptor,
): number {
	const { address } = descriptor;
	if (address.kind === 'edge') {
		const edge = project.mixer.edges.find(({ id }) => id === address.edgeId);
		if (!edge) throw new ReferenceError('Automation mixer edge is unavailable.');
		return edge.level;
	}
	const strip = stripRecord(project, address.strip);
	if (!strip) throw new ReferenceError('Automation strip is unavailable.');
	if (address.kind === 'strip') return numericParameter(own(strip, address.parameterId), descriptor);
	const effect = effectForStrip(project, address.strip, address.effectId);
	if (!effect) throw new ReferenceError('Automation effect is unavailable.');
	const params = record(own(effect, 'params'));
	if (!address.elementId) return numericParameter(own(params, address.parameterId), descriptor);
	const element = effectElement(params, address.elementId);
	return numericParameter(own(element, address.parameterId), descriptor);
}

function stripRecord(project: SoundscaperProject, strip: StripRef): DataRecord | null {
	if (strip.kind === 'master') return record(project.master);
	if (strip.kind === 'track') {
		return record(project.tracks.find(({ id }) => id === strip.id));
	}
	return record([
		...project.mixer.groups,
		...project.mixer.sends,
		...project.mixer.cues,
	].find(({ id }) => id === strip.id));
}

function effectForStrip(
	project: SoundscaperProject,
	strip: StripRef,
	effectId: string,
): DataRecord | null {
	const owner = stripRecord(project, strip);
	const effects = own(owner, 'effects');
	if (!Array.isArray(effects)) return null;
	return record(effects.find((effect) => own(record(effect), 'id') === effectId));
}

function effectElement(params: DataRecord | null, elementId: string): DataRecord | null {
	if (!params) return null;
	for (const value of Object.values(params)) {
		if (!Array.isArray(value)) continue;
		const element = value.find((candidate) => own(record(candidate), 'id') === elementId);
		if (element) return record(element);
	}
	return null;
}

function addressLocked(project: SoundscaperProject, address: ParameterAddress): boolean {
	if (address.kind === 'edge') return false;
	if (address.strip.kind !== 'track') return false;
	const trackId = address.strip.id;
	return project.tracks.find(({ id }) => id === trackId)?.locked === true;
}

function numericParameter(value: unknown, descriptor: ParameterDescriptor): number {
	if (typeof value === 'boolean') return value ? 1 : 0;
	if (typeof value === 'number' && Number.isFinite(value)
		&& value >= descriptor.minimum && value <= descriptor.maximum) return value;
	return descriptor.defaultValue;
}

function assertHost(value: SoundscaperAutomationControllerHost): void {
	if (!value || typeof value !== 'object'
		|| typeof value.getSnapshot !== 'function'
		|| typeof value.subscribe !== 'function'
		|| typeof value.engine?.getPositionFrames !== 'function'
		|| typeof value.engine?.subscribePosition !== 'function'
		|| typeof value.engine?.subscribeState !== 'function'
		|| typeof value.actions?.edit?.commit !== 'function') {
		throw new TypeError('A Soundscaper baseline controller host is required.');
	}
}

function record(value: unknown): DataRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as DataRecord
		: null;
}

function own(value: DataRecord | null, key: string): unknown {
	if (!value) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
		? descriptor.value
		: undefined;
}

function text(value: unknown): string | null {
	return typeof value === 'string' && value ? value : null;
}

function integerOrNull(value: unknown): number | null {
	return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function positiveIntegerOr(value: unknown, fallback: number): number {
	return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}
