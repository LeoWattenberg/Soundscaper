/* SPDX-License-Identifier: AGPL-3.0-only */

import { effect, importAudio, menu, open, play } from '../steps.mjs';

const selectAll = () => menu(['Select', 'Select all']);

export const FILTER_WORKFLOW_GUIDES = Object.freeze([
	{
		id: 'apply-a-low-pass-filter',
		title: 'Soften a recording with a low-pass filter',
		description: 'Reduce hiss and other high frequencies while keeping the lower part of a recording.',
		audacity: 'Effect → EQ and Filters → Low-Pass Filter',
		intro: 'A low-pass filter keeps frequencies below its cutoff and gradually reduces those above it. Use a gentle cutoff to tame hiss or soften a bright recording without removing its body.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording whose high end you want to soften' }),
			selectAll(),
			effect({
				group: 'EQ and filters',
				name: 'Low-pass filter',
				settings: [
					{ label: 'Cutoff frequency', value: '5000' },
					{ label: 'Rolloff', option: '12 dB/octave' },
				],
			}, { why: 'A 5 kHz cutoff takes some edge off the top; 12 dB per octave gives a gradual slope.' }),
			play({ see: 'The recording sounds a little softer in the high frequencies.' }),
		],
		tips: [
			'Lower the cutoff to remove more brightness, but listen for cymbals and consonants becoming dull.',
			'Choose a steeper **Rolloff** when you need a stronger boundary above the cutoff.',
		],
	},
	{
		id: 'shape-tone-with-parametric-eq',
		title: 'Shape a narrow frequency band with Parametric EQ',
		description: 'Use a selected EQ band to make a focused tonal cut or boost.',
		audacity: 'Spectral Edit Parametric EQ, a spectrogram-only feature with no equivalent to Soundscaper’s track-wide effect',
		intro: 'Parametric EQ gives each band a frequency, gain and Q control, so you can make a focused cut for a resonant tone or a small boost for presence. Select a band in the graph, then adjust its frequency and Q to choose where and how wide the change is.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording whose tone you want to adjust' }),
			selectAll(),
			effect({
				group: 'EQ and filters',
				name: 'Parametric EQ',
				settings: [
					{ label: 'Frequency (Hz)', value: '500' },
					{ label: 'Gain (dB)', value: '-3' },
					{ label: 'Q', value: '1.2' },
				],
			}, { why: 'The selected band makes a modest, focused cut around 500 Hz.' }),
			play({ see: 'There is a focused cut around 500 Hz, with the other bands unchanged.' }),
		],
		tips: [
			'A narrower band has a higher **Q**. Start with a small gain change and increase it only if the problem remains.',
			'Soundscaper’s track-wide Parametric EQ is not the same as Audacity’s spectrogram-only Spectral Edit Parametric EQ.',
		],
	},
	{
		id: 'shape-tone-with-graphic-eq',
		title: 'Adjust tone with Graphic EQ',
		description: 'Make broad tonal changes with a bank of frequency sliders.',
		audacity: 'Effect → EQ and Filters → Graphic EQ',
		intro: 'Graphic EQ uses one slider for each third-octave frequency band. Raise or lower neighboring sliders together for a broad change, or move one slider for a narrower tonal adjustment.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording whose tone you want to adjust' }),
			selectAll(),
			effect({
				group: 'EQ and filters',
				name: 'Graphic EQ',
				settings: [{ label: '1000 Hz', value: '4' }],
			}, { why: 'A small boost at 1 kHz adds presence without changing the whole spectrum.' }),
			play({ see: 'The recording has a small presence lift around 1 kHz.' }),
		],
		tips: [
			'Use small boosts and cuts first; raising many bands also raises the overall level and can cause clipping.',
			'For a smooth, custom curve between frequencies, use [Filter Curve EQ](guide:draw-a-filter-curve).',
		],
	},
	{
		id: 'draw-a-filter-curve',
		title: 'Draw a custom EQ curve',
		description: 'Shape several frequency ranges with one continuous EQ curve.',
		audacity: 'Effect → EQ and Filters → Filter Curve EQ',
		intro: 'Filter Curve EQ lets you draw the tonal balance you want instead of choosing a fixed band or shelf. Add points to the curve to cut rumble, preserve the middle, or soften the highest frequencies.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording whose frequency balance you want to shape' }),
			selectAll(),
			effect({
				group: 'EQ and filters',
				name: 'Filter Curve EQ',
				settings: [{ label: 'Curve points (Hz:dB)', value: '20:-12, 60:-12, 100:0, 1000:0, 8000:-3, 20000:-3', expand: true }],
			}, { why: 'The curve cuts the lowest rumble and softens the highest frequencies while leaving the middle level.' }),
			play({ see: 'Low rumble and the highest frequencies are reduced while the middle stays level.' }),
		],
		tips: [
			'Keep curve changes modest, especially where the recording already has strong low frequencies.',
			'The horizontal axis is frequency and the vertical axis is gain; a lower point reduces that frequency range.',
		],
	},
	{
		id: 'boost-or-cut-a-frequency-shelf',
		title: 'Boost or cut bass and treble with a shelf filter',
		description: 'Raise or lower a broad range of low or high frequencies while the far end stays level.',
		audacity: 'Effect → EQ and Filters → Shelf Filter',
		intro: 'A shelf filter changes a broad range at one end of the spectrum and levels off beyond its transition. Choose a high shelf to brighten or soften the top end, or a low shelf to add or reduce weight.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording whose bass or treble you want to adjust' }),
			selectAll(),
			effect({
				group: 'EQ and filters',
				name: 'Shelf filter',
				settings: [
					{ label: 'Filter type', option: 'High shelf' },
					{ label: 'Shelf frequency', value: '6000' },
					{ label: 'Gain', value: '2' },
				],
			}, { why: 'A small high-shelf boost adds some air above 6 kHz while leaving the lower range mostly alone.' }),
			play({ see: 'The top end is a little brighter while the lower frequencies remain steady.' }),
		],
		tips: [
			'Choose **Low shelf** and a lower frequency to adjust bass instead of treble.',
			'Large boosts can make a mix harsh or boomy. Try a small change and compare it with the original.',
		],
	},
	{
		id: 'choose-a-classic-filter',
		title: 'Choose a classic low-pass filter',
		description: 'Set a Butterworth cutoff and filter order for a predictable low-pass slope.',
		audacity: 'Effect → Legacy → Classic Filters (Audacity 3.6.2 and later)',
		intro: 'Classic Filters offers Butterworth and Chebyshev designs with an explicit filter order and cutoff. A Butterworth low-pass has a smooth passband, making it a straightforward choice when you want to reduce high-frequency noise.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording whose high frequencies you want to reduce' }),
			selectAll(),
			effect({
				group: 'Legacy effects',
				name: 'Classic Filters',
				settings: [
					{ label: 'Filter family', option: 'Butterworth' },
					{ label: 'Filter type', option: 'Low-pass' },
					{ label: 'Order', value: '4' },
					{ label: 'Cutoff frequency', value: '5000' },
				],
			}, { why: 'Butterworth keeps the passband flat; a fourth-order filter falls off more steeply than a first-order filter.' }),
			play({ see: 'High frequencies above the cutoff are reduced while the lower range stays in the passband.' }),
		],
		tips: [
			'Increase **Order** for a steeper transition; a high order can ring more around sharp transients.',
			'Classic Filters is in Audacity’s Legacy effects group in current manuals; enable it in Audacity’s Plugin Manager if it is not listed.',
		],
	},
]);
