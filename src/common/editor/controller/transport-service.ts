/* SPDX-License-Identifier: AGPL-3.0-only */

import { hasCoreEditingProjectAuthority } from '../project-schema-version.ts';

export interface TransportServiceRuntime {
	// Legacy JavaScript ports are narrowed as their owning services migrate.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly [name: string]: any;
}

type RuntimeValue = TransportServiceRuntime[string];

/** Wake often enough that every pulse is queued well before the audio clock reaches it. */
const METRONOME_TICK_MS = 25;
const METRONOME_LOOKAHEAD_SECONDS = 0.15;
/** A playhead this far from where the cursor expects it is a seek, not timer jitter. */
const METRONOME_RESYNC_SECONDS = 0.25;
/** A tempo map cannot legitimately pack more pulses than this into one lookahead. */
const METRONOME_MAXIMUM_PULSES_PER_TICK = 64;

export function createEditorTransportService(runtime: TransportServiceRuntime) {
	const {
		AUDIO_EDITOR_SAMPLE_RATE, abortError, activeSelection, assertPlayAtSpeedStaffPadMemorySafe,
		beginPlaybackCachePreparation, calculateAudioEditorMetronomeSchedule, cancelPlaybackCachePreparation, cancelTimedRecording,
		commit, copy, editorTimelineDurationFrames, engine,
		formatPlaybackRate, hasMissingTimelineSources, persistSetting, playAtSpeedPitchPreserver,
		productSettingKey, getProject, projectDurationFrames, publishDocumentSnapshot,
		setSelection, setStatus, startRecording, state,
		stopProjectBinPreview, stopRecording, throwIfAborted,
	} = runtime;
	let metronomeSchedulerGeneration = 0;
	function setPlayAtSpeedRate(value: RuntimeValue) {
		const rate = Number(value);
		if (!Number.isFinite(rate) || rate < 0.5 || rate > 2) {
			throw new RangeError('Playback speed must be between 0.5 and 2.');
		}
		state.playAtSpeedRate = rate;
		publishDocumentSnapshot();
		return rate;
	}

	function cancelPlayAtSpeedPreparation({ status = false }: RuntimeValue = {}) {
		const active = state.playAtSpeedAbort;
		state.playAtSpeedGeneration += 1;
		state.playAtSpeedAbort = null;
		active?.abort();
		if (active) {
			if (status) setStatus(copy.ready);
			else publishDocumentSnapshot();
		}
		return Boolean(active);
	}

	function retireTimelinePlayback() {
		cancelPlaybackCachePreparation();
		cancelPlayAtSpeedPreparation();
		return engine.stop();
	}

	async function handlePlayAtSpeed(requestedRate: RuntimeValue = state.playAtSpeedRate) {
		if (state.recordingStarting || state.timedRecordingPreparing || state.timedRecording || state.recorder) return false;
		if (hasMissingTimelineSources()) throw new Error(copy.localSourcesMissing);
		const rate = setPlayAtSpeedRate(requestedRate);
		const currentPlayback = engine.getState();
		const playAtSpeedActive = currentPlayback.state === 'playing'
			&& ['naive', 'staffpad'].includes(currentPlayback.playbackMode);
		if (playAtSpeedActive) {
			cancelPlaybackCachePreparation();
			return engine.pause();
		}
		if (state.playAtSpeedAbort) {
			cancelPlayAtSpeedPreparation({ status: true });
			return false;
		}
		if (currentPlayback.state === 'playing') engine.pause();
		const preservePitch = state.preferences.playback?.playAtSpeedMode === 'staffpad';
		if (preservePitch) assertPlayAtSpeedStaffPadMemorySafe(
			projectDurationFrames(getProject()),
			projectSampleRate(),
			rate,
		);
		const snapshot = getProject();
		const generation = ++state.playAtSpeedGeneration;
		const abort = new AbortController();
		state.playAtSpeedAbort = abort;
		if (preservePitch) setStatus(copy.playAtSpeedPreparing);
		else publishDocumentSnapshot();
		try {
			await beginPlaybackCachePreparation(snapshot, { abortController: abort });
			throwIfAborted(abort.signal);
			if (snapshot !== getProject()) throw abortError();
			if (typeof engine.playAtSpeed !== 'function') return engine.play();
			await engine.playAtSpeed(rate, {
				preservePitch,
				pitchPreserver: playAtSpeedPitchPreserver,
				signal: abort.signal,
			});
			if (generation === state.playAtSpeedGeneration && !abort.signal.aborted) {
				setStatus(copy.playAtSpeedPlaying.replace('{rate}', formatPlaybackRate(rate)), 'success');
			}
			return true;
		} catch (error) {
			if ((error as Readonly<{ name?: string }>)?.name === 'AbortError' || abort.signal.aborted) return false;
			throw error;
		} finally {
			if (generation === state.playAtSpeedGeneration) {
				state.playAtSpeedAbort = null;
				publishDocumentSnapshot();
			}
		}
	}

	async function handleTransport(action: RuntimeValue) {
		if ((state.recordingStarting || state.timedRecordingPreparing || state.timedRecording || state.recorder)
			&& action !== 'stop' && action !== 'record') return;
		if ((action === 'play' || action === 'record') && state.projectBinPreview) {
			await stopProjectBinPreview();
		}
		if (hasMissingTimelineSources() && action === 'play') throw new Error(copy.localSourcesMissing);
		if (action === 'play') {
			// The transport has a single play control. Once the speed slider leaves the
			// neutral rate that control owns play-at-speed instead: it starts, pauses and
			// cancels the rate-changed playback, so no separate command is needed.
			if (state.playAtSpeedRate !== 1) return handlePlayAtSpeed();
			cancelPlayAtSpeedPreparation();
			if (engine.getState().state === 'playing') {
				cancelPlaybackCachePreparation();
				return engine.pause();
			}
			if (state.playbackCacheAbort) {
				cancelPlaybackCachePreparation();
				return;
			}
			const snapshot = getProject();
			await beginPlaybackCachePreparation(snapshot);
			if (snapshot !== getProject()) return;
			return engine.play();
		}
		if (action === 'stop') {
			cancelPlaybackCachePreparation();
			cancelPlayAtSpeedPreparation();
			if (state.timedRecording || state.timedRecordingPreparing) return cancelTimedRecording();
			return state.recorder ? stopRecording() : engine.stop();
		}
		if (action === 'jump-start') return engine.seek(0);
		if (action === 'jump-end') return engine.seek(editorTimelineDurationFrames(getProject(), projectSampleRate()));
		if (action === 'rewind') return engine.seek(engine.getPositionFrames() - projectSampleRate() * 5);
		if (action === 'forward') return engine.seek(engine.getPositionFrames() + projectSampleRate() * 5);
		if (action === 'loop') {
			const selection = activeSelection();
			const enabled = !getProject()?.loop?.enabled;
			const storedLoop = getProject().loop?.endFrame > getProject().loop?.startFrame
				? getProject().loop
				: null;
			const range = storedLoop || selection || {
				startFrame: 0,
				endFrame: Math.max(1, Math.round(projectSampleRate() * 4)),
			};
			const next = commitLoopRange({ ...range, enabled });
			engine.setLoop(next.loop);
			return;
		}
		if (action === 'record') return state.recorder ? stopRecording() : startRecording();
	}

	function clearLoopRegion() {
		const current = getProject().loop || { startFrame: 0, endFrame: 0 };
		const next = commit({ type: 'loop/set', enabled: false, ...current });
		engine.setLoop(next.loop);
		return next.loop;
	}

	function setLoopRegionToSelection() {
		const selection = activeSelection();
		if (!selection) throw new Error(copy.timeSelectionRequired);
		const next = commitLoopRange({ enabled: true, ...selection });
		engine.setLoop(next.loop);
		return next.loop;
	}

	function setLoopRegion(startFrame: RuntimeValue, endFrame: RuntimeValue) {
		const start = normalizeTimelineFrame(Math.min(startFrame, endFrame));
		const end = normalizeTimelineFrame(Math.max(startFrame, endFrame));
		if (end <= start) throw new Error(copy.timeSelectionRequired);
		const next = commitLoopRange({ enabled: true, startFrame: start, endFrame: end });
		engine.setLoop(next.loop);
		return next.loop;
	}

	function setSelectionToLoopRegion() {
		const loop = getProject().loop;
		if (!loop?.enabled || loop.endFrame <= loop.startFrame) throw new Error(copy.timeSelectionRequired);
		return setSelection(loop.startFrame, loop.endFrame);
	}

	function setLoopRegionInOut() {
		const selection = activeSelection();
		if (selection) return setLoopRegionToSelection();
		const startFrame = normalizeTimelineFrame(engine.getPositionFrames());
		const endFrame = projectDurationFrames(getProject());
		if (endFrame <= startFrame) throw new Error(copy.timeSelectionRequired);
		const next = commitLoopRange({ enabled: true, startFrame, endFrame });
		engine.setLoop(next.loop);
		return next.loop;
	}

	function toggleSelectionFollowsLoop() {
		state.selectionFollowsLoop = !state.selectionFollowsLoop;
		void persistSetting(productSettingKey('selection-follows-loop'), state.selectionFollowsLoop);
		if (state.selectionFollowsLoop && getProject().loop?.enabled) setSelectionToLoopRegion();
		else publishDocumentSnapshot();
		return state.selectionFollowsLoop;
	}

	function commitLoopRange(range: RuntimeValue) {
		const loopCommand = { type: 'loop/set', ...range };
		if (!range.enabled || !state.selectionFollowsLoop) return commit(loopCommand);
		const project = getProject();
		const selection = project.selection || {};
		return commit({
			type: 'batch',
			commands: [loopCommand, {
				type: 'selection/set',
				startFrame: range.startFrame,
				endFrame: range.endFrame,
				...(hasCoreEditingProjectAuthority(project) ? {
					trackIds: selection.trackIds || [],
					clipIds: selection.clipIds || [],
					frequencyRange: selection.frequencyRange || null,
				} : {}),
			}],
		});
	}

	function toggleMetronome() {
		state.metronomeEnabled = !state.metronomeEnabled;
		void persistSetting(productSettingKey('transport-metronome'), state.metronomeEnabled);
		syncMetronome();
		publishDocumentSnapshot();
		return state.metronomeEnabled;
	}

	function syncMetronome() {
		stopMetronome();
		if (!state.metronomeEnabled || !['playing', 'recording'].includes(state.transportState)) return;
		void runMetronomeScheduler();
	}

	function metronomeRunning() {
		return Boolean(state.metronomeEnabled)
			&& ['playing', 'recording'].includes(state.transportState)
			&& !state.disposed;
	}

	/**
	 * Queue every pulse that falls inside a short lookahead on the audio clock, then wake
	 * again on a fixed tick. The timer only decides when to look ahead; the audio clock
	 * alone decides when a click sounds, so timer jitter cannot move a beat.
	 *
	 * Scheduling one pulse per wake-up and re-deriving the next from the live playhead made
	 * the click pattern a-rhythmic: a timer that fired late read a playhead already past
	 * the next pulse and dropped it, and one that fired early re-queued the pulse it had
	 * just scheduled. Nothing carried a cursor between wake-ups, so the error never
	 * corrected.
	 */
	async function runMetronomeScheduler(generation = metronomeSchedulerGeneration) {
		if (!metronomeSchedulerIsCurrent(generation)) return;
		try {
			const context = await engine.getAudioContext?.({ resume: false });
			if (metronomeSchedulerIsCurrent(generation)
				&& context?.createOscillator && context?.createGain && context.destination) {
				scheduleMetronomeWindow(context);
			}
		} catch {
			// A missing oscillator API must not interrupt transport or recording.
		}
		if (!metronomeSchedulerIsCurrent(generation)) return;
		const timer = globalThis.setTimeout(() => {
			if (state.metronomeTimer === timer) state.metronomeTimer = 0;
			void runMetronomeScheduler(generation);
		}, METRONOME_TICK_MS);
		state.metronomeTimer = timer;
		(timer as unknown as { unref?: () => void }).unref?.();
	}

	function metronomeSchedulerIsCurrent(generation: number) {
		return generation === metronomeSchedulerGeneration && metronomeRunning();
	}

	function scheduleMetronomeWindow(context: RuntimeValue) {
		const project = getProject();
		const sampleRate = projectSampleRate();
		const playbackRate = state.transportState === 'playing'
			? Number(engine.getState?.().playbackRate) || 1
			: 1;
		const framesPerSecond = sampleRate * playbackRate;
		if (!Number.isFinite(framesPerSecond) || framesPerSecond <= 0) return;
		const position = Math.max(0, engine.getPositionFrames());
		let anchor = state.metronomeAnchor;
		// The cursor is only meaningful while the playhead keeps advancing from where it
		// was anchored, so a seek, a rate change, or a fresh start re-anchors it.
		const expectedFrame = anchor
			? anchor.frame + (context.currentTime - anchor.contextTime) * framesPerSecond
			: 0;
		if (!anchor || anchor.playbackRate !== playbackRate
			|| Math.abs(position - expectedFrame) > METRONOME_RESYNC_SECONDS * framesPerSecond) {
			anchor = { contextTime: context.currentTime, frame: position, cursorFrame: position, playbackRate };
			state.metronomeAnchor = anchor;
		}
		const horizonFrame = anchor.frame
			+ (context.currentTime + METRONOME_LOOKAHEAD_SECONDS - anchor.contextTime) * framesPerSecond;
		for (let queued = 0; queued < METRONOME_MAXIMUM_PULSES_PER_TICK; queued += 1) {
			const cursorFrame = Math.max(0, Math.round(anchor.cursorFrame));
			const { beatIndex, delaySeconds, accent } = calculateAudioEditorMetronomeSchedule({
				bpm: project?.tempo?.bpm,
				tempoMap: project?.tempoMap,
				signatureMap: project?.signatureMap,
				timeSignature: project?.tempo?.timeSignature,
				sampleRate,
				positionFrame: cursorFrame,
				playbackRate,
			});
			const pulseFrame = Math.round(cursorFrame + delaySeconds * framesPerSecond);
			if (pulseFrame > horizonFrame) return;
			const when = anchor.contextTime + (pulseFrame - anchor.frame) / framesPerSecond;
			// A pulse already behind the audio clock cannot be sounded, but the cursor still
			// has to step past it so the window keeps moving forward.
			if (when >= context.currentTime) {
				emitMetronomeClick(context, when, accent ?? (beatIndex % 4 === 0 ? 'bar' : 'beat'));
			}
			anchor.cursorFrame = pulseFrame + 1;
		}
	}

	function emitMetronomeClick(context: RuntimeValue, when: number, accent: string) {
		const oscillator = context.createOscillator();
		const gain = context.createGain();
		// A click queued inside the lookahead has not sounded yet, so stopping the
		// metronome has to reach it; otherwise the transport stops and the last window of
		// clicks keeps playing after it.
		state.metronomePending = [...(state.metronomePending ?? []), oscillator];
		oscillator.frequency.setValueAtTime(
			accent === 'bar' ? 1320 : accent === 'group' ? 1100 : 880,
			when,
		);
		gain.gain.setValueAtTime(0.0001, when);
		gain.gain.exponentialRampToValueAtTime(0.12, when + 0.002);
		gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.035);
		oscillator.connect(gain);
		gain.connect(context.destination);
		oscillator.start(when);
		oscillator.stop(when + 0.04);
		oscillator.onended = () => {
			state.metronomePending = (state.metronomePending ?? []).filter((pending: RuntimeValue) => pending !== oscillator);
			try { oscillator.disconnect(); } catch { /* Already disconnected. */ }
			try { gain.disconnect(); } catch { /* Already disconnected. */ }
		};
	}

	function stopMetronome() {
		metronomeSchedulerGeneration += 1;
		globalThis.clearTimeout(state.metronomeTimer);
		state.metronomeTimer = 0;
		state.metronomeAnchor = null;
		for (const oscillator of state.metronomePending ?? []) {
			try { oscillator.stop(); } catch { /* Already stopped or never started. */ }
		}
		state.metronomePending = [];
	}

	function normalizeTimelineFrame(value: RuntimeValue) {
		const maximum = getProject() ? projectDurationFrames(getProject()) : 0;
		const frame = Number(value);
		if (!Number.isFinite(frame)) throw new TypeError(copy.timelineFramesFinite);
		return Math.max(0, Math.min(maximum, Math.round(frame)));
	}

	function normalizePlaybackFrame(value: RuntimeValue) {
		const maximum = getProject() ? editorTimelineDurationFrames(getProject(), projectSampleRate()) : 0;
		const frame = Number(value);
		if (!Number.isFinite(frame)) throw new TypeError(copy.timelineFramesFinite);
		return Math.max(0, Math.min(maximum, Math.round(frame)));
	}

	function projectSampleRate() {
		return Number.isSafeInteger(getProject()?.sampleRate) && getProject().sampleRate > 0
			? getProject().sampleRate
			: AUDIO_EDITOR_SAMPLE_RATE;
	}
	return Object.freeze({
		setPlayAtSpeedRate,
		cancelPlayAtSpeedPreparation,
		retireTimelinePlayback,
		handlePlayAtSpeed,
		handleTransport,
		clearLoopRegion,
		setLoopRegionToSelection,
		setLoopRegion,
		setSelectionToLoopRegion,
		setLoopRegionInOut,
		toggleSelectionFollowsLoop,
		commitLoopRange,
		toggleMetronome,
		syncMetronome,
		runMetronomeScheduler,
		stopMetronome,
		normalizeTimelineFrame,
		normalizePlaybackFrame,
		projectSampleRate,
	});
}
