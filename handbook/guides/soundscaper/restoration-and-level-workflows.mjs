/* SPDX-License-Identifier: AGPL-3.0-only */

import { effect, importAudio, menu, nyquist, open, play, selectRange, trackMenu } from '../steps.mjs';
import { spectralRange } from '../spectral-steps.mjs';

const selectAll = () => menu(['Select', 'Select all']);

export const CLEAN_UP_WORKFLOW_GUIDES = Object.freeze([
	{
		id: 'remove-a-narrow-frequency-band',
		title: 'Remove a narrow frequency band',
		description: 'Erase a short tonal sound from one part of a recording with spectral selection.',
		audacity: 'Effect → Spectral Tools → Delete selection (Audacity 4)',
		intro: 'A steady whistle or electronic tone can sit in a small frequency band for only part of a recording. Spectral Delete removes that band inside a time selection while leaving the surrounding frequencies in place.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording containing a brief tonal sound' }),
			trackMenu(['Track visualization', 'Spectrogram'], { fixture: 'music-loop', which: 'the track you want to inspect' }),
			selectRange(0.25, 0.75, { where: 'the time span where the tone is audible' }),
			spectralRange({ minimum: 200, maximum: 320, operation: 'delete' }, { why: 'This removes the loop’s 261.6 Hz tone only during the chosen time span.' }),
			play({ see: 'The tonal sound is reduced in that passage while the rest of the recording remains.' }),
		],
		tips: [
			'Use the spectrogram to locate the tone, then narrow the time and frequency bounds around it before deleting.',
			'Spectral Delete affects the selected time and frequency range; ordinary Delete removes the whole selected passage.',
		],
	},
	{
		id: 'restore-clipped-peaks',
		title: 'Restore short clipped peaks',
		description: 'Try Clip Fix on brief clipped peaks and compare the result with the original.',
		audacity: 'Effect → Noise Removal and Repair → Clip Fix (Audacity 3 and 4)',
		intro: 'Clip Fix estimates the missing tops of short clipped peaks from the neighboring waveform. Use it on a copy of your recording and listen closely; it cannot reconstruct longer clipped passages.',
		steps: [
			open(),
			importAudio('clipped-take', { what: 'a recording with short clipped peaks you want to repair' }),
			selectAll(),
			nyquist({
				menu: 'Effect',
				name: 'Clip Fix',
				fields: [
					{ label: 'Threshold of Clipping (%)', value: '95' },
					{ label: 'Reduce amplitude to allow for restored peaks (dB)', value: '-9' },
				],
			}, { why: 'The threshold identifies flattened peaks, and the headroom leaves room for their estimated shape.' }),
			play({ see: 'The repaired peaks sound less harsh; compare with the untouched source before keeping the change.' }),
		],
		tips: [
			'Clip Fix works best on brief, lightly clipped peaks; it does not recreate missing detail in sustained distortion.',
			'Keep an untouched copy so you can compare the repaired transients and undo if the waveform sounds less natural.',
		],
	},
	{
		id: 'compress-long-pauses',
		title: 'Compress long pauses',
		description: 'Shorten pauses beyond a chosen duration without removing all silence.',
		audacity: 'Effect → Special → Truncate Silence',
		intro: 'Long pauses can make spoken material feel slow, while cutting every pause can make it hard to follow. Truncate Silence can compress only the excess portion of pauses that exceed a minimum length.',
		steps: [
			open(),
			importAudio('gapped-take', { what: 'a recording with pauses that feel too long' }),
			selectAll(),
			effect({
				group: 'Special',
				name: 'Truncate Silence',
				settings: [
					{ label: 'Threshold', value: '-40' },
					{ label: 'Minimum silence', value: '0.5' },
					{ label: 'Action', option: 'Compress excess silence' },
					{ label: 'Compress to', value: '50' },
				],
			}, { why: 'Silence longer than 0.5 seconds is shortened to half its excess duration, leaving a pause between phrases.' }),
			play({ see: 'The long pauses are shorter, with some silence still separating phrases.' }),
		],
		tips: [
			'Raise **Minimum silence** to leave shorter pauses alone, or lower **Compress to** to tighten the long ones further.',
			'Listen for clipped breaths or phrase endings; undo if the pacing becomes unnatural.',
		],
	},
]);

export const VOLUME_WORKFLOW_GUIDES = Object.freeze([
	{
		id: 'normalize-to-an-rms-target',
		title: 'Normalize a recording to an RMS target',
		description: 'Set the average signal level to a chosen RMS value while keeping stereo channels linked.',
		audacity: 'Effect → Volume and Compression → Loudness Normalization',
		intro: 'RMS normalization adjusts a selection toward a target average signal level rather than a peak ceiling. It is useful when you need a consistent level across recordings; check the peaks afterward if the source is very dynamic.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording whose average level you want to set' }),
			selectAll(),
			effect({
				group: 'Volume and compression',
				name: 'Loudness Normalization',
				settings: [
					{ label: 'Normalize', option: 'RMS' },
					{ label: 'Target RMS', value: '-20' },
					{ label: 'Normalize stereo channels independently', checked: false },
				],
			}, { why: 'A linked stereo adjustment preserves the balance between left and right while targeting −20 dB RMS.' }),
			play({ see: 'The recording has been adjusted toward the −20 dB RMS target, with stereo balance preserved.' }),
		],
		tips: [
			'Use the same RMS target for recordings you want to compare at a similar average level.',
			'RMS normalization does not guarantee a peak ceiling; check for clipping and leave headroom when needed.',
		],
	},
]);

export const EFFECT_WORKFLOW_GUIDES = Object.freeze([
	{
		id: 'boost-a-selected-frequency-band',
		title: 'Boost a selected frequency band',
		description: 'Raise a narrow range of frequencies during a chosen passage with spectral editing.',
		audacity: 'Effect → Spectral Tools → Amplify selection (Audacity 4)',
		intro: 'Spectral Amplify raises a frequency band only inside a selected time span. A small boost can bring out a quiet tone or detail without raising the entire recording.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording with a quiet detail you want to emphasize' }),
			trackMenu(['Track visualization', 'Spectrogram'], { fixture: 'music-loop', which: 'the track you want to inspect' }),
			selectRange(0.25, 0.75, { where: 'the passage containing the detail' }),
			spectralRange({ minimum: 200, maximum: 320, operation: 'amplify', gain: 4 }, { why: 'A modest 4 dB boost raises only the chosen band during this passage.' }),
			play({ see: 'The selected detail is more prominent in that passage, while the rest stays at its previous level.' }),
		],
		tips: [
			'Keep the frequency bounds close to the detail you want; a wider band also raises nearby sounds.',
			'Use a smaller gain if the boosted passage becomes harsh or louder than the surrounding audio.',
		],
	},
	{
		id: 'invert-polarity-for-cancellation',
		title: 'Invert polarity to check cancellation',
		description: 'Invert a duplicate track to hear how closely it matches the original.',
		audacity: 'Effect → Special → Invert',
		intro: 'Two identical, time-aligned recordings cancel when one has its polarity inverted and they play together. This check can reveal whether edits or processing made a copy differ from its source.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording you want to compare with a copy' }),
			selectAll(),
			trackMenu(['Duplicate track'], { fixture: 'music-loop', which: 'the track you are comparing' }),
			effect({ group: 'Special', name: 'Invert', direct: true }, { why: 'Inverting the copy makes matching samples opposite in polarity while the original remains unchanged.' }),
			play({ see: 'If the tracks match and remain aligned, they cancel; any remaining sound reveals a difference.' }),
		],
		tips: [
			'Cancellation requires the same timing and level; even a small offset leaves an audible residual.',
			'Keep both tracks unmuted and leave Solo off so both can be heard together. Undo restores the duplicate before the polarity test.',
		],
	},
]);
