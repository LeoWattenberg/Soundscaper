/* SPDX-License-Identifier: AGPL-3.0-only */

import { effect, importAudio, menu, open, play } from '../steps.mjs';

const selectAll = (extras) => menu(['Select', 'Select all'], extras);

export const EFFECT_LESSONS = Object.freeze([
	{
		id: 'change-tempo-without-changing-pitch',
		title: 'Change tempo without changing pitch',
		description: 'Speed a recording up or slow it down while every note stays at the same pitch.',
		audacity: 'Effect → Pitch and Tempo → Change Tempo',
		intro: 'Slowing a passage down to learn it, or squeezing a voice-over into the time you have, used to mean the pitch moved with the speed. Change Tempo keeps the pitch where it is and only alters how fast the material goes by.',
		steps: [
			open(),
			importAudio('music-loop'),
			selectAll(),
			effect({
				group: 'Pitch and tempo',
				name: 'Change tempo',
				settings: [{ label: 'Percent change', value: '10' }],
			}, { why: 'A positive value speeds the selection up; ten percent shortens it by roughly a tenth. Negative values slow it down.' }),
			play({ see: 'The loop is a little faster and sounds the same in pitch.' }),
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
			importAudio('music-loop'),
			selectAll(),
			effect({
				group: 'Pitch and tempo',
				name: 'Change pitch',
				settings: [{ label: 'Semitones', value: '2' }],
			}, { why: 'Two semitones is one whole tone up. Negative values go down.' }),
			play({ see: 'The loop is higher and exactly as long as before.' }),
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
			importAudio('music-loop'),
			selectAll(),
			effect({
				group: 'Delay and reverb',
				name: 'Echo',
				settings: [{ label: 'Decay factor', value: '0.4' }],
			}, { why: 'Each repeat is 0.4 times as loud as the one before it, so the echo dies away after a few repeats. **Delay time** sets the gap between them.' }),
			play({ see: 'The loop is followed by fading repeats of itself.' }),
		],
		tips: [
			'Add a second or two of silence after the clip first (**Generate → Silence**) so the last repeats have room to sound.',
			'For a room rather than distinct repeats, use [Reverb](/lessons/add-reverb/).',
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
			importAudio('music-loop'),
			selectAll(),
			effect({
				group: 'Delay and reverb',
				name: 'Reverb',
				settings: [
					{ label: 'Room size', value: '40' },
					{ label: 'Reverberance', value: '60' },
				],
			}, { why: 'Room size sets how big the space feels; reverberance sets how long it rings. Keep both moderate for speech.' }),
			play({ see: 'The loop sits in a space instead of directly at the ear.' }),
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
			importAudio('music-loop'),
			selectAll(),
			effect({
				group: 'EQ and filters',
				name: 'Bass and Treble',
				settings: [
					{ label: 'Bass', value: '4' },
					{ label: 'Treble', value: '2' },
				],
			}, { why: 'Small boosts go a long way. Four decibels of bass is clearly audible; more than about eight starts to boom.' }),
			play({ see: 'The loop is fuller at the bottom and a little brighter on top.' }),
		],
		tips: [
			'Boosting adds level. If the waveform touches the top afterwards, lower **Volume** in the same dialog or normalize.',
			'For precise control over particular frequencies, use **Filter Curve EQ** or **Graphic EQ** in the same submenu.',
		],
	},
]);
