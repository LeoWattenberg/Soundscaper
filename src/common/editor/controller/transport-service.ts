/* SPDX-License-Identifier: AGPL-3.0-only */

export interface TransportServiceRuntime {
	// Legacy JavaScript ports are narrowed as their owning services migrate.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly [name: string]: any;
}

type RuntimeValue = TransportServiceRuntime[string];

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
		const selection = getProject().selection || {};
		return commit({
			type: 'batch',
			commands: [loopCommand, {
				type: 'selection/set',
				startFrame: range.startFrame,
				endFrame: range.endFrame,
				...(getProject().schemaVersion >= 2 ? {
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
		void scheduleMetronomeClick();
	}

	async function scheduleMetronomeClick() {
		if (!state.metronomeEnabled || !['playing', 'recording'].includes(state.transportState) || state.disposed) return;
		const bpm = Math.max(1, Number(getProject()?.tempo?.bpm) || 120);
		const sampleRate = projectSampleRate();
		const position = Math.max(0, engine.getPositionFrames());
		const playbackRate = state.transportState === 'playing'
			? Number(engine.getState?.().playbackRate) || 1
			: 1;
		const {
			beatIndex,
			delaySeconds,
			beatDurationSeconds,
		} = calculateAudioEditorMetronomeSchedule({ bpm, sampleRate, positionFrame: position, playbackRate });
		try {
			const context = await engine.getAudioContext?.({ resume: false });
			if (context?.createOscillator && context?.createGain && context.destination) {
				const oscillator = context.createOscillator();
				const gain = context.createGain();
				const numerator = Math.max(1, Number(getProject()?.tempo?.timeSignature?.numerator) || 4);
				const when = context.currentTime + delaySeconds;
				oscillator.frequency.setValueAtTime(beatIndex % numerator === 0 ? 1320 : 880, when);
				gain.gain.setValueAtTime(0.0001, when);
				gain.gain.exponentialRampToValueAtTime(0.12, when + 0.002);
				gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.035);
				oscillator.connect(gain);
				gain.connect(context.destination);
				oscillator.start(when);
				oscillator.stop(when + 0.04);
				oscillator.onended = () => {
					try { oscillator.disconnect(); } catch { /* Already disconnected. */ }
					try { gain.disconnect(); } catch { /* Already disconnected. */ }
				};
			}
		} catch {
			// A missing oscillator API must not interrupt transport or recording.
		}
		const delayMs = Math.max(10, (delaySeconds + beatDurationSeconds) * 1000);
		state.metronomeTimer = globalThis.setTimeout(() => {
			state.metronomeTimer = 0;
			void scheduleMetronomeClick();
		}, delayMs);
		state.metronomeTimer?.unref?.();
	}

	function stopMetronome() {
		globalThis.clearTimeout(state.metronomeTimer);
		state.metronomeTimer = 0;
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
		scheduleMetronomeClick,
		stopMetronome,
		normalizeTimelineFrame,
		normalizePlaybackFrame,
		projectSampleRate,
	});
}
