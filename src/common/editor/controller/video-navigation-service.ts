/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createVideoShuttleAnchor,
	resolveAdjacentVideoEditPoint,
	resolveVideoProgramGeometry,
	resolveVideoShuttlePosition,
	stepVideoShuttleRate,
	type VideoProgramGeometry,
	type VideoShuttleAnchor,
	type VideoShuttleDirection,
	type VideoShuttleRate,
} from '../video-navigation-model.ts';
import type { VideoEditTargets } from '../video-edit-targeting.ts';
import type { EditorControllerLifetime } from './lifecycle.ts';

/**
 * Session-only program navigation. The document owns neither shuttle rate nor
 * playhead position; this service owns the timer and audio-scrub lifetime that
 * render those temporary choices.
 */

type DataRecord = Readonly<Record<string, unknown>>;

export interface VideoNavigationLifetime {
	readonly signal: AbortSignal;
	assertActive(): void;
}

export interface VideoNavigationServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'signal' | 'assertActive'> | VideoNavigationLifetime;
	/** The live persisted project or command projection used for model reads. */
	getProject(): DataRecord;
	/**
	 * Stable document identity when getProject() returns a fresh projection on
	 * every read. Defaults to the project object itself.
	 */
	getProjectIdentity?(): unknown;
	/** Compatible with the complete result of VideoEditService.targets(). */
	getTargets(): Pick<VideoEditTargets, 'sequenceId' | 'videoTrackId' | 'explicit'>;
	getPositionFrames(): number;
	readonly now: () => number;
	readonly setInterval: (callback: () => void, milliseconds: number) => unknown;
	readonly clearInterval: (identifier: unknown) => void;
	readonly scrub: (frame: number) => unknown;
	readonly seek: (frame: number) => unknown;
	readonly endScrub: () => unknown;
	readonly publish: (view: VideoNavigationView) => void;
	readonly handleError: (error: unknown) => void;
	readonly intervalMilliseconds?: number;
}

export interface VideoNavigationView {
	readonly sequenceId: string;
	readonly rate: VideoShuttleRate;
	readonly shuttling: boolean;
	readonly preparing: boolean;
	readonly positionFrame: number;
	readonly programEndFrame: number;
}

export interface VideoNavigationService {
	view(): VideoNavigationView;
	/** J: move one rung toward faster reverse playback. */
	shuttleReverse(): VideoNavigationView;
	/** K: stop at the position derived for this exact instant. */
	shuttleStop(): VideoNavigationView;
	/** L: move one rung toward faster forward playback. */
	shuttleForward(): VideoNavigationView;
	previousEditPoint(): number | null;
	nextEditPoint(): number | null;
	dispose(): void;
}

const DEFAULT_INTERVAL_MILLISECONDS = 25;
const NO_PROJECT_SESSION = Symbol('no video navigation project');

interface ScrubRequest {
	readonly positionFrame: number;
	readonly generation: number;
	readonly preparationGeneration: number;
	readonly projectIdentity: unknown;
}

export function createVideoNavigationService(
	dependencies: VideoNavigationServiceDependencies,
): Readonly<VideoNavigationService> {
	const intervalMilliseconds = positiveFinite(
		dependencies.intervalMilliseconds ?? DEFAULT_INTERVAL_MILLISECONDS,
		'video navigation interval',
	);
	let rate: VideoShuttleRate = 0;
	let anchor: VideoShuttleAnchor | null = null;
	let sessionProjectIdentity: unknown = NO_PROJECT_SESSION;
	let timer: unknown = null;
	let generation = 0;
	let preparationGeneration = 0;
	let preparing = false;
	let scrubActive = false;
	let scrubInFlight = false;
	let pendingScrub: ScrubRequest | null = null;
	let disposed = false;
	let lastPositionFrame: number | null = null;

	const abort = (): void => dispose();
	dependencies.lifetime.signal.addEventListener('abort', abort, { once: true });
	if (dependencies.lifetime.signal.aborted) dispose();

	function view(): VideoNavigationView {
		dependencies.lifetime.assertActive();
		// Snapshot construction is already inside a publish. Retire stale session
		// resources here without recursively requesting another snapshot.
		reconcileProjectChange(false);
		return snapshot();
	}

	function snapshot(): VideoNavigationView {
		const geometry = resolveVideoProgramGeometry(dependencies.getProject());
		const positionFrame = anchor && rate !== 0
			? resolveVideoShuttlePosition(anchor, dependencies.now()).sample
			: clampProgramPosition(dependencies.getPositionFrames(), geometry);
		return Object.freeze({
			sequenceId: geometry.sequenceId,
			rate,
			shuttling: rate !== 0,
			preparing,
			positionFrame,
			programEndFrame: geometry.programEndSample,
		});
	}

	function publish(): VideoNavigationView {
		const next = snapshot();
		dependencies.publish(next);
		return next;
	}

	function changeRate(direction: VideoShuttleDirection): VideoNavigationView {
		dependencies.lifetime.assertActive();
		reconcileProjectChange();
		const nextRate = stepVideoShuttleRate(rate, direction);
		if (nextRate === rate) return snapshot();
		if (nextRate === 0) return stopAtCurrentInstant(true);

		const { project, identity } = readProject();
		const geometry = resolveVideoProgramGeometry(project);
		const now = dependencies.now();
		const position = anchor && sessionProjectIdentity === identity
			? resolveVideoShuttlePosition(anchor, now).sample
			: clampProgramPosition(dependencies.getPositionFrames(), geometry);
		const nextAnchor = createVideoShuttleAnchor(geometry, position, nextRate, now);
		if (atEndInDirection(nextAnchor)) {
			return stopAt(nextAnchor.anchorSample, true, true);
		}

		generation += 1;
		preparationGeneration += 1;
		preparing = false;
		rate = nextRate;
		anchor = nextAnchor;
		sessionProjectIdentity = identity;
		lastPositionFrame = nextAnchor.anchorSample;
		try {
			ensureTimer();
			return requestScrub(nextAnchor.anchorSample);
		} catch (error) {
			return failCurrentOperation(error);
		}
	}

	function stopAtCurrentInstant(settle: boolean): VideoNavigationView {
		if (rate === 0 || !anchor) return snapshot();
		if (sessionProjectIdentity !== currentProjectIdentity()) {
			stopForProjectChange(true);
			return snapshot();
		}
		const position = resolveVideoShuttlePosition(anchor, dependencies.now()).sample;
		return stopAt(position, settle, true);
	}

	function stopAt(positionFrame: number, settle: boolean, shouldPublish: boolean): VideoNavigationView {
		generation += 1;
		preparationGeneration += 1;
		preparing = false;
		pendingScrub = null;
		clearTimer();
		rate = 0;
		anchor = null;
		sessionProjectIdentity = NO_PROJECT_SESSION;
		lastPositionFrame = positionFrame;
		endActiveScrub();
		if (settle) dependencies.seek(positionFrame);
		return shouldPublish ? publish() : snapshot();
	}

	function stopForProjectChange(shouldPublish: boolean): void {
		generation += 1;
		preparationGeneration += 1;
		preparing = false;
		pendingScrub = null;
		clearTimer();
		rate = 0;
		anchor = null;
		sessionProjectIdentity = NO_PROJECT_SESSION;
		lastPositionFrame = null;
		endActiveScrub();
		if (shouldPublish) publish();
	}

	function reconcileProjectChange(shouldPublish = true): void {
		if (sessionProjectIdentity !== NO_PROJECT_SESSION
			&& sessionProjectIdentity !== currentProjectIdentity()) stopForProjectChange(shouldPublish);
	}

	function ensureTimer(): void {
		if (timer !== null) return;
		timer = dependencies.setInterval(tick, intervalMilliseconds);
	}

	function clearTimer(): void {
		if (timer === null) return;
		const active = timer;
		timer = null;
		dependencies.clearInterval(active);
	}

	function tick(): void {
		if (disposed || rate === 0 || !anchor) return;
		try {
			dependencies.lifetime.assertActive();
			if (sessionProjectIdentity !== currentProjectIdentity()) {
				stopForProjectChange(true);
				return;
			}
			const position = resolveVideoShuttlePosition(anchor, dependencies.now());
			if (position.ended) {
				stopAt(position.sample, true, true);
				return;
			}
			if (position.sample !== lastPositionFrame) requestScrub(position.sample);
		} catch (error) {
			failCurrentOperation(error);
		}
	}

	/** Queue only the newest absolute position while audio preparation is live. */
	function requestScrub(positionFrame: number): VideoNavigationView {
		lastPositionFrame = positionFrame;
		const request = Object.freeze({
			positionFrame,
			generation,
			preparationGeneration: ++preparationGeneration,
			projectIdentity: sessionProjectIdentity,
		});
		preparing = true;
		if (scrubInFlight) {
			pendingScrub = request;
			return publish();
		}
		return dispatchScrub(request);
	}

	function dispatchScrub(request: ScrubRequest): VideoNavigationView {
		pendingScrub = null;
		if (!operationIsCurrent(request)) return snapshot();
		let result: unknown;
		try {
			result = dependencies.scrub(request.positionFrame);
			scrubActive = true;
		} catch (error) {
			return failCurrentOperation(error);
		}
		if (!isPromiseLike(result)) {
			preparing = false;
			return publish();
		}
		scrubInFlight = true;
		preparing = true;
		const next = publish();
		void Promise.resolve(result).then(
			() => settlePreparation(request, null),
			(error: unknown) => settlePreparation(request, { error }),
		);
		return next;
	}

	function settlePreparation(
		request: ScrubRequest,
		failure: Readonly<{ error: unknown }> | null,
	): void {
		scrubInFlight = false;
		const current = operationIsCurrent(request);
		if (current && failure) {
			failCurrentOperation(failure.error);
			return;
		}
		const queued = pendingScrub;
		pendingScrub = null;
		if (queued && operationIsCurrent(queued)) {
			dispatchScrub(queued);
			return;
		}
		if (!current) return;
		preparing = false;
		publish();
	}

	function operationIsCurrent(request: ScrubRequest): boolean {
		if (disposed || dependencies.lifetime.signal.aborted) return false;
		if (rate === 0
			|| request.generation !== generation
			|| request.preparationGeneration !== preparationGeneration
			|| request.projectIdentity !== sessionProjectIdentity) return false;
		if (request.projectIdentity !== currentProjectIdentity()) {
			if (sessionProjectIdentity !== NO_PROJECT_SESSION) stopForProjectChange(true);
			return false;
		}
		return true;
	}

	function failCurrentOperation(error: unknown): VideoNavigationView {
		const position = lastPositionFrame ?? 0;
		const next = stopAt(position, false, true);
		dependencies.handleError(error);
		return next;
	}

	function navigate(direction: 'previous' | 'next'): number | null {
		dependencies.lifetime.assertActive();
		reconcileProjectChange();
		if (rate !== 0) stopAtCurrentInstant(true);
		const project = dependencies.getProject();
		const target = resolveAdjacentVideoEditPoint(
			project,
			clampProgramPosition(dependencies.getPositionFrames(), resolveVideoProgramGeometry(project)),
			dependencies.getTargets(),
			direction,
		);
		if (target === null) return null;
		dependencies.seek(target);
		lastPositionFrame = target;
		publish();
		return target;
	}

	function readProject(): Readonly<{ project: DataRecord; identity: unknown }> {
		const project = dependencies.getProject();
		return Object.freeze({
			project,
			identity: dependencies.getProjectIdentity?.() ?? project,
		});
	}

	function currentProjectIdentity(): unknown {
		return dependencies.getProjectIdentity?.() ?? dependencies.getProject();
	}

	function endActiveScrub(): void {
		if (!scrubActive) return;
		scrubActive = false;
		dependencies.endScrub();
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		generation += 1;
		preparationGeneration += 1;
		preparing = false;
		pendingScrub = null;
		clearTimer();
		rate = 0;
		anchor = null;
		sessionProjectIdentity = NO_PROJECT_SESSION;
		try {
			endActiveScrub();
		} catch {
			// Disposal is terminal; cleanup of the remaining owners must continue.
		}
		dependencies.lifetime.signal.removeEventListener('abort', abort);
	}

	return Object.freeze({
		view,
		shuttleReverse: () => changeRate(-1),
		shuttleStop: () => {
			dependencies.lifetime.assertActive();
			reconcileProjectChange();
			return stopAtCurrentInstant(true);
		},
		shuttleForward: () => changeRate(1),
		previousEditPoint: () => navigate('previous'),
		nextEditPoint: () => navigate('next'),
		dispose,
	});
}

function atEndInDirection(anchor: VideoShuttleAnchor): boolean {
	return anchor.rate < 0
		? anchor.anchorSequenceFrame <= 0
		: anchor.anchorSequenceFrame >= anchor.programEndSequenceFrame;
}

function clampProgramPosition(value: unknown, geometry: VideoProgramGeometry): number {
	const position = Number(value);
	if (!Number.isFinite(position)) throw new RangeError('A program position must be finite.');
	const rounded = Math.round(position);
	if (!Number.isSafeInteger(rounded)) throw new RangeError('A program position must be a safe integer.');
	return Math.max(0, Math.min(geometry.programEndSample, rounded));
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return Boolean(
		value
		&& (typeof value === 'object' || typeof value === 'function')
		&& 'then' in value
		&& typeof (value as Readonly<{ then?: unknown }>).then === 'function',
	);
}

function positiveFinite(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		throw new RangeError(`${name} must be positive and finite.`);
	}
	return value;
}
