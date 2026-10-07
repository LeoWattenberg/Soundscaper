/* SPDX-License-Identifier: AGPL-3.0-only */

import { effect, importAudio, menu, open, play } from '../steps.mjs';

const selectAll = () => menu(['Select', 'Select all']);

export const CREATIVE_EFFECT_GUIDES = Object.freeze([
	{
		id: 'apply-tremolo',
		title: 'Add a tremolo pulse',
		description: 'Make a recording pulse by turning its volume up and down at a steady rate.',
		audacity: 'Audacity 4.0.1: Effect → Distortion and Modulation → Tremolo',
		intro: 'Tremolo moves the volume up and down in a repeating pattern, like a rhythmic swell. Use it on a sustained instrument, pad, or voice when a static sound needs motion.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the sustained sound you want to give a pulse' }),
			selectAll(),
			effect({ group: 'Distortion and modulation', name: 'Tremolo', settings: [{ label: 'Depth', value: '60' }, { label: 'Frequency', value: '4' }] },
				{ why: 'Depth sets how far the volume falls on each cycle; frequency sets how many pulses happen each second.' }),
			play({ see: 'The selected sound rises and falls in a steady pulse.' }),
		],
		tips: [
			'Use a lower **Frequency** for a slow swell and a higher one for a faster, more obvious pulse.',
			'Keep **Depth** modest when the sound must remain audible through the quiet part of each cycle.',
		],
	},
	{
		id: 'apply-bitcrusher',
		title: 'Give a sound a bitcrusher texture',
		description: 'Reduce bit depth or sample rate to make a sound rougher and more lo-fi.',
		audacity: 'No direct built-in equivalent in Audacity’s current effect list.',
		intro: 'A bitcrusher deliberately reduces the detail used to represent a sound, adding grain and digital edge. It works well on a synth, drum hit, or a short vocal phrase when clean audio feels too polished.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the sound you want to roughen' }),
			selectAll(),
			effect({ group: 'Distortion and modulation', name: 'Bitcrusher', settings: [{ label: 'Bit depth', value: '6' }, { label: 'Sample rate reduction', value: '4' }] },
				{ why: 'Fewer bits make the amplitude steps more audible; sample rate reduction lowers the detail in time.' }),
			play({ see: 'The sound has a rough, stepped digital edge.' }),
		],
		tips: [
			'Change one control at a time so you can hear whether the roughness comes from amplitude steps or reduced sample detail.',
			'Lower **Mix** to blend the crushed sound with the original if the full effect is too harsh.',
		],
	},
	{
		id: 'make-a-vocoder-effect',
		title: 'Make a vocoder effect',
		description: 'Shape a voice with a carrier sound for a robotic, sung, or synthetic tone.',
		audacity: 'Audacity 4.0.1: Effect → Distortion and Modulation → Vocoder',
		intro: 'A vocoder uses the changing shape of a voice to control another sound, so speech can take on a musical or robotic tone. In Soundscaper, apply it to a mono voice selection and choose a carrier level to shape the result.',
		steps: [
			open(),
			importAudio('quiet-take', { what: 'the mono voice or other sound whose shape should control the effect' }),
			selectAll(),
			effect({ group: 'Distortion and modulation', name: 'Vocoder', settings: [{ label: 'Vocoder bands', value: '24' }, { label: 'Output', option: 'Vocoded audio' }] },
				{ why: 'The bands set how finely the voice shape is divided; **Audio carrier level** controls the built-in carrier for a mono selection.' }),
			play({ see: 'The voice has a synthetic, harmonized character.' }),
		],
		tips: [
			'A steady pitched carrier gives a more musical result; white noise or radar pulses make the voice more mechanical.',
			'For Audacity’s stereo workflow, put the voice in the left channel and carrier in the right before applying its Vocoder.',
		],
	},
	{
		id: 'add-multi-tap-delay',
		title: 'Add repeating echoes with Delay',
		description: 'Create a pattern of echoes and choose how many repeats follow the selected sound.',
		audacity: 'Audacity 4.0.1: Effect → Delay and Reverb → Delay',
		intro: 'Delay repeats a sound after a chosen gap, then sends it through a series of quieter echoes. This multi-tap effect is useful for rhythmic repeats on a phrase, note, or other selected passage.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the phrase or sound you want to repeat' }),
			selectAll(),
			effect({ group: 'Delay and reverb', name: 'Delay', settings: [{ label: 'Delay time', value: '0.3' }, { label: 'Number of echoes', value: '4' }, { label: 'Echo duration', option: 'Include complete echoes' }] },
				{ why: 'Delay time sets the space between repeats; the echo count sets how many are made. The effect can lengthen the selected passage to retain its echo tail.' }),
			play({ see: 'The selected sound is followed by a series of fading echoes.' }),
		],
		tips: [
			'Use a shorter **Delay time** for a dense texture and a longer one when you want to hear each repeat distinctly.',
			'Lower **Gain per echo** if the repeats build up too loudly or crowd the original sound.',
		],
	},
]);

export const REPAIR_EFFECT_GUIDES = Object.freeze([
	{
		id: 'reduce-sibilance-with-a-de-esser',
		title: 'Tame sharp sibilance',
		description: 'Reduce sharp S and SH sounds in a voice without turning down the whole recording.',
		audacity: 'No direct built-in equivalent in Audacity’s current effect list.',
		intro: 'A de-esser turns down strong sibilants in speech while leaving most of the voice alone. Use it on a voice passage where S or SH sounds jump out more than the surrounding words.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the voice passage with distracting S sounds' }),
			selectAll(),
			effect({ group: 'Noise removal and repair', name: 'De-esser', settings: [{ label: 'Frequency', value: '6000' }, { label: 'Maximum reduction', value: '6' }] },
				{ why: 'Frequency targets the sibilant range; maximum reduction limits how far those moments are turned down.' }),
			play({ see: 'Sibilants are softer while the rest of the voice stays present.' }),
		],
		tips: [
			'Listen for the S sounds while adjusting **Frequency**; a setting too low can dull consonants and brightness.',
			'Use a modest **Maximum reduction** first, then increase it only if sharp sibilants still distract.',
		],
	},
]);

export const DYNAMICS_EFFECT_GUIDES = Object.freeze([
	{
		id: 'compress-frequency-bands-independently',
		title: 'Compress frequency bands independently',
		description: 'Control bass, midrange, and treble separately with a multiband compressor.',
		audacity: 'No direct built-in multiband compressor in Audacity’s current effect list.',
		intro: 'A multiband compressor splits a selection into low, middle, and high frequency ranges and controls each range independently. It can steady a bass-heavy mix without making the cymbals or vocals pump along with it.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the mix or instrument whose frequency ranges need separate control' }),
			selectAll(),
			effect({ group: 'Volume and compression', name: 'Multiband compressor', settings: [{ label: 'Low ratio', value: '3' }, { label: 'Low threshold', value: '-24' }] },
				{ why: 'The low-band ratio sets how strongly bass above its threshold is compressed; crossover controls define what belongs to each band.' }),
			play({ see: 'Bass peaks are steadier while the other frequency bands retain their own dynamics.' }),
		],
		tips: [
			'Adjust **Low crossover** and **High crossover** so the bands divide the material where you need control.',
			'Use small ratio changes and compare with Undo; heavy compression can make a mix lose punch.',
		],
	},
]);
