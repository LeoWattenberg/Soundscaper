/* SPDX-License-Identifier: AGPL-3.0-only */

import { effect, importAudio, menu, nyquist, open, play, rackEffect } from '../steps.mjs';

const selectAll = (extras) => menu(['Select', 'Select all'], extras);

export const EFFECT_GUIDES = Object.freeze([
	{
		id: 'change-tempo-without-changing-pitch',
		title: 'Change tempo without changing pitch',
		description: 'Speed a recording up or slow it down while every note stays at the same pitch.',
		audacity: 'Effect → Pitch and Tempo → Change Tempo',
		intro: 'Slowing a passage down to learn it, or squeezing a voice-over into the time you have, used to mean the pitch moved with the speed. Change Tempo keeps the pitch where it is and only alters how fast the material goes by.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording to speed up or slow down' }),
			selectAll(),
			effect({
				group: 'Pitch and tempo',
				name: 'Change tempo',
				settings: [{ label: 'Percent change', value: '10' }],
			}, { why: 'A positive value speeds the selection up; ten percent shortens it by roughly a tenth. Negative values slow it down.' }),
			play({ see: 'The recording is a little faster and sounds the same in pitch.' }),
		],
		tips: [
			'Large changes — beyond about 30 percent — begin to sound processed. Apply a large change in two smaller steps if the result matters.',
			'The clip gets shorter or longer, so anything that follows it on the track moves.',
		],
	},
	{
		id: 'change-pitch-without-changing-tempo',
		title: 'Change pitch without changing tempo',
		description: 'Move a recording up or down by a number of semitones and keep its timing.',
		audacity: 'Effect → Pitch and Tempo → Change Pitch',
		intro: 'Transposing a backing track to a singer’s key, or nudging an instrument that was tuned a little flat, is a pitch change that must not alter the length. Change Pitch shifts the selection by whole semitones and leaves the timing untouched.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording to transpose' }),
			selectAll(),
			effect({
				group: 'Pitch and tempo',
				name: 'Change pitch',
				settings: [{ label: 'Semitones', value: '2' }],
			}, { why: 'Two semitones is one whole tone up. Negative values go down.' }),
			play({ see: 'The recording is higher and exactly as long as before.' }),
		],
		tips: [
			'**Preserve formants** keeps a voice sounding like the same person when it is shifted; turn it off for instruments if the result sounds nasal.',
			'To change pitch and speed together, the way a tape does, use **Change speed and pitch** in the same submenu.',
		],
	},
	{
		id: 'add-echo',
		title: 'Add an echo',
		description: 'Repeat a sound at a fixed interval, quieter each time.',
		audacity: 'Effect → Delay and Reverb → Echo',
		intro: 'Echo plays the selection again after a delay, then again, each repeat quieter than the last. It is the classic slap-back on a vocal or the canyon effect on a shout.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the sound that should echo' }),
			selectAll(),
			effect({
				group: 'Delay and reverb',
				name: 'Echo',
				settings: [{ label: 'Decay factor', value: '0.4' }],
			}, { why: 'Each repeat is 0.4 times as loud as the one before it, so the echo dies away after a few repeats. **Delay time** sets the gap between them.' }),
			play({ see: 'The sound is followed by fading repeats of itself.' }),
		],
		tips: [
			'Add a second or two of silence after the clip first (**Generate → Silence**) so the last repeats have room to sound.',
			'For a room rather than distinct repeats, use [Reverb](guide:add-reverb).',
		],
	},
	{
		id: 'add-reverb',
		title: 'Put a recording in a room',
		description: 'Add reverb so a dry recording sounds like it was made in a real space.',
		audacity: 'Effect → Delay and Reverb → Reverb',
		intro: 'A close microphone in a treated room gives a dry, intimate sound that can feel lifeless on its own. Reverb adds the thousands of tiny reflections a room would have contributed, from a small booth to a hall.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording that sounds too dry' }),
			selectAll(),
			effect({
				group: 'Delay and reverb',
				name: 'Reverb',
				settings: [
					{ label: 'Room size', value: '40' },
					{ label: 'Reverberance', value: '60' },
				],
			}, { why: 'Room size sets how big the space feels; reverberance sets how long it rings. Keep both moderate for speech.' }),
			play({ see: 'The recording sits in a space instead of directly at the ear.' }),
		],
		tips: [
			'Lower **Wet gain** or raise **Dry gain** if the effect swamps the original.',
			'Reverb on the whole mix rarely works. Apply it to the parts that need it and leave the rest dry.',
		],
	},
	{
		id: 'boost-bass-and-treble',
		title: 'Boost bass and treble',
		description: 'Warm up or brighten a recording with two simple tone controls.',
		audacity: 'Effect → EQ and Filters → Bass and Treble',
		intro: 'Bass and Treble is the tone control from a hi-fi amplifier: one knob for the low end, one for the high end, each in decibels. It is the fastest way to warm a thin voice or add air to a dull recording without learning a full equalizer.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording that needs warming or brightening' }),
			selectAll(),
			effect({
				group: 'EQ and filters',
				name: 'Bass and Treble',
				settings: [
					{ label: 'Bass', value: '4' },
					{ label: 'Treble', value: '2' },
				],
			}, { why: 'Small boosts go a long way. Four decibels of bass is clearly audible; more than about eight starts to boom.' }),
			play({ see: 'The recording is fuller at the bottom and a little brighter on top.' }),
		],
		tips: [
			'Boosting adds level. If the waveform touches the top afterwards, lower **Volume** in the same dialog or normalize.',
			'For precise control over particular frequencies, use **Filter Curve EQ** or **Graphic EQ** in the same submenu.',
		],
	},
	{
		id: 'change-speed-like-a-tape',
		title: 'Change speed like a tape machine',
		description: 'Speed a recording up or slow it down with the pitch following, the way tape does.',
		audacity: 'Effect → Pitch and Tempo → Change Speed',
		intro: 'Sometimes the old-fashioned effect is the one you want: slow a recording down and it drops in pitch, speed it up and it rises, like a record played at the wrong speed. Change speed and pitch does exactly that, and because it does not have to separate pitch from time it is the cleanest of the speed effects.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording to speed up or slow down' }),
			selectAll(),
			effect({
				group: 'Pitch and tempo',
				name: 'Change speed and pitch',
				settings: [{ label: 'Speed change', value: '25' }],
			}, { why: 'A positive percentage speeds the selection up and raises its pitch; −50 halves the speed and drops it an octave.' }),
			play({ see: 'The recording is faster and higher, and shorter than before.' }),
		],
		tips: [
			'To fix a recording made at the wrong sample rate — 44.1 kHz material played as 48 kHz sounds sped up by about 9 percent — the exact correction is −8.16 percent.',
			'To change speed without the pitch moving, use [Change tempo](guide:change-tempo-without-changing-pitch) instead.',
		],
	},
	{
		id: 'stretch-a-sound-into-a-drone',
		title: 'Stretch a sound into a drone',
		description: 'Slow a short sound down enormously with Paulstretch to make ambient textures.',
		audacity: 'Effect → Pitch and Tempo → Paulstretch',
		intro: 'Paulstretch is the effect behind the slowed-down pop songs that turn into cathedrals of sound. It stretches a selection by a large factor while smearing the detail into a smooth wash, which no ordinary tempo change can do. Use it for drones, pads and atmospheres.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the sound to stretch' }),
			selectAll(),
			effect({
				group: 'Pitch and tempo',
				name: 'Paulstretch',
				settings: [{ label: 'Stretch factor', value: '4' }],
			}, { why: 'Four makes the selection four times as long. Factors of 10 and beyond are where it gets dreamlike; they also take proportionally longer to render.' }),
			play({ see: 'The sound has become a slow, smooth wash four times as long.' }),
		],
		tips: [
			'A larger **Time resolution** smooths the result further and loses more of the rhythm; a smaller one keeps more attack.',
			'The output is long. Trim what you need and fade the ends.',
		],
	},
	{
		id: 'add-distortion',
		title: 'Add distortion',
		description: 'Overdrive a sound from gentle warmth to full fuzz.',
		audacity: 'Effect → Distortion',
		intro: 'Distortion clips or bends the waveform so it gains harmonics. A little soft overdrive warms a bass or a synth; a lot turns a guitar into a wall. The type chooses the shape of the curve; the threshold sets how much of the signal reaches it.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the sound to distort' }),
			selectAll(),
			effect({
				group: 'Distortion and modulation',
				name: 'Distortion',
				settings: [
					{ label: 'Distortion type', option: 'Soft Overdrive' },
					{ label: 'Threshold', value: '-12' },
				],
			}, { why: 'Soft Overdrive rounds the peaks instead of chopping them. A lower threshold drives more of the signal into the curve.' }),
			play({ see: 'The sound is grittier and its peaks are rounded.' }),
		],
		tips: [
			'Turn on **DC block** if the result sits off-centre in the waveform.',
			'Distortion adds level. Normalize afterwards if the peaks reach the top.',
		],
	},
	{
		id: 'add-a-wah-wah',
		title: 'Add a wah-wah',
		description: 'Sweep a resonant filter across a sound for the classic funk effect.',
		audacity: 'Effect → Wahwah',
		intro: 'A wah pedal sweeps a resonant filter up and down the spectrum; the Wahwah effect does the sweep for you at a rate you set. It suits guitars, keyboards and anything with steady sustain.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording to put the wah on' }),
			selectAll(),
			effect({
				group: 'Distortion and modulation',
				name: 'Wahwah',
				settings: [
					{ label: 'LFO frequency', value: '2' },
					{ label: 'Depth', value: '80' },
				],
			}, { why: 'The LFO frequency is how many sweeps happen a second; depth is how far the filter travels.' }),
			play({ see: 'The recording wobbles with a sweeping, vowel-like tone.' }),
		],
		tips: [
			'**Resonance** sharpens the peak of the filter; high values squeal.',
			'The **Phaser** in the same submenu gives a gentler, swirling movement.',
		],
	},
	{
		id: 'use-a-nyquist-plugin',
		title: 'Use a Nyquist plug-in',
		description: 'Run one of the bundled Nyquist effects — here, a tremolo.',
		audacity: 'Effect → Tremolo (a Nyquist plug-in)',
		intro: 'Audacity’s Nyquist plug-ins are small scripts that add effects, generators and analyzers, and Soundscaper bundles the same ones under a Nyquist submenu of each menu. Tremolo is a good first one: it wobbles the volume at a set rate.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording to try the plug-in on' }),
			selectAll(),
			nyquist({
				menu: 'Effect',
				name: 'Tremolo',
				fields: [{ label: 'Frequency (Hz)', value: '6' }],
			}, { why: 'Six wobbles a second is a classic amp tremolo. Nyquist dialogs use **Apply** rather than Apply to selection.' }),
			play({ see: 'The recording pulses in volume.' }),
		],
		tips: [
			'The Generate and Analyze menus have Nyquist submenus of their own, with plug-ins such as Pluck and Beat Finder.',
			'**Tools → Nyquist prompt** runs a script you type yourself.',
		],
	},
	{
		id: 'add-a-realtime-effect-to-a-track',
		title: 'Add a realtime effect to a track',
		description: 'Put an effect on a track so it runs while you play, without rendering.',
		audacity: 'Effect → Add Realtime Effects',
		intro: 'The effects in the Effect menu change the audio once and for all. A realtime effect sits on a track instead: it runs during playback and export, its settings can be changed at any time, and the original audio is never touched. It is the right choice for reverb, EQ and compression that you want to keep adjusting as the mix develops.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording the effect should sit on' }),
			rackEffect('Reverb', { why: 'The track’s rack now lists Reverb. Its settings window stays available from the rack whenever you want to adjust it.' }),
			play({ see: 'The track plays through the reverb.' }),
		],
		tips: [
			'Add several effects to a rack and drag them to change their order; each feeds the next.',
			'The master rack, at the bottom of the Effects panel, processes the whole mix.',
		],
	},
]);
