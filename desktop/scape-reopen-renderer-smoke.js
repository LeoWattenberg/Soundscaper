/* SPDX-License-Identifier: AGPL-3.0-only */

export async function runScapeReopenRendererSmoke(scope, plan) {
	const currentProjectSchemaVersion = 1;
	const document = scope?.document;
	const api = scope?.soundscaperProjectLibraryDesktop?.v1;
	if (!document || typeof document.querySelectorAll !== 'function'
		|| typeof scope?.setTimeout !== 'function'
		|| typeof scope?.requestAnimationFrame !== 'function'
		|| !api || typeof api.connect !== 'function' || typeof api.readProjectBundle !== 'function') {
		throw new Error('Packaged Scape persisted-reopen renderer environment is incomplete');
	}
	const closed = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
		&& JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
	if (!closed(plan, ['mode', 'productId', 'project', 'schemaVersion', 'token'])
		|| plan.schemaVersion !== 1 || plan.mode !== 'scape-persistent-reopen-v1'
		|| plan.productId !== 'soundscaper' || !/^[a-f\d]{32}$/u.test(plan.token)
		|| !closed(plan.project, ['clipId', 'id', 'revision', 'sourceId', 'title', 'trackId'])) {
		throw new TypeError('Packaged Scape persisted-reopen plan is invalid');
	}
	await api.connect();
	const projectBundle = await api.readProjectBundle(plan.project.id);
	const projectDocument = projectBundle?.document;
	if (typeof projectDocument !== 'string') {
		throw new Error('Persisted shared project is unavailable on descriptor-free reopen');
	}
	let project;
	try {
		project = JSON.parse(projectDocument);
	} catch {
		throw new Error('Persisted shared project is not canonical JSON');
	}
	if (JSON.stringify(project) !== projectDocument) {
		throw new Error('Persisted shared project is not canonical JSON');
	}
	if (!project || typeof project !== 'object' || Array.isArray(project)
		|| project.schemaFamily !== 'soundscaper'
		|| project.schemaVersion !== currentProjectSchemaVersion || project.id !== plan.project.id
		|| project.title !== plan.project.title || project.revision !== plan.project.revision
		|| !Array.isArray(project.timelineAnnotations)) {
		throw new Error('Persisted shared project identity does not match its descriptor');
	}
	if (!Array.isArray(project.sources) || project.sources.length !== 1) {
		throw new Error('Persisted shared project must expose exactly one source');
	}
	if (!Array.isArray(project.tracks) || project.tracks.length !== 1) {
		throw new Error('Persisted shared project must expose exactly one track');
	}
	if (!Array.isArray(project.clips) || project.clips.length !== 1) {
		throw new Error('Persisted shared project must expose exactly one clip');
	}
	const [source] = project.sources;
	const [track] = project.tracks;
	const [clip] = project.clips;
	if (!source || typeof source !== 'object' || Array.isArray(source)
		|| source.id !== plan.project.sourceId || source.kind !== 'audio') {
		throw new Error('Persisted shared project source identity is invalid');
	}
	if (!track || typeof track !== 'object' || Array.isArray(track)
		|| track.id !== plan.project.trackId || track.type !== 'audio'
		|| !Array.isArray(track.clipIds) || track.clipIds.length !== 1
		|| track.clipIds[0] !== plan.project.clipId) {
		throw new Error('Persisted shared project track does not own the expected clip');
	}
	if (!clip || typeof clip !== 'object' || Array.isArray(clip)
		|| clip.id !== plan.project.clipId || clip.kind !== 'audio'
		|| clip.sourceId !== plan.project.sourceId) {
		throw new Error('Persisted shared project clip does not reference the expected source');
	}
	const assertCleanUi = () => {
		const alerts = document.querySelectorAll('[role="alert"], [role="alertdialog"]');
		const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
		if (alerts.length || dialogs.length) {
			const exposed = [...alerts, ...dialogs].slice(0, 3).map((element) => (
				`${element.getAttribute?.('role') ?? 'dialog'}: ${String(element.getAttribute?.('aria-label') || element.textContent || '').replace(/\s+/gu, ' ').trim().slice(0, 120)}`
			));
			throw new Error(`Packaged Scape persisted-reopen UI exposed an alert or dialog (${exposed.join('; ')})`);
		}
	};
	const nextAnimationFrame = () => new Promise((resolve) => scope.requestAnimationFrame(resolve));
	const provePlayback = async (root) => {
		const playSelector = '.kw-audio-editor__transport-play .kw-audio-editor__split-button-main button[aria-label="Play"]';
		const pauseSelector = '.kw-audio-editor__transport-play .kw-audio-editor__split-button-main button[aria-label="Pause"]';
		const stopSelector = '.kw-audio-editor__transport button[aria-label="Stop"]';
		const playheadSelector = '[data-playhead][role="slider"]';
		const meterSelector = '[data-side-playback-meter] [data-playback-meter][data-meter-kind="playback"]'
			+ '[data-meter-type="db-log"][data-meter-db-range="60"] [role="meter"]';
		const plays = root.querySelectorAll(playSelector);
		const stops = root.querySelectorAll(stopSelector);
		const playheads = root.querySelectorAll(playheadSelector);
		const meters = root.querySelectorAll(meterSelector);
		const projections = root.querySelectorAll('.audio-editor-timeline-panel');
		if (plays.length !== 1 || plays[0].disabled !== false
			|| plays[0].getAttribute('aria-pressed') !== 'false'
			|| stops.length !== 1 || stops[0].disabled !== false
			|| playheads.length !== 1 || meters.length !== 1 || projections.length !== 1) {
			throw new Error('Packaged Scape persisted-reopen playback controls or evidence are incomplete');
		}
		const playhead = playheads[0];
		const meter = meters[0];
		const projection = projections[0];
		const initialPlayheadX = Number.parseFloat(projection.style.getPropertyValue('--timeline-playhead-x'));
		const initialPlayheadFrame = Number(playhead.getAttribute('aria-valuenow'));
		const meterFloor = Number(meter.getAttribute('aria-valuemin'));
		const initialMeterValue = Number(meter.getAttribute('aria-valuenow'));
		if (!Number.isFinite(initialPlayheadX) || initialPlayheadFrame !== 0
			|| !Number.isFinite(meterFloor) || initialMeterValue !== meterFloor) {
			throw new Error('Packaged Scape persisted-reopen playback evidence did not begin at its floor and origin');
		}
		plays[0].click();
		let transportEntered = false;
		let playheadAdvanced = false;
		let meterAboveFloor = false;
		let stopping = false;
		for (let frame = 0; frame < 512; frame += 1) {
			await nextAnimationFrame();
			assertCleanUi();
			if (stopping) {
				const restored = root.querySelectorAll(playSelector);
				const paused = root.querySelectorAll(pauseSelector);
				if (restored.length === 1 && restored[0].disabled === false
					&& restored[0].getAttribute('aria-pressed') === 'false'
					&& paused.length === 0 && playhead.getAttribute('aria-valuenow') === '0') {
					return {
						transportEntered: true,
						playheadAdvanced: true,
						meterAboveFloor: true,
						transportStopped: true,
					};
				}
				continue;
			}
			const pauses = root.querySelectorAll(pauseSelector);
			const active = pauses.length === 1 && pauses[0].disabled === false
				&& pauses[0].getAttribute('aria-pressed') === 'true';
			if (active) {
				transportEntered = true;
				const currentX = Number.parseFloat(projection.style.getPropertyValue('--timeline-playhead-x'));
				if (Number.isFinite(currentX) && currentX > initialPlayheadX) playheadAdvanced = true;
				const meterValue = Number(meter.getAttribute('aria-valuenow'));
				if (Number.isFinite(meterValue) && meterValue > initialMeterValue) meterAboveFloor = true;
				if (playheadAdvanced && meterAboveFloor) {
					const activeStops = root.querySelectorAll(stopSelector);
					if (activeStops.length !== 1 || activeStops[0].disabled !== false) {
						throw new Error('Packaged Scape persisted-reopen Stop control became unavailable');
					}
					activeStops[0].click();
					stopping = true;
				}
				continue;
			}
			if (transportEntered && root.querySelectorAll(playSelector).length === 1) {
				throw new Error('Packaged Scape persisted-reopen playback ended before evidence completed');
			}
		}
		throw new Error('Packaged Scape persisted-reopen playback evidence timed out');
	};

	const now = () => scope.Date?.now?.() ?? Date.now();
	const delay = (milliseconds) => new Promise((resolve) => scope.setTimeout(resolve, milliseconds));
	const deadline = now() + 45_000;
	let zoomInClicks = 0;
	let chooserAnswers = 0;
	while (true) {
		// A fresh smoke profile is a first launch, so the workspace chooser opens
		// over the editor; it is answered with the default workspace, as the
		// other packaged smokes do, and given a render turn before the UI is
		// judged clean. A chooser that will not go is reported by name below.
		const chooser = document.querySelectorAll('[data-workspace-onboarding-option="modern"]')[0];
		if (chooser && chooserAnswers < 40) {
			chooserAnswers += 1;
			chooser.click?.();
			await delay(25);
			continue;
		}
		assertCleanUi();
		const roots = document.querySelectorAll('[data-audio-editor][data-audio-editor-bound="true"]');
		if (roots.length === 1) {
			const root = roots[0];
			const escape = scope.CSS?.escape;
			if (typeof escape !== 'function') {
				throw new Error('Packaged Scape persisted-reopen selector escaping is unavailable');
			}
			const trackSelector = `[data-track-row][data-track-id="${escape(plan.project.trackId)}"]`;
			const clipSelector = `[data-clip-id="${escape(plan.project.clipId)}"]`;
			const tabs = root.querySelectorAll('.kw-audio-editor__project-tabs [role="tab"][aria-selected="true"]');
			const tracks = root.querySelectorAll(trackSelector);
			const clips = tracks.length === 1 ? tracks[0].querySelectorAll(clipSelector) : [];
			const waveforms = clips.length === 1
				? clips[0].querySelectorAll('canvas.clip-body__waveform')
				: [];
			const statuses = root.querySelectorAll('[data-editor-status][data-state="success"]');
			const waveform = waveforms.length === 1 ? waveforms[0] : null;
			if (waveform && waveform.getAttribute('data-waveform-error') !== null) {
				throw new Error('Packaged Scape persisted-reopen UI exposed a waveform error');
			}
			const identityReady = root.getAttribute('data-project-id') === plan.project.id
				&& root.getAttribute('data-track-count') === '1'
				&& root.getAttribute('data-clip-count') === '1'
				&& tabs.length === 1 && tabs[0].textContent.trim() === plan.project.title
				&& tracks.length === 1 && clips.length === 1 && waveforms.length === 1
				&& statuses.length === 1 && statuses[0].textContent.trim();
			if (identityReady && waveform.getAttribute('data-waveform-renderer') === 'audacity'
				&& waveform.getAttribute('data-waveform-source') === 'peaks') {
				const zoomButtons = root.querySelectorAll(
					'.kw-audio-editor__zoom-actions button[aria-label="Zoom in"]',
				);
				if (zoomButtons.length !== 1 || typeof zoomButtons[0].click !== 'function') {
					throw new Error('Packaged Scape persisted-reopen UI has no exact Zoom In control');
				}
				if (zoomInClicks >= 12) {
					throw new Error('Packaged Scape persisted-reopen waveform did not reach PCM rendering');
				}
				zoomButtons[0].click();
				zoomInClicks += 1;
			}
			if (identityReady
				&& waveform.getAttribute('data-waveform-renderer') === 'audacity'
				&& waveform.getAttribute('data-waveform-source') === 'pcm') {
				const playback = await provePlayback(root);
				return {
					sharedProject: {
						schemaFamily: 'soundscaper',
						schemaVersion: currentProjectSchemaVersion,
						revision: plan.project.revision,
						sourceCount: 1,
						trackCount: 1,
						clipCount: 1,
					},
					renderer: {
						projectId: plan.project.id,
						trackCount: 1,
						clipCount: 1,
						activeTabTitle: plan.project.title,
						trackId: plan.project.trackId,
						clipId: plan.project.clipId,
						waveformRenderer: 'audacity',
						waveformSource: 'pcm',
						waveformError: false,
						statusState: 'success',
						alertCount: 0,
						dialogCount: 0,
					},
					playback,
				};
			}
		}
		if (now() >= deadline) {
			throw new Error('Packaged Scape persisted-reopen smoke timed out waiting for persisted project UI');
		}
		await delay(25);
	}
}
