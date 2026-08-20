import {
	expect,
	test,
} from './audio-editor-test-fixtures.js';
import {
	assertAccessibleBasics,
	assertNoSeriousAxeViolations,
	bootEditor,
	getMenuItem,
	openNestedCommandMenu,
	registerAudioEditorHooks,
	trackNameText,
	waitForEditor,
} from './audio-editor-test-helpers.js';

const SOURCE_LABELS = Object.freeze({
	camera: 'Camera',
	microphone: 'Microphone',
	display: 'Screen',
});

const REQUIRED_SOURCE_COMBINATIONS = Object.freeze([
	Object.freeze({ roles: ['camera'], calls: ['user'], tracks: 1 }),
	Object.freeze({ roles: ['microphone'], calls: ['user'], tracks: 1 }),
	Object.freeze({ roles: ['display'], calls: ['display'], tracks: 2, systemAudio: true }),
	Object.freeze({ roles: ['camera', 'microphone'], calls: ['user'], tracks: 2 }),
	Object.freeze({ roles: ['display', 'microphone'], calls: ['display', 'user'], tracks: 2, systemAudio: false }),
	Object.freeze({ roles: ['camera', 'display', 'microphone'], calls: ['display', 'user'], tracks: 4, systemAudio: true }),
]);

test.describe('Framescaper V19 recoverable capture', () => {
	registerAudioEditorHooks();

	test('is default-hidden and opens setup without implicit device access', async ({ page }) => {
		await installCaptureHarness(page);
		const editor = await bootEditor(page, '/framescaper/en/');
		const workspacePanel = recordingSetupWorkspacePanel(editor);

		await expect(workspacePanel).toHaveCount(0);
		await expect(editor.getByRole('button', { name: 'Recording setup', exact: true })).toHaveCount(0);
		await expectCaptureCalls(page, []);

		const panels = await openNestedCommandMenu(page, editor, 'View', ['Panels']);
		const setupItem = getMenuItem(panels, 'Recording setup');
		await expect(setupItem).toBeEnabled();
		await expectCaptureCalls(page, []);
		await setupItem.focus();
		await setupItem.press('Enter');

		const panel = await waitForRecordingSetup(editor);
		await expect(panel.getByRole('status')).toContainText('Capture is inactive.');
		await expectCaptureCalls(page, []);
		await assertAccessibleBasics(panel);
		await assertNoSeriousAxeViolations(page, '[data-workspace-panel="recording-setup"]');

		const toolbarRecord = editor.getByRole('button', { name: 'Recording setup', exact: true });
		await expect(toolbarRecord).toBeVisible();
		await editor.getByRole('button', { name: 'Close: Recording setup', exact: true }).click();
		await expect(workspacePanel).toHaveCount(0);
		await toolbarRecord.press('Enter');
		await waitForRecordingSetup(editor);
		await expectCaptureCalls(page, []);
	});

	test('fails closed on the embedded route without requesting permission', async ({ page }) => {
		await installCaptureHarness(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		const panel = await openRecordingSetup(page, editor);

		await expect(panel.getByRole('status')).toContainText('Capture is unavailable in this runtime');
		await expect(panel.getByRole('button', { name: 'Preview sources', exact: true })).toHaveCount(0);
		await expectCaptureCalls(page, []);
		await assertAccessibleBasics(panel);
	});

	test('previews all six required combinations and optional system audio from direct gestures', async ({ page }) => {
		test.setTimeout(120_000);
		await installCaptureHarness(page);
		const editor = await bootEditor(page, '/framescaper/en/');
		const panel = await openRecordingSetup(page, editor);
		let expectedStops = 0;
		let requestOffset = 0;

		for (const combination of REQUIRED_SOURCE_COMBINATIONS) {
			await page.evaluate((enabled) => {
				globalThis.__framescaperCaptureHarness.includeSystemAudio = enabled;
			}, combination.systemAudio !== false);
			await selectSourceRoles(panel, combination.roles);
			const preview = panel.getByRole('button', { name: 'Preview sources', exact: true });
			await expect(preview).toBeEnabled();
			await preview.focus();
			await preview.press('Enter');
			await expectCapturePhase(panel, 'previewing');

			const state = await captureHarnessState(page);
			expect(state.requests.slice(requestOffset).map(({ kind }) => kind)).toEqual(combination.calls);
			requestOffset = state.requests.length;
			if (combination.calls.includes('display')) {
				const displayRequest = state.requests.findLast(({ kind }) => kind === 'display');
				expect(displayRequest.constraints).toMatchObject({ video: true, audio: true });
			}
			if (combination.calls.includes('user')) {
				const userRequest = state.requests.findLast(({ kind }) => kind === 'user');
				expect(Boolean(userRequest.constraints.video)).toBe(combination.roles.includes('camera'));
				expect(Boolean(userRequest.constraints.audio)).toBe(combination.roles.includes('microphone'));
			}
			const systemAudio = panel.locator('article').filter({ hasText: 'System or tab audio' });
			await expect(systemAudio).toHaveCount(combination.systemAudio ? 1 : 0);

			if (combination.roles.length === 2 && combination.roles.includes('camera')) {
				await assertAccessibleBasics(panel);
			}
			await panel.getByRole('button', { name: 'Release sources', exact: true }).press('Enter');
			await expectCapturePhase(panel, 'inactive');
			expectedStops += combination.tracks;
			await expect.poll(async () => (await captureHarnessState(page)).stopCalls).toBe(expectedStops);
		}

		const finalState = await captureHarnessState(page);
		expect(finalState.displayCalls).toBe(3);
		expect(finalState.userCalls).toBe(5);
		expect(finalState.stopCalls).toBe(finalState.createdTracks);
	});

	test('records, pauses, resumes, imports once, and reopens ordinary media', async ({ page }) => {
		test.setTimeout(120_000);
		await installCaptureHarness(page);
		let editor = await bootEditor(page, '/framescaper/en/');
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		let panel = await openRecordingSetup(page, editor);

		await selectSourceRoles(panel, ['microphone']);
		await panel.getByRole('button', { name: 'Preview sources', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'previewing');
		await panel.getByRole('combobox', { name: 'Countdown', exact: true }).selectOption('0');
		await expect(panel.getByRole('radio', { name: 'Project Bin and timeline', exact: true })).toBeChecked();
		await panel.getByRole('button', { name: 'Arm capture', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'armed');
		await expect(panel.getByRole('checkbox', { name: 'Microphone', exact: true })).toBeDisabled();
		await panel.getByRole('button', { name: 'Start capture', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'recording');
		await expect.poll(async () => (await captureHarnessState(page)).audioDataClosed).toBeGreaterThanOrEqual(3);

		await panel.getByRole('button', { name: 'Pause capture', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'paused');
		const pausedAt = (await captureHarnessState(page)).audioDataClosed;
		await panel.getByRole('button', { name: 'Resume capture', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'recording');
		await expect.poll(async () => (await captureHarnessState(page)).audioDataClosed).toBeGreaterThan(pausedAt + 2);

		await panel.getByRole('button', { name: 'Stop and import', exact: true }).press('Enter');
		await expect.poll(async () => (await captureHarnessState(page)).stopCalls).toBe(1);
		await expectCapturePhase(panel, 'inactive', 30_000);
		await expect(trackNameText(editor).filter({ hasText: /^Microphone$/u })).toHaveCount(1);
		await expect(projectBinCaptureCard(editor, 'Microphone Capture')).toBeVisible();
		const callsBeforeReopen = (await captureHarnessState(page)).requests.length;

		await page.goto(`/framescaper/en/?project=${encodeURIComponent(projectId)}`);
		editor = await waitForEditor(page);
		await expect(editor).toHaveAttribute('data-project-id', projectId);
		await expect(trackNameText(editor).filter({ hasText: /^Microphone$/u })).toHaveCount(1);
		await expect(projectBinCaptureCard(editor, 'Microphone Capture')).toBeVisible();
		expect((await captureHarnessState(page)).requests.length).toBe(0);
		expect(callsBeforeReopen).toBe(1);
	});

	test('releases display media on later permission denial and recovers a source-ended prefix after reload', async ({ page }) => {
		test.setTimeout(120_000);
		await installCaptureHarness(page);
		let editor = await bootEditor(page, '/framescaper/en/');
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		let panel = await openRecordingSetup(page, editor);

		await selectSourceRoles(panel, ['display', 'microphone']);
		await page.evaluate(() => { globalThis.__framescaperCaptureHarness.denyNextUser = true; });
		await panel.getByRole('button', { name: 'Preview sources', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'failed');
		await expect(panel.getByRole('status')).toContainText('Fixture user-media permission denied.');
		let state = await captureHarnessState(page);
		expect(state.requests.map(({ kind }) => kind)).toEqual(['display', 'user']);
		expect(state.stopCalls).toBe(2);
		await panel.getByRole('button', { name: 'Try again', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'inactive');

		await selectSourceRoles(panel, ['microphone']);
		await panel.getByRole('button', { name: 'Preview sources', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'previewing');
		await panel.getByRole('combobox', { name: 'Countdown', exact: true }).selectOption('0');
		await panel.getByRole('radio', { name: 'Project Bin', exact: true }).check();
		await panel.getByRole('button', { name: 'Arm capture', exact: true }).press('Enter');
		await panel.getByRole('button', { name: 'Start capture', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'recording');
		await expect.poll(async () => (await captureHarnessState(page)).audioDataClosed).toBeGreaterThanOrEqual(2);
		expect(await page.evaluate(() => globalThis.__framescaperCaptureHarness.endNewest('microphone'))).toBe(true);
		await expectCapturePhase(panel, 'recovery');
		await expect(panel.getByRole('status')).toContainText('A required capture source ended.');
		await expect.poll(async () => (await captureHarnessState(page)).stopCalls).toBe(3);

		await page.goto(`/framescaper/en/?project=${encodeURIComponent(projectId)}`);
		editor = await waitForEditor(page);
		panel = await openRecordingSetup(page, editor);
		await expectCapturePhase(panel, 'recovery');
		await expect(panel.getByRole('button', { name: 'Recover capture', exact: true })).toBeVisible();
		await expect(panel.getByRole('button', { name: 'Delete capture', exact: true })).toBeVisible();
		await panel.getByRole('button', { name: 'Import playable data as-is', exact: true }).press('Enter');
		await expectCapturePhase(panel, 'inactive', 30_000);
		await expect(projectBinCaptureCard(editor, 'Microphone Capture')).toBeVisible();
		state = await captureHarnessState(page);
		expect(state.requests).toEqual([]);
	});
});

async function openRecordingSetup(page, editor) {
	if (!await recordingSetupWorkspacePanel(editor).isVisible()) {
		const panels = await openNestedCommandMenu(page, editor, 'View', ['Panels']);
		const setup = getMenuItem(panels, 'Recording setup');
		await expect(setup).toBeEnabled();
		await setup.focus();
		await setup.press('Enter');
	}
	return waitForRecordingSetup(editor);
}

async function waitForRecordingSetup(editor) {
	const panel = recordingSetupWorkspacePanel(editor);
	await expect(panel).toBeVisible();
	const setup = panel.locator('[data-framescaper-recording-setup]');
	await expect(setup).toBeVisible();
	await expect(setup.getByRole('status')).not.toContainText('Checking capture support');
	return setup;
}

function recordingSetupWorkspacePanel(editor) {
	return editor.locator('[data-workspace-panel="recording-setup"]');
}

async function expectCapturePhase(panel, phase, timeout = 10_000) {
	await expect(panel).toHaveAttribute('data-capture-phase', phase, { timeout });
}

async function selectSourceRoles(panel, roles) {
	for (const [role, label] of Object.entries(SOURCE_LABELS)) {
		const checkbox = panel.getByRole('checkbox', { name: label, exact: true });
		if (roles.includes(role)) await checkbox.check();
		else await checkbox.uncheck();
	}
}

function projectBinCaptureCard(editor, name) {
	return editor.getByRole('listitem', { name: `Project bin: ${name}`, exact: true });
}

async function expectCaptureCalls(page, expected) {
	await expect.poll(async () => (
		(await captureHarnessState(page)).requests.map(({ kind }) => kind)
	)).toEqual(expected);
}

async function captureHarnessState(page) {
	return page.evaluate(() => {
		const harness = globalThis.__framescaperCaptureHarness;
		return {
			requests: structuredClone(harness.requests),
			displayCalls: harness.displayCalls,
			userCalls: harness.userCalls,
			createdTracks: harness.createdTracks,
			stopCalls: harness.stopCalls,
			audioDataClosed: harness.audioDataClosed,
			readerCancels: harness.readerCancels,
			readerReleases: harness.readerReleases,
		};
	});
}

async function installCaptureHarness(page) {
	await page.addInitScript(() => {
		const harness = {
			requests: [],
			displayCalls: 0,
			userCalls: 0,
			createdTracks: 0,
			stopCalls: 0,
			audioDataClosed: 0,
			readerCancels: 0,
			readerReleases: 0,
			includeSystemAudio: true,
			denyNextUser: false,
			denyNextDisplay: false,
			trackEntries: [],
			endNewest(role) {
				const entry = [...this.trackEntries].reverse().find((candidate) => (
					candidate.role === role && !candidate.stopped
				));
				if (!entry) return false;
				entry.track.dispatchEvent(new Event('ended'));
				return true;
			},
		};
		Object.defineProperty(globalThis, '__framescaperCaptureHarness', {
			configurable: true,
			value: harness,
		});

		function instrumentTrack(track, role, cleanup, settings, capabilities) {
			const nativeStop = track.stop.bind(track);
			const entry = { track, role, stopped: false };
			harness.trackEntries.push(entry);
			harness.createdTracks += 1;
			try {
				Object.defineProperty(track, 'label', { configurable: true, value: `Fixture ${role}` });
			} catch { /* Native labels may remain empty. */ }
			Object.defineProperty(track, 'getSettings', {
				configurable: true,
				value: () => ({ ...settings }),
			});
			Object.defineProperty(track, 'getCapabilities', {
				configurable: true,
				value: () => ({ ...capabilities }),
			});
			Object.defineProperty(track, 'stop', {
				configurable: true,
				value: () => {
					if (entry.stopped) return;
					entry.stopped = true;
					harness.stopCalls += 1;
					try { cleanup(); } finally { nativeStop(); }
				},
			});
			return track;
		}

		function videoTrack(role) {
			const canvas = document.createElement('canvas');
			canvas.width = 640;
			canvas.height = 360;
			const context = canvas.getContext('2d');
			context.fillStyle = role === 'camera' ? '#14532d' : '#1e3a8a';
			context.fillRect(0, 0, canvas.width, canvas.height);
			const stream = canvas.captureStream(30);
			const track = stream.getVideoTracks()[0];
			return instrumentTrack(track, role, () => undefined, {
				width: 640, height: 360, frameRate: 30,
			}, {
				width: { min: 320, max: 1920 },
				height: { min: 180, max: 1080 },
				frameRate: { min: 15, max: 60 },
			});
		}

		async function audioTrack(role) {
			const context = new AudioContext({ sampleRate: 48_000 });
			const oscillator = context.createOscillator();
			const gain = context.createGain();
			const destination = context.createMediaStreamDestination();
			oscillator.frequency.value = role === 'microphone' ? 440 : 220;
			gain.gain.value = 0.05;
			oscillator.connect(gain).connect(destination);
			oscillator.start();
			await context.resume();
			const track = destination.stream.getAudioTracks()[0];
			return instrumentTrack(track, role, () => {
				try { oscillator.stop(); } catch { /* Already stopped. */ }
				oscillator.disconnect();
				gain.disconnect();
				void context.close();
			}, {
				sampleRate: 48_000, channelCount: 2,
			}, {
				sampleRate: { min: 44_100, max: 96_000 },
				channelCount: { min: 1, max: 2 },
			});
		}

		async function sourceStream({ camera = false, microphone = false, display = false, systemAudio = false }) {
			const tracks = [];
			if (camera) tracks.push(videoTrack('camera'));
			if (microphone) tracks.push(await audioTrack('microphone'));
			if (display) tracks.push(videoTrack('display'));
			if (systemAudio) tracks.push(await audioTrack('system-audio'));
			return new MediaStream(tracks);
		}

		const mediaDevices = {
			async getDisplayMedia(constraints) {
				harness.displayCalls += 1;
				harness.requests.push({ kind: 'display', constraints: structuredClone(constraints) });
				if (harness.denyNextDisplay) {
					harness.denyNextDisplay = false;
					throw new DOMException('Fixture display permission denied.', 'NotAllowedError');
				}
				return sourceStream({ display: true, systemAudio: harness.includeSystemAudio });
			},
			async getUserMedia(constraints) {
				harness.userCalls += 1;
				harness.requests.push({ kind: 'user', constraints: structuredClone(constraints) });
				if (harness.denyNextUser) {
					harness.denyNextUser = false;
					throw new DOMException('Fixture user-media permission denied.', 'NotAllowedError');
				}
				return sourceStream({ camera: Boolean(constraints.video), microphone: Boolean(constraints.audio) });
			},
			async enumerateDevices() {
				return [
					{ deviceId: 'fixture-camera', kind: 'videoinput', label: 'Fixture camera' },
					{ deviceId: 'fixture-microphone', kind: 'audioinput', label: 'Fixture microphone' },
				];
			},
		};
		Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });

		class FixtureMediaRecorder {
			static isTypeSupported(mimeType) { return /^video\/webm/u.test(mimeType); }
			constructor(_stream, options = {}) {
				this.mimeType = options.mimeType || 'video/webm';
				this.state = 'inactive';
				this.ondataavailable = null;
				this.onerror = null;
				this.onstop = null;
			}
			start() { this.state = 'recording'; }
			pause() { if (this.state === 'recording') this.state = 'paused'; }
			resume() { if (this.state === 'paused') this.state = 'recording'; }
			requestData() {}
			stop() {
				if (this.state === 'inactive') return;
				this.state = 'inactive';
				queueMicrotask(() => this.onstop?.());
			}
		}
		Object.defineProperty(globalThis, 'MediaRecorder', {
			configurable: true,
			writable: true,
			value: FixtureMediaRecorder,
		});

		class FixtureMediaStreamTrackProcessor {
			constructor({ track }) {
				const settings = track.getSettings();
				const sampleRate = settings.sampleRate || 48_000;
				const channelCount = settings.channelCount || 2;
				let canceled = false;
				let frameStart = 0;
				let pending = null;
				this.readable = {
					getReader: () => ({
						read: () => {
							if (canceled) return Promise.resolve({ done: true });
							return new Promise((resolve) => {
								const finish = () => {
									pending = null;
									if (canceled) {
										resolve({ done: true });
										return;
									}
									const start = frameStart;
									const frames = 512;
									frameStart += frames;
									resolve({
										done: false,
										value: {
											numberOfFrames: frames,
											numberOfChannels: channelCount,
											sampleRate,
											copyTo(destination, options) {
												for (let index = 0; index < destination.length; index += 1) {
													destination[index] = Math.sin(
														2 * Math.PI * 440 * (start + (options.frameOffset || 0) + index) / sampleRate,
													) * 0.05;
												}
											},
											close() { harness.audioDataClosed += 1; },
										},
									});
								};
								const timer = setTimeout(finish, 8);
								pending = () => {
									clearTimeout(timer);
									finish();
								};
							});
						},
						cancel: () => {
							if (canceled) return Promise.resolve();
							canceled = true;
							harness.readerCancels += 1;
							pending?.();
							return Promise.resolve();
						},
						releaseLock: () => { harness.readerReleases += 1; },
					}),
				};
			}
		}
		Object.defineProperty(globalThis, 'MediaStreamTrackProcessor', {
			configurable: true,
			writable: true,
			value: FixtureMediaStreamTrackProcessor,
		});
	});
}
