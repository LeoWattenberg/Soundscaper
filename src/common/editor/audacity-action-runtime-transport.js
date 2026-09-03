/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Transport action group for the Audacity parity runtime.
 *
 * Audacity 4.0.0 splits the single `action://playback/play` action into
 * `toggle-play-pause`, `toggle-play-stop` and `toggle-play-from-cursor`. The
 * first keeps the existing controller behaviour; the other two are composed
 * here from the controller's own play, stop and seek operations so that the
 * runtime never reimplements transport state.
 */
export function createTransportActionGroup({ controller, controllerActions, project }) {
	const playing = () => controller.getTelemetrySnapshot?.()?.transportState === 'playing';
	const recording = () => {
		const snapshot = controller.getSnapshot?.();
		return Boolean(snapshot?.recording || snapshot?.recordingStarting
			|| snapshot?.recordingScheduling || snapshot?.scheduledRecording);
	};

	return {
		...controllerActions.transport,
		pause: controllerActions.transport.playPause,
		playStop: () => {
			if (recording()) return controllerActions.recording.stop();
			return playing()
				? controllerActions.transport.stop()
				: controllerActions.transport.playPause();
		},
		playFromCursor: () => {
			if (playing()) return controllerActions.transport.playPause();
			const selection = project()?.selection;
			if (selection && selection.endFrame > selection.startFrame) {
				controllerActions.transport.seek(selection.startFrame);
			}
			return controllerActions.transport.playPause();
		},
		setPlaybackTime: controllerActions.transport.seek,
	};
}
