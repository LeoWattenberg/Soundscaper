import {
	expect,
	monoTone,
	test,
	toneA,
	toneB,
} from './audio-editor-test-fixtures.js';
import {
	addRackEffect,
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
	chooseNestedCommandAction,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
	stubDisplayCapture,
	waitForEditor,
} from './audio-editor-test-helpers.js';

test.describe('audio editor React/design-system workflows', () => {
	registerAudioEditorHooks();

	test('opens Audacity microphone and speaker flyouts', async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(navigator, 'mediaDevices', {
				configurable: true,
				value: {
					async getUserMedia() {
						const context = new AudioContext({ sampleRate: 48_000 });
						const oscillator = context.createOscillator();
						const gain = context.createGain();
						const destination = context.createMediaStreamDestination();
						oscillator.frequency.value = 440;
						gain.gain.value = 0.2;
						oscillator.connect(gain).connect(destination);
						oscillator.start();
						await context.resume();
						return destination.stream;
					},
				},
			});
		});
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		await editor.locator('[data-action-bar]').getByRole('button', { name: 'Audio setup', exact: true }).click();
		const audioDevicesFlyout = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
		const allowMicrophone = audioDevicesFlyout.getByRole('button', { name: 'Enable microphones', exact: true });
		await expect(allowMicrophone).toBeVisible();
		await allowMicrophone.click();
		await expect(allowMicrophone).toHaveCount(0);
		await page.keyboard.press('Escape');

		const recordLevel = editor.getByRole('button', { name: 'Record level', exact: true });
		await expect(recordLevel.locator('.musescore-icon')).toHaveText('\uF41B');
		await recordLevel.click();

		const microphoneFlyout = editor.getByRole('dialog', { name: 'Record level', exact: true });
		let sideRecordingMeter = editor.locator('[data-side-recording-meter]');
		await expect(microphoneFlyout).toBeVisible();
		await expect(microphoneFlyout.getByText('Microphone level', { exact: true })).toBeVisible();
		await expect(sideRecordingMeter.getByRole('meter', { name: 'Input level', exact: true })).toBeVisible();
		await expect(microphoneFlyout.getByRole('radio', { name: 'Side bar (vertical)', exact: true })).toBeChecked();
		await expect(microphoneFlyout.getByRole('radio', { name: 'Gradient', exact: true })).toBeVisible();
		await expect(microphoneFlyout.getByRole('combobox', { name: 'dB range', exact: true })).toBeVisible();
		const recordGain = sideRecordingMeter.getByRole('slider', { name: 'Record level', exact: true });
		await recordGain.fill('-6');
		await expect(recordGain).toHaveValue('-6');
		const micMetering = microphoneFlyout.getByRole('checkbox', { name: 'Show mic metering when not recording', exact: true });
		await expect(micMetering).toHaveAttribute('aria-checked', 'false');
		await micMetering.click();
		await expect(micMetering).toHaveAttribute('aria-checked', 'true');
		await expect.poll(async () => Number(await sideRecordingMeter
			.getByRole('meter', { name: 'Input level', exact: true })
			.getAttribute('aria-valuenow'))).toBeGreaterThan(-60);
		await expect(sideRecordingMeter).toBeVisible();
		await page.evaluate(() => {
			globalThis.__idleWaveformDraws = 0;
			const prototype = CanvasRenderingContext2D.prototype;
			const clearRect = prototype.clearRect;
			prototype.clearRect = function countIdleWaveformDraws(...args) {
				if (this.canvas?.matches('canvas.clip-body__waveform')) globalThis.__idleWaveformDraws += 1;
				return clearRect.apply(this, args);
			};
		});
		await page.waitForTimeout(150);
		await page.evaluate(() => { globalThis.__idleWaveformDraws = 0; });
		await page.waitForTimeout(350);
		expect(await page.evaluate(() => globalThis.__idleWaveformDraws)).toBe(0);
		await micMetering.click();
		await expect(micMetering).toHaveAttribute('aria-checked', 'false');
		await expect(sideRecordingMeter.getByRole('meter', { name: 'Input level', exact: true })).toHaveAttribute('aria-valuenow', '-60');
		await expect(editor.locator('[data-idle-input-meter]')).toHaveCount(0);
		await microphoneFlyout.getByRole('radio', { name: 'Top bar (horizontal)', exact: true }).click();
		await expect(microphoneFlyout.locator('[data-input-meter]')).toHaveCount(0);
		const topRecordingMeter = editor.locator('[data-meter-kind="recording"][data-meter-position="top"]:not([data-input-meter])');
		await expect(topRecordingMeter).toBeVisible();
		await expect(topRecordingMeter).toHaveAttribute('data-meter-orientation', 'horizontal');
		const topRecordingSlider = topRecordingMeter.getByRole('slider', { name: 'Record level', exact: true });
		await expect(topRecordingSlider).toBeVisible();
		const topSliderBox = await topRecordingSlider.boundingBox();
		const topChannelsBox = await topRecordingMeter.locator('.kw-audio-editor__playback-meter-channels').boundingBox();
		expect(Math.abs((topSliderBox.y + topSliderBox.height / 2) - (topChannelsBox.y + topChannelsBox.height / 2))).toBeLessThanOrEqual(1);
		expect(topSliderBox.height).toBeGreaterThanOrEqual(topChannelsBox.height - 1);
		await editor.getByRole('button', { name: 'Record level', exact: true }).click();
		await microphoneFlyout.getByRole('radio', { name: 'Side bar (vertical)', exact: true }).click();
		sideRecordingMeter = editor.locator('[data-side-recording-meter]');
		await expect(sideRecordingMeter).toBeVisible();
		await expect(sideRecordingMeter.locator('[data-meter-kind="recording"]')).toHaveAttribute('data-meter-orientation', 'vertical');
		const sideRecordingSlider = sideRecordingMeter.getByRole('slider', { name: 'Record level', exact: true });
		await expect(sideRecordingSlider).toBeVisible();
		const sideSliderBox = await sideRecordingSlider.boundingBox();
		const sideChannelsBox = await sideRecordingMeter.locator('.kw-audio-editor__playback-meter-channels').boundingBox();
		expect(Math.abs((sideSliderBox.x + sideSliderBox.width / 2) - (sideChannelsBox.x + sideChannelsBox.width / 2))).toBeLessThanOrEqual(1);
		expect(sideSliderBox.width).toBeGreaterThanOrEqual(sideChannelsBox.width - 1);
		await sideRecordingMeter.getByRole('button', { name: 'Record level', exact: true }).click();
		let sideRecordingFlyout = editor.getByRole('dialog', { name: 'Record level', exact: true });
		await sideRecordingFlyout.getByRole('radio', { name: 'EBU R 128', exact: true }).click();
		const sideInputEbuMeter = sideRecordingMeter.locator('[data-audio-meter]');
		await expect(sideInputEbuMeter).toHaveAttribute('data-meter-type', 'ebu-r128');
		await expect(sideInputEbuMeter).toHaveAttribute('data-ebu-scale', 'plus9');
		await expect(sideInputEbuMeter).toHaveAttribute('data-ebu-unit', 'absolute');
		await expect(sideInputEbuMeter.getByRole('meter', { name: 'Input level', exact: true })).toHaveAttribute('aria-valuemin', '-41');
		await expect(sideInputEbuMeter.getByRole('meter', { name: 'Input level', exact: true })).toHaveAttribute('aria-valuetext', '— LUFS');
		await expect(sideRecordingFlyout.getByRole('radio', { name: 'Gradient', exact: true })).toHaveCount(0);
		await expect(sideRecordingFlyout.getByRole('combobox', { name: 'dB range', exact: true })).toHaveCount(0);
		await sideRecordingFlyout.getByRole('radio', { name: 'EBU +18', exact: true }).click();
		await sideRecordingFlyout.getByRole('radio', { name: 'Relative (LU)', exact: true }).click();
		await sideRecordingFlyout.getByRole('radio', { name: 'Short-term (S)', exact: true }).click();
		await expect(sideInputEbuMeter).toHaveAttribute('data-ebu-scale', 'plus18');
		await expect(sideInputEbuMeter).toHaveAttribute('data-ebu-unit', 'relative');
		await expect(sideInputEbuMeter).toHaveAttribute('data-ebu-live-value', 'short-term');
		await expect(sideInputEbuMeter.getByRole('meter', { name: 'Input level', exact: true })).toHaveAttribute('aria-valuemin', '-36');
		await expect(sideRecordingFlyout.getByRole('button', { name: 'Reset measurement', exact: true })).toHaveCount(0);
		await page.keyboard.press('Escape');

		let playbackSettings = editor.getByRole('button', { name: 'Playback meter settings', exact: true });
		await expect(playbackSettings.locator('.musescore-icon')).toHaveText('\uEF4E');
		await playbackSettings.click();
		let speakerFlyout = editor.getByRole('dialog', { name: 'Playback meter settings', exact: true });
		await expect(speakerFlyout).toBeVisible();
		await expect(speakerFlyout.getByRole('checkbox')).toHaveCount(0);
		await expect(speakerFlyout.getByRole('radio', { name: 'Side bar (vertical)', exact: true })).toBeChecked();
		await page.keyboard.press('Escape');
		const sideMeter = editor.locator('[data-side-playback-meter]');
		await expect(sideMeter).toBeVisible();
		await expect(sideMeter.locator('[data-playback-meter]')).toHaveAttribute('data-meter-orientation', 'vertical');
		const playbackVolume = sideMeter.getByRole('slider', { name: 'Playback volume', exact: true });
		await expect(playbackVolume).toHaveAttribute('aria-orientation', 'vertical');
		await expect(playbackVolume).toHaveAttribute('aria-valuetext', '0 dB');
		await playbackVolume.fill('0.5');
		await expect(playbackVolume).toHaveAttribute('aria-valuetext', '−30 dB');
		await playbackVolume.fill('1');
		await expect(playbackVolume).toHaveAttribute('aria-valuetext', '0 dB');
		const sideMeterBox = await sideMeter.locator('[data-playback-meter]').boundingBox();
		expect(sideMeterBox.height).toBeGreaterThan(sideMeterBox.width);

		playbackSettings = sideMeter.getByRole('button', { name: 'Playback meter settings', exact: true });
		await playbackSettings.click();
		speakerFlyout = editor.getByRole('dialog', { name: 'Playback meter settings', exact: true });
		await expect(speakerFlyout.getByRole('radio', { name: 'Side bar (vertical)', exact: true })).toBeChecked();
		await speakerFlyout.getByRole('radio', { name: 'Gradient', exact: true }).click();
		const playbackMeter = sideMeter.locator('[data-playback-meter]');
		await expect(playbackMeter).toHaveAttribute('data-meter-style', 'gradient');
		const gradientPeak = playbackMeter.locator('.kw-audio-editor__playback-meter-peak').first();
		await expect(gradientPeak).toHaveCSS('background-image', /linear-gradient/);
		await expect(gradientPeak).not.toHaveCSS('clip-path', 'none');
		await speakerFlyout.getByRole('radio', { name: 'RMS', exact: true }).click();
		await expect(playbackMeter.locator('.kw-audio-editor__playback-meter-rms')).toHaveCount(2);
		await speakerFlyout.getByRole('radio', { name: 'Linear (dB)', exact: true }).click();
		const range = speakerFlyout.getByRole('combobox', { name: 'dB range', exact: true });
		await range.selectOption('120');
		await expect(playbackMeter).toHaveAttribute('data-meter-db-range', '120');
		await expect(playbackMeter.locator('.kw-audio-editor__playback-meter-ruler')).toContainText('120');
		await speakerFlyout.getByRole('radio', { name: 'Linear (amp)', exact: true }).click();
		await expect(range).toBeDisabled();
		await expect(playbackMeter.locator('.kw-audio-editor__playback-meter-ruler')).toContainText('0.40');
		await speakerFlyout.getByRole('radio', { name: 'EBU R 128', exact: true }).click();
		await expect(playbackMeter).toHaveAttribute('data-meter-type', 'ebu-r128');
		await expect(playbackMeter).toHaveAttribute('data-ebu-scale', 'plus9');
		await expect(playbackMeter).toHaveAttribute('data-ebu-unit', 'absolute');
		await expect(playbackMeter.locator('[data-ebu-target]')).toContainText('23');
		await expect(speakerFlyout.getByRole('radio', { name: 'Gradient', exact: true })).toHaveCount(0);
		await expect(speakerFlyout.getByRole('combobox', { name: 'dB range', exact: true })).toHaveCount(0);
		await expect(speakerFlyout.getByText('Loudness range (LRA)', { exact: true })).toHaveCount(0);
		await speakerFlyout.getByRole('radio', { name: 'EBU +18', exact: true }).click();
		await speakerFlyout.getByRole('radio', { name: 'Relative (LU)', exact: true }).click();
		await speakerFlyout.getByRole('radio', { name: 'Short-term (S)', exact: true }).click();
		await expect(playbackMeter).toHaveAttribute('data-ebu-scale', 'plus18');
		await expect(playbackMeter).toHaveAttribute('data-ebu-unit', 'relative');
		await expect(playbackMeter).toHaveAttribute('data-ebu-live-value', 'short-term');
		await expect(playbackMeter.getByRole('meter')).toHaveAttribute('aria-valuemin', '-36');
		await expect(playbackMeter.getByRole('meter')).toHaveAttribute('aria-valuemax', '18');
		await expect(playbackMeter.locator('[data-ebu-target]')).toHaveText('0');
		await expect(speakerFlyout.getByRole('button', { name: 'Reset measurement', exact: true })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await chooseCommandAction(page, editor, 'Analyze', 'EBU R 128');
		const ebuPanel = editor.locator('[data-workspace-panel="ebu-r128"]');
		await expect(ebuPanel.getByText('Loudness range (LRA)', { exact: true })).toBeVisible();
		await ebuPanel.getByRole('button', { name: 'Reset measurement', exact: true }).focus();
		await page.keyboard.press('Enter');

		await page.reload();
		const reloaded = await waitForEditor(page);
		const reloadedPlayback = reloaded.locator('[data-side-playback-meter] [data-playback-meter]');
		await expect(reloadedPlayback).toHaveAttribute('data-meter-type', 'ebu-r128');
		await expect(reloadedPlayback).toHaveAttribute('data-ebu-scale', 'plus18');
		await expect(reloadedPlayback).toHaveAttribute('data-ebu-unit', 'relative');
		await expect(reloadedPlayback).toHaveAttribute('data-ebu-live-value', 'short-term');
		const reloadedInput = reloaded.locator('[data-side-recording-meter] [data-audio-meter]');
		await expect(reloadedInput).toHaveAttribute('data-meter-type', 'ebu-r128');
		await expect(reloadedInput).toHaveAttribute('data-ebu-scale', 'plus18');
	});

	test('migrates legacy meter settings while preserving conventional meter choices', async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('soundscaper-playback-meter-settings-v1', JSON.stringify({
				position: 'side',
				style: 'gradient',
				type: 'db-linear',
				dbRange: 96,
			}));
			localStorage.setItem('soundscaper-recording-meter-settings-v1', JSON.stringify({
				position: 'top',
				style: 'rms',
				type: 'db-log',
				dbRange: 72,
			}));
		});
		const editor = await bootEditor(page, '/embed/en/');
		const playback = editor.locator('[data-side-playback-meter] [data-playback-meter]');
		await expect(playback).toHaveAttribute('data-meter-type', 'db-linear');
		await expect(playback).toHaveAttribute('data-meter-style', 'gradient');
		await expect(playback).toHaveAttribute('data-meter-db-range', '96');
		const recording = editor.locator('[data-meter-kind="recording"][data-meter-position="top"]');
		await expect(recording).toHaveAttribute('data-meter-type', 'db-log');
		await expect(recording).toHaveAttribute('data-meter-style', 'rms');
		await expect(recording).toHaveAttribute('data-meter-db-range', '72');
		await expect.poll(() => page.evaluate(() => (
			JSON.parse(localStorage.getItem('soundscaper-playback-meter-settings-v2'))
		))).toMatchObject({
			position: 'side',
			style: 'gradient',
			type: 'db-linear',
			dbRange: 96,
			ebuScale: 'plus9',
			ebuUnit: 'absolute',
			ebuLiveValue: 'momentary',
		});
	});

	test('selects and restores custom microphone and speaker devices', async ({ page }) => {
		await page.addInitScript(() => {
			const events = new EventTarget();
			const createTrack = (kind) => {
				const target = new EventTarget();
				let readyState = 'live';
				Object.defineProperties(target, {
					kind: { value: kind },
					readyState: { get: () => readyState },
					getSettings: { value: () => kind === 'audio' ? { channelCount: 2 } : {} },
					stop: { value: () => {
						if (readyState === 'ended') return;
						readyState = 'ended';
						target.dispatchEvent(new Event('ended'));
					} },
				});
				return target;
			};
			let devices = [
				{ kind: 'audioinput', deviceId: 'default', groupId: 'built-in', label: 'System microphone' },
				{ kind: 'audioinput', deviceId: 'usb-mic', groupId: 'usb', label: 'USB microphone' },
				{ kind: 'audiooutput', deviceId: 'default', groupId: 'built-in', label: 'System speakers' },
				{ kind: 'audiooutput', deviceId: 'usb-speakers', groupId: 'usb', label: 'USB speakers' },
			];
			window.__audioSinkIds = [];
			window.__displayCaptureRequests = 0;
			window.__captureTracks = [];
			window.__setAudioDevices = (nextDevices) => {
				devices = nextDevices;
				events.dispatchEvent(new Event('devicechange'));
			};
			Object.defineProperty(AudioContext.prototype, 'setSinkId', {
				configurable: true,
				async value(deviceId) {
					window.__audioSinkIds.push(deviceId);
				},
			});
			Object.defineProperty(navigator, 'mediaDevices', {
				configurable: true,
				value: {
					enumerateDevices: async () => devices,
					getUserMedia: async () => {
						const audioTrack = createTrack('audio');
						window.__captureTracks.push(audioTrack);
						return {
							getAudioTracks: () => [audioTrack],
							getVideoTracks: () => [],
							getTracks: () => [audioTrack],
						};
					},
					getDisplayMedia: async () => {
						window.__displayCaptureRequests += 1;
						const audioTrack = createTrack('audio');
						const videoTrack = createTrack('video');
						window.__captureTracks.push(audioTrack, videoTrack);
						return {
							getAudioTracks: () => [audioTrack],
							getVideoTracks: () => [videoTrack],
							getTracks: () => [audioTrack, videoTrack],
						};
					},
					addEventListener: events.addEventListener.bind(events),
					removeEventListener: events.removeEventListener.bind(events),
				},
			});
		});
		const editor = await bootEditor(page, '/embed/en/');
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		const audioDevicesButton = editor.locator('[data-action-bar]').getByRole('button', { name: 'Audio setup', exact: true });
		await expect(audioDevicesButton).toBeVisible();
		await expect(editor.locator('[data-editor-tool-toolbar]').getByRole('button', { name: 'Audio setup', exact: true })).toHaveCount(0);
		await audioDevicesButton.click();
		const flyout = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
		await expect(flyout).toBeVisible();
		const actionBarZ = Number(await editor.locator('[data-action-bar]').evaluate((element) => getComputedStyle(element).zIndex));
		const toolbarsZ = Number(await editor.locator('[data-toolbar-dock="top"]').evaluate((element) => getComputedStyle(element).zIndex));
		expect(actionBarZ).toBeGreaterThan(toolbarsZ);

		const microphone = flyout.getByRole('combobox', { name: 'Microphone', exact: true });
		const recordingChannels = flyout.getByRole('radiogroup', { name: 'Recording channels', exact: true });
		const speakers = flyout.getByRole('combobox', { name: 'Speakers', exact: true });
		await expect(microphone).toContainText('USB microphone');
		await expect(speakers).toContainText('USB speakers');
		await microphone.selectOption('usb-mic');
		await recordingChannels.getByRole('radio', { name: 'Stereo', exact: true }).check();
		await speakers.selectOption('usb-speakers');
		await expect(microphone).toHaveValue('usb-mic');
		await expect(recordingChannels.getByRole('radio', { name: 'Stereo', exact: true })).toBeChecked();
		await expect(speakers).toHaveValue('usb-speakers');

		await microphone.selectOption('display');
		await flyout.getByRole('button', { name: 'Choose display source', exact: true }).click();
		const changeDisplaySource = flyout.getByRole('button', { name: 'Choose a different display source', exact: true });
		await expect(changeDisplaySource).toBeVisible();
		await changeDisplaySource.click();
		await expect.poll(() => page.evaluate(() => window.__displayCaptureRequests)).toBe(2);
		await expect.poll(() => page.evaluate(() => (
			window.__captureTracks.filter((track) => track.readyState === 'live').length
		))).toBe(3);

		await page.evaluate(() => window.__setAudioDevices([
			{ kind: 'audioinput', deviceId: 'default', groupId: 'built-in', label: 'System microphone' },
			{ kind: 'audioinput', deviceId: 'usb-mic', groupId: 'usb', label: 'USB microphone' },
			{ kind: 'audiooutput', deviceId: 'default', groupId: 'built-in', label: 'System speakers' },
		]));
		await expect(flyout.getByText('The preferred output is unavailable. Using the system default.')).toBeVisible();
		await expect(speakers).toHaveValue('usb-speakers');
		await expect.poll(() => page.evaluate(() => window.__audioSinkIds.at(-1))).toBe('');

		await page.evaluate(() => window.__setAudioDevices([
			{ kind: 'audioinput', deviceId: 'default', groupId: 'built-in', label: 'System microphone' },
			{ kind: 'audioinput', deviceId: 'usb-mic', groupId: 'usb', label: 'USB microphone' },
			{ kind: 'audiooutput', deviceId: 'default', groupId: 'built-in', label: 'System speakers' },
			{ kind: 'audiooutput', deviceId: 'usb-speakers', groupId: 'usb', label: 'USB speakers' },
		]));
		await expect.poll(() => page.evaluate(() => window.__audioSinkIds.at(-1))).toBe('usb-speakers');
	});

	test('exposes play at speed and persists its pitch behavior preference', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const playOptions = editor.getByRole('button', { name: 'Play options', exact: true });
		await importFiles(editor, [monoTone]);

		// At the neutral rate the single play control is ordinary playback.
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();

		await playOptions.click();
		const control = editor.locator('[data-play-at-speed]');
		await expect(control).toBeVisible();
		const speed = control.getByRole('slider', { name: 'Playback speed', exact: true });
		await speed.fill('1.5');
		await expect(control.locator('output')).toHaveText('1.5×');
		await page.keyboard.press('Escape');

		// Moving the slider off the neutral rate retunes that same control.
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toHaveCount(0);
		await editor.getByRole('button', { name: 'Play at speed', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause play at speed', exact: true })).toBeVisible();
		await editor.getByRole('button', { name: 'Pause play at speed', exact: true }).click();

		await playOptions.click();
		await control.getByRole('menuitem', { name: 'Preserve pitch', exact: true }).click();
		await page.keyboard.press('Escape');

		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Playback\/Recording$/ }).click();
		const mode = preferences.getByRole('group', { name: 'Play-at-speed pitch behavior', exact: true });
		// The transport toggle and the preferences dropdown are the same setting.
		await expect(mode.getByRole('button')).toContainText('Preserve pitch with StaffPad');
		await chooseDropdown(page, mode, 'Change speed and pitch');
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();

		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const reopened = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await reopened.getByRole('tab', { name: /Playback\/Recording$/ }).click();
		await expect(reopened.getByRole('group', { name: 'Play-at-speed pitch behavior', exact: true }).getByRole('button')).toContainText('Change speed and pitch');
	});

	test('reaches the same audio devices from Preferences as from the transport', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Audio settings$/u }).click();
		const devices = preferences.locator('[data-audio-devices-flyout]');
		await expect(devices.getByLabel('Microphone', { exact: true })).toBeVisible();
		await expect(devices.getByLabel('Speakers', { exact: true })).toBeVisible();
		await expect(devices.getByRole('radiogroup', { name: 'Recording channels', exact: true })).toBeVisible();
		// The preferences panel draws the heading, so the flyout's own is absent.
		await expect(devices.getByText('Audio setup', { exact: true })).toHaveCount(0);
	});

	test('mixes tracks through group and send buses with Audacity channel strips', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		const mixer = editor.locator('[data-mixer-panel]');
		await expect(mixer).toBeVisible();
		await expect(mixer.locator('.mixer-panel')).toBeVisible();
		await expect(mixer.locator('.mixer-channel')).toHaveCount(2);

		await mixer.getByRole('button', { name: 'Add group bus', exact: true }).click();
		await mixer.getByRole('button', { name: 'Add send bus', exact: true }).click();
		const outputRows = editor.locator('[data-output-track-row]');
		await expect(outputRows).toHaveCount(2);
		expect(await outputRows.evaluateAll((rows) => rows.map((row) => row.dataset.outputScope))).toEqual(['group', 'send']);
		await expect(editor.locator('[data-track-row]')).toHaveCount(1);
		await expect(mixer.locator('[data-mixer-bus]')).toHaveCount(0);
		await expect(mixer.locator('.kw-audio-editor__mixer-channel--group')).toHaveCount(1);
		await expect(mixer.locator('.kw-audio-editor__mixer-channel--send')).toHaveCount(1);
		await expect(mixer.locator('.mixer-panel__row-label').filter({ hasText: 'Sends' })).toHaveCount(1);

		const output = mixer.getByRole('combobox', { name: 'Output: Track 1', exact: true });
		await output.selectOption({ label: 'Group bus 1' });
		await expect(output).toHaveValue(/group-bus/);
		const sendLevel = mixer.getByRole('slider', { name: 'Send level: Track 1 → Send bus 1', exact: true });
		// One arrow press moves one step: the knob owns arrow keys, the panel owns
		// Home and End, and neither may double up on the other's key.
		await sendLevel.press('ArrowUp');
		await expect(sendLevel).toHaveAttribute('aria-valuenow', '-59');
		await sendLevel.press('ArrowDown');
		await expect(sendLevel).toHaveAttribute('aria-valuenow', '-60');
		await sendLevel.press('End');
		await expect(sendLevel).toHaveAttribute('aria-valuenow', '12');
		await sendLevel.press('Home');
		await expect(sendLevel).toHaveAttribute('aria-valuenow', '-60');
		await sendLevel.press('ArrowUp');
		await expect(sendLevel).toHaveAttribute('aria-valuenow', '-59');
		const sendTarget = mixer.getByRole('combobox', { name: 'Sends: Track 1', exact: true });
		await expect(sendTarget).toHaveText('Send bus 1');

		await mixer.locator('.kw-audio-editor__mixer-channel--send .mixer-effect--empty .mixer-effect__dropdown').first().click();
		const effectsPanel = page.locator('.audio-editor-effects-overlay');
		await addRackEffect(page, effectsPanel, 'track', 'Reverb');
		await expect(mixer.locator('.kw-audio-editor__mixer-channel--send .mixer-effect--enabled')).toContainText('Reverb');
		expect(errors).toEqual([]);
	});

	test('keeps pinned recording routes synchronized between track and mixer selectors', async ({ page }) => {
		const errors = collectClientErrors(page);
		await stubDisplayCapture(page);
		let editor = await bootEditor(page, '/embed/en/');

		await expect(editor.locator('[data-recording-input-selectors]')).toHaveCount(0);
		await chooseCommandAction(page, editor, 'View', 'Enable multi-track recording');

		const trackSelectors = editor.locator('.kw-recording-input-selectors--track').first();
		const trackSource = trackSelectors.getByRole('combobox', { name: 'Recording source: Track 1', exact: true });
		const trackChannel = trackSelectors.getByRole('combobox', { name: 'Channel: Track 1', exact: true });
		await expect(trackSource).toBeVisible();
		await expect(trackSource).toHaveValue('device:default');
		await expect(trackChannel).toHaveValue('0');

		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		let mixer = editor.locator('[data-mixer-panel]');
		const mixerSelectors = mixer.locator('.kw-recording-input-selectors--mixer').first();
		const mixerSource = mixerSelectors.getByRole('combobox', { name: 'Recording source: Track 1', exact: true });
		const mixerChannel = mixerSelectors.getByRole('combobox', { name: 'Channel: Track 1', exact: true });
		await expect(mixerSource).toHaveValue('device:default');

		// The selectors are native comboboxes, so the complete routing workflow is
		// available from a keyboard without opening a custom pointer-only surface.
		await trackSource.focus();
		await expect(trackSource).toBeFocused();
		await trackSource.press('ArrowDown');
		await trackSource.press('Enter');
		await expect(trackSource).toHaveValue('display');
		await expect(mixerSource).toHaveValue('display');
		await expect(trackChannel).toHaveValue('0');
		await expect(mixerChannel).toHaveValue('0');
		await expect.poll(() => page.evaluate(() => globalThis.__soundscaperDisplayCaptureRequests)).toBe(1);

		const releaseInputs = editor.getByRole('button', { name: 'Audio setup', exact: true });
		await releaseInputs.click();
		const audioSetup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
		const releaseInputButton = audioSetup.getByRole('button', { name: 'Disable microphones', exact: true });
		await expect(releaseInputButton).toBeVisible();
		await expect(trackSelectors).toHaveAttribute('data-recording-input-health', 'open');
		await releaseInputButton.click();
		await expect(releaseInputButton).toHaveCount(0);
		await expect(trackSelectors).toHaveAttribute('data-recording-input-health', 'unavailable');

		await page.reload();
		editor = await waitForEditor(page);
		await expect(editor.locator('[data-recording-input-selectors]')).toHaveCount(0);
		await chooseCommandAction(page, editor, 'View', 'Enable multi-track recording');
		await expect(editor.locator('.kw-recording-input-selectors--track').first()
			.getByRole('combobox', { name: 'Recording source: Track 1', exact: true })).toHaveValue('display');

		mixer = editor.locator('[data-mixer-panel]');
		if (!await mixer.isVisible()) await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		await expect(mixer.locator('.kw-recording-input-selectors--mixer').first()
			.getByRole('combobox', { name: 'Recording source: Track 1', exact: true })).toHaveValue('display');
		await expect(mixer.getByRole('button', { name: 'Disable microphones', exact: true })).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('uses a full-height sidebar behind track controls', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const sidebar = editor.locator('.audio-editor-track-list');
		await expect(sidebar).toBeVisible();
		const dimensions = await sidebar.evaluate((element) => {
			const backing = getComputedStyle(element, '::before');
			return {
				backingHeight: Number.parseFloat(backing.height),
				listHeight: element.getBoundingClientRect().height,
				backingWidth: Number.parseFloat(backing.width),
				panelWidth: element.querySelector('[data-track-header]')?.getBoundingClientRect().width || 0,
			};
		});
		expect(dimensions.backingHeight).toBeCloseTo(dimensions.listHeight, 0);
		expect(dimensions.backingWidth).toBeCloseTo(dimensions.panelWidth, 0);
	});
});
