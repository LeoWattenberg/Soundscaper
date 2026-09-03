/* SPDX-License-Identifier: AGPL-3.0-only */

import { check, effect, importAudio, menu, noiseProfile, open, play, selectRange } from '../steps.mjs';

const selectAll = (extras) => menu(['Select', 'Select all'], extras);

export const CLEAN_UP_LESSONS = Object.freeze([
	{
		id: 'remove-background-noise',
		title: 'Remove background noise',
		description: 'Teach Noise Reduction what the hum sounds like, then take it out of the whole recording.',
		audacity: 'Effect → Noise Removal and Repair → Noise Reduction, in two passes',
		intro: 'Steady background noise — a fan, a fridge, mains hum — can be removed in two passes. First you show Noise Reduction a stretch of noise on its own so it can build a profile; then you apply the effect to everything. The profile is what makes this work, so pick a part of the recording where nobody is speaking.',
		steps: [
			open(),
			importAudio('noisy-take'),
			selectRange(0, 0.15, { why: 'This is the noise-only lead-in before the voice starts. The profile should contain nothing but the noise you want gone.' }),
			noiseProfile(),
			selectAll({ why: 'The profile is kept; now the effect needs to know what to clean.' }),
			effect({
				group: 'Noise removal and repair',
				name: 'Noise Reduction',
				settings: [{ label: 'Noise reduction', value: '12' }],
			}, { why: 'Around 12 dB is a good first try. Higher values remove more noise but start to make voices sound hollow.' }),
			play({ see: 'The lead-in is much quieter and the voice is untouched.' }),
		],
		tips: [
			'If the result sounds watery or metallic, undo and try a lower **Noise reduction** value or a lower **Sensitivity**.',
			'Noise Reduction only works on noise that stays the same throughout the recording. For a single cough or click, cut it out or use Click Removal instead.',
		],
	},
	{
		id: 'remove-clicks-and-pops',
		title: 'Remove clicks and pops',
		description: 'Take short sharp clicks out of a recording without touching the rest.',
		audacity: 'Effect → Noise Removal and Repair → Click Removal',
		intro: 'Clicks from a cable, a mouse or an old record are only a few samples long. Click Removal finds spikes that stand out from their surroundings and smooths them over, which is far quicker than cutting each one by hand.',
		steps: [
			open(),
			importAudio('clicky-take'),
			selectAll(),
			effect({
				group: 'Noise removal and repair',
				name: 'Click Removal',
				settings: [{ label: 'Threshold', value: '150' }],
			}, { why: 'A lower threshold catches quieter clicks. The default of 200 is conservative; 150 catches more without reaching into the music.' }),
			play({ see: 'The clicks are gone and the material around them is unchanged.' }),
		],
		tips: [
			'If a click survives, select just the moment around it and run the effect again with a lower **Threshold**.',
			'A click that is wider than a few milliseconds is not a click to this effect. Cut it out instead.',
		],
	},
	{
		id: 'remove-silent-pauses',
		title: 'Shorten long pauses',
		description: 'Tighten a recording by trimming every long silence to the same short gap.',
		audacity: 'Effect → Special → Truncate Silence',
		intro: 'A long take with slow pauses between sentences is tiring to listen to. Truncate Silence finds every stretch below a threshold that lasts longer than a minimum length and shortens it, so the pacing tightens without cutting into any words.',
		steps: [
			open(),
			importAudio('gapped-take'),
			selectAll(),
			effect({
				group: 'Special',
				name: 'Truncate Silence',
				settings: [{ label: 'Threshold', value: '-40' }],
			}, { why: 'Anything quieter than −40 dB counts as silence. Pauses longer than the minimum silence length are cut down to the truncate length; both keep their defaults of half a second here.' }),
			play({ see: 'The pauses are shorter and every phrase is still complete.' }),
		],
		tips: [
			'If words at the start of a phrase get clipped, raise the minimum silence length or lower the threshold.',
			'The effect changes the length of the selection, so run it before you line the take up against anything else.',
		],
	},
	{
		id: 'silence-part-of-a-recording',
		title: 'Silence part of a recording',
		description: 'Replace a stretch of audio with silence while keeping everything in place.',
		audacity: 'Edit → Remove Special → Silence Audio',
		intro: 'Sometimes you want a passage gone but not the time it occupies — a phone ringing under a pause, a name you need to bleep. Silencing keeps the clip exactly as long as it was and only flattens the selected part.',
		steps: [
			open(),
			importAudio('music-loop'),
			selectRange(0.4, 0.6, { why: 'Select just the part you want to mute.' }),
			menu(['Edit', 'Remove special', 'Silence audio']),
			check({ clips: 1 }, { see: 'The waveform is flat across the selection and the clip is still one piece.' }),
		],
		tips: [
			'Silence is a normal edit: **Edit → Undo** brings the audio back.',
			'To remove the time as well as the sound, see [Cut a mistake out of a recording](/lessons/cut-out-a-mistake/).',
		],
	},
	{
		id: 'remove-low-rumble',
		title: 'Remove low rumble',
		description: 'Cut the sub-bass thumps from traffic, wind and handling with a high-pass filter.',
		audacity: 'Effect → High-Pass Filter',
		intro: 'Traffic, air conditioning, wind on the microphone and the desk being bumped all live below the voice, in frequencies a small speaker cannot even reproduce. A high-pass filter lets everything above a cutoff through and rolls off what is below it, cleaning up the low end without touching the speech.',
		steps: [
			open(),
			importAudio('noisy-take'),
			selectAll(),
			effect({
				group: 'Legacy effects',
				name: 'Classic Filters',
				settings: [
					{ label: 'Filter type', option: 'High-pass' },
					{ label: 'Cutoff frequency', value: '100' },
				],
			}, { why: '100 Hz is safe for speech. Raise the order for a steeper roll-off.' }),
			play({ see: 'The low rumble is gone and the voice sounds the same.' }),
		],
		tips: [
			'For music, start lower — around 40 Hz — so bass instruments are not thinned.',
			'The realtime **High-pass filter** in a track’s effect rack does the same job while you play, without rendering.',
		],
	},
	{
		id: 'fix-dc-offset',
		title: 'Fix a DC offset',
		description: 'Recentre a waveform that sits above or below the zero line.',
		audacity: 'Effect → Normalize with Remove DC offset',
		intro: 'Some sound cards and cheap interfaces add a constant voltage to a recording, so the whole waveform sits slightly above or below the centre line. You cannot hear it directly, but it wastes headroom and produces a click at every edit. Remove DC Offset centres the waveform again.',
		steps: [
			open(),
			importAudio('quiet-take'),
			selectAll(),
			effect({ group: 'Volume and compression', name: 'Remove DC Offset', direct: true }),
			play({ see: 'The waveform is centred on the zero line.' }),
		],
		tips: [
			'[Normalize](/lessons/normalize-peaks/) removes DC offset as part of its job, so if you normalize anyway there is nothing extra to do.',
			'An offset that changes over the recording is not DC; use a [high-pass filter](/lessons/remove-low-rumble/) instead.',
		],
	},
]);
