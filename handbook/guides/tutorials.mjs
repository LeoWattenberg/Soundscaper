/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The Soundscaper tutorials: lessons a newcomer follows from start to finish
 * on an example recording the handbook provides, using the same step
 * vocabulary as the how-to guides. Where a guide describes the reader's own
 * material, a tutorial names the example — its file, the exact stretch to
 * select, what to expect at each step — because a safe, repeatable exercise is
 * what makes a lesson. `tests/browser/soundscaper-tutorials.spec.js` replays
 * every tutorial exactly as written.
 */

import { GUIDE_FIXTURES } from './fixtures.mjs';
import {
	check, cursor, effect, exportAudio, importAudio, menu, mixRender, noiseProfile, open, play, save, selectClips, selectRange, tool,
	validateTutorial,
} from './steps.mjs';

const selectAll = (extras) => menu(['Select', 'Select all'], extras);

const TUTORIALS = Object.freeze([
	{
		id: 'your-first-project',
		title: 'Your first Soundscaper project',
		description: 'Import a recording, listen, split it, fade it out, export a file and save the project.',
		intro: 'This tutorial walks through one complete pass of the editor on a two-second music loop: bringing a file in, hearing it, changing it with an effect, cutting it in two, rendering a file you can play anywhere, and saving the project so you can come back to it. Nothing here needs any audio knowledge; it is a tour of where things are.',
		learn: [
			'How a file becomes a clip on a track, and how to play it.',
			'How to split a clip with the split tool.',
			'How to select audio and apply an effect to the selection.',
			'The difference between exporting a file and saving a project.',
		],
		steps: [
			open(),
			importAudio('music-loop', { what: 'the example loop' }),
			play({ see: 'The playhead travels across the clip and the loop plays once.' }),
			tool('Split tool', { why: 'While the split tool is active, a click on a clip cuts it there instead of selecting.' }),
			cursor(0.5, { where: 'halfway along the clip' }),
			tool('Split tool', { why: 'Press it again to go back to the ordinary pointer.' }),
			check({ clips: 2 }, { see: 'Two clips sit end to end where there was one, each with its own name bar.' }),
			selectAll({ why: 'An effect applies to whatever is selected. Select all takes the whole project, both clips included.' }),
			effect({ group: 'Fading', name: 'Fade Out', direct: true }, { see: 'The waveform tapers to nothing by the end of the second clip.' }),
			play({ see: 'The loop dies away instead of stopping hard.' }),
			exportAudio({ format: 'WAV', extension: 'wav' }, { why: 'An export renders what you hear into a file for other programs. It does not change the project.' }),
			save({ why: 'The project — clips, edits, history — lives in the browser’s project library on this computer. Saving keeps it there.' }),
		],
		next: [
			'Try the same fade and split on a recording of your own: [Fade in and fade out](guide:fade-in-and-fade-out) and [Split a clip in two](guide:split-a-clip-at-the-cursor). The fade guide also shows how to fade just the start or the end.',
			'Then take your project somewhere else: [Move a project between computers](guide:move-a-project-between-computers).',
		],
	},
	{
		id: 'clean-up-a-voice-recording',
		title: 'Clean up a voice recording',
		description: 'Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.',
		intro: 'Most recordings made at home need the same three repairs: a steady background noise to remove, a low rumble to filter out, and a level that needs bringing up to a standard. This tutorial does all three on a three-second example take whose first half second is nothing but room noise, then exports the result as an MP3.',
		learn: [
			'Why Noise Reduction needs a profile, and how to give it one.',
			'What a high-pass filter removes and where to set it for speech.',
			'The difference between peak level and loudness, and how to hit a loudness target.',
			'How to export an MP3.',
		],
		steps: [
			open(),
			importAudio('noisy-take', { what: 'the example take' }),
			play({ see: 'Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.' }),
			selectRange(0, 0.15, { where: 'the noise-only lead-in', why: 'The profile must contain nothing but the noise you want gone — no voice at all.' }),
			noiseProfile(),
			selectAll({ why: 'The profile is kept; now the effect needs to know what to clean.' }),
			effect({
				group: 'Noise removal and repair',
				name: 'Noise Reduction',
				settings: [{ label: 'Noise reduction', value: '12' }],
			}, { why: 'Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow.', see: 'The lead-in is nearly flat and the tone is untouched.' }),
			effect({
				group: 'Legacy effects',
				name: 'Classic Filters',
				settings: [
					{ label: 'Filter type', option: 'High-pass' },
					{ label: 'Cutoff frequency', value: '100' },
				],
			}, { why: 'Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.' }),
			effect({
				group: 'Volume and compression',
				name: 'Loudness Normalization',
				settings: [{ label: 'Target loudness', value: '-16' }],
			}, { why: '−16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are.', see: 'The waveform is taller and the take plays at a comfortable level.' }),
			play({ see: 'A clean, level take with a quiet lead-in.' }),
			exportAudio({ format: 'MP3', extension: 'mp3' }, { why: 'The file is encoded in the browser; nothing leaves your computer.' }),
		],
		next: [
			'Do it on your own take with the how-to guides: [Remove background noise](guide:remove-background-noise), [Remove low rumble](guide:remove-low-rumble) and [Normalize loudness for a podcast](guide:normalize-loudness-for-podcasts).',
			'Check the result the way a platform would: [Measure how loud your mix is](guide:measure-loudness).',
		],
	},
	{
		id: 'put-music-under-a-voice',
		title: 'Put music under a voice',
		description: 'Layer two tracks, duck one under the other automatically, mix them down and export.',
		intro: 'A podcast intro, a video voice-over, a radio bed: the music has to drop whenever the voice speaks and come back in the gaps. This tutorial uses two example loops — one standing in for the voice, one for the music — to build that relationship with Auto Duck, then mixes the two tracks into one and exports it.',
		learn: [
			'How a second import lands on its own track.',
			'What a control track is and how Auto Duck uses it.',
			'How to mix several tracks down to one.',
		],
		steps: [
			open(),
			importAudio('music-loop', { what: 'the example music' }),
			importAudio('second-loop', { what: 'the example voice' }),
			play({ see: 'Both loops play together, each on its own track.' }),
			selectClips(['music-loop'], { which: ['the music clip'], why: 'The clip you select is the one that gets ducked — the music, not the voice.' }),
			effect({
				group: 'Volume and compression',
				name: 'Auto Duck',
				settings: [
					{ label: 'Control track', option: 'guide-second-loop', as: 'the voice track' },
					{ label: 'Duck amount', value: '-12' },
				],
			}, { why: 'Wherever the control track is louder than the threshold, the selected track is turned down by the duck amount, with fades at the edges.', see: 'The music waveform is smaller wherever the voice is playing.' }),
			play({ see: 'The music sits under the voice and recovers where the voice is quiet.' }),
			selectClips(['music-loop', 'second-loop'], { which: ['the music clip', 'the voice clip'], why: 'Every track with a selected clip goes into the mix.' }),
			mixRender({ why: 'Each track’s gain, pan and effects are baked into the mix; the originals are replaced by one new track.' }),
			check({ clip: 'Mix' }, { see: 'One track holds a clip named Mix; the two source tracks are gone. Edit → Undo would bring them back.' }),
			exportAudio({ format: 'MP3', extension: 'mp3' }),
		],
		next: [
			'The same job on your own material: [Duck music under a voice](guide:duck-music-under-a-voice) and [Mix several tracks into one](guide:mix-tracks-into-one).',
			'Keep the parts separate for someone else to mix: [Export each track as its own file](guide:export-each-track-as-its-own-file).',
		],
	},
]);

for (const tutorial of TUTORIALS) validateTutorial(tutorial, GUIDE_FIXTURES);

export const SOUNDSCAPER_TUTORIALS = TUTORIALS;
