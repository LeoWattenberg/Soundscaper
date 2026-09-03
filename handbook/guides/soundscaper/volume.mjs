/* SPDX-License-Identifier: AGPL-3.0-only */

import { effect, importAudio, menu, open, play, selectClips, selectRange } from '../steps.mjs';

const selectAll = (extras) => menu(['Select', 'Select all'], extras);

export const VOLUME_GUIDES = Object.freeze([
	{
		id: 'make-a-recording-louder',
		title: 'Make a quiet recording louder',
		description: 'Raise the level of a recording by a fixed number of decibels with Amplify.',
		audacity: 'Effect → Volume and Compression → Amplify',
		intro: 'A recording made with the gain too low is quiet but usually clean. Amplify raises everything by the same amount, in decibels, so the balance inside the recording stays exactly as it was. Leave clipping off and the effect refuses to push peaks past full scale.',
		steps: [
			open(),
			importAudio('quiet-take'),
			selectAll(),
			effect({
				group: 'Volume and compression',
				name: 'Amplify',
				settings: [{ label: 'Amplification', value: '6' }],
			}, { why: 'Six decibels roughly doubles the loudness. **Allow clipping** stays off, so the effect will not distort the peaks.' }),
			play({ see: 'The take is noticeably louder and the waveform is taller.' }),
		],
		tips: [
			'If the result is still too quiet, run Amplify again; the gains add up.',
			'To bring peaks to an exact level rather than add a fixed amount, use [Normalize](guide:normalize-peaks) instead.',
		],
	},
	{
		id: 'normalize-peaks',
		title: 'Normalize peaks to a set level',
		description: 'Bring the loudest point of a recording to an exact level below full scale.',
		audacity: 'Effect → Volume and Compression → Normalize',
		intro: 'Normalize measures the loudest peak in the selection and scales everything so that peak lands exactly where you ask. It is the usual last step before export: the file uses its full range without ever clipping. It also removes any DC offset, the slight vertical shift some sound cards add.',
		steps: [
			open(),
			importAudio('quiet-take'),
			selectAll(),
			effect({
				group: 'Volume and compression',
				name: 'Normalize',
				settings: [{ label: 'Peak amplitude', value: '-3' }],
			}, { why: 'Minus three decibels leaves a little headroom for the encoder if you export to MP3 later.' }),
			play({ see: 'The loudest moment now sits just under full scale.' }),
		],
		tips: [
			'Normalize looks at peaks, not at how loud the recording feels. Two normalized files can still sound very different; for that, see [Normalize loudness for a podcast](guide:normalize-loudness-for-podcasts).',
			'Stereo channels are normalized together unless you turn on **Normalize stereo channels independently**, which can shift the stereo image.',
		],
	},
	{
		id: 'normalize-loudness-for-podcasts',
		title: 'Normalize loudness for a podcast',
		description: 'Match the perceived loudness of an episode to the level streaming platforms expect.',
		audacity: 'Effect → Volume and Compression → Loudness Normalization',
		intro: 'Podcast and streaming platforms measure loudness in LUFS, which follows how loud a programme feels rather than how tall its peaks are. Loudness Normalization measures the whole selection and adjusts it to a target, so every episode you publish sits at the same level.',
		steps: [
			open(),
			importAudio('quiet-take'),
			selectAll(),
			effect({
				group: 'Volume and compression',
				name: 'Loudness Normalization',
				settings: [{ label: 'Target loudness', value: '-16' }],
			}, { why: '−16 LUFS is the common target for stereo podcasts; −19 LUFS is often used for mono. Check your platform’s guidelines.' }),
			play({ see: 'The take plays at a comfortable, consistent level.' }),
		],
		tips: [
			'Loudness Normalization can push peaks above full scale on very dynamic material. Follow it with a limiter or a peak Normalize to −1 dB if the waveform touches the top.',
			'Run it on the finished mix, after edits and other effects, so the measurement reflects what listeners will hear.',
		],
	},
	{
		id: 'even-out-volume-with-a-compressor',
		title: 'Even out volume with a compressor',
		description: 'Reduce the gap between loud and quiet moments so speech is easier to follow.',
		audacity: 'Effect → Volume and Compression → Compressor',
		intro: 'A compressor turns down the loud moments once they cross a threshold, then make-up gain lifts the whole result back up. The quiet words come forward and the shouts stop jumping out, which is why nearly every spoken-word production uses one.',
		steps: [
			open(),
			importAudio('music-loop'),
			selectAll(),
			effect({
				group: 'Volume and compression',
				name: 'Compressor (Audacity)',
				settings: [
					{ label: 'Threshold', value: '-18' },
					{ label: 'Ratio', value: '4' },
					{ label: 'Make-up gain', value: '3' },
				],
			}, { why: 'Everything above −18 dB is reduced at four to one: for every four decibels the input rises past the threshold, the output rises one. The make-up gain restores the level you lost.' }),
			play({ see: 'Loud and quiet passages are closer together in level.' }),
		],
		tips: [
			'A ratio of 2–4 sounds natural on speech. Ratios of 10 and above behave like a limiter.',
			'If you can hear the compressor pumping, lengthen the **Release** time.',
		],
	},
	{
		id: 'fade-in-and-fade-out',
		title: 'Fade in and fade out',
		description: 'Start a clip from silence and end it smoothly instead of cutting off.',
		audacity: 'Effect → Fading → Fade In and Fade Out',
		intro: 'A fade is the simplest way to avoid a click at the start of a clip or an abrupt stop at the end. Fade In ramps the selection up from silence over its whole length; Fade Out ramps it down. The length of the selection is the length of the fade.',
		steps: [
			open(),
			importAudio('music-loop'),
			selectRange(0, 0.25, { why: 'Select as much of the start as you want the fade to last.' }),
			effect({ group: 'Fading', name: 'Fade In', direct: true }),
			selectRange(0.75, 1, { why: 'Now select the same amount at the end.' }),
			effect({ group: 'Fading', name: 'Fade Out', direct: true }),
			play({ see: 'The loop swells in and dies away instead of starting and stopping hard.' }),
		],
		tips: [
			'The fades are linear. For a quicker fade at the very end, select a shorter range.',
			'Fades are edits, so **Edit → Undo** reverses them like anything else.',
		],
	},
	{
		id: 'tame-peaks-with-a-limiter',
		title: 'Tame peaks with a limiter',
		description: 'Stop the loudest moments from going over a ceiling without touching the rest.',
		audacity: 'Effect → Volume and Compression → Limiter',
		intro: 'A limiter is a compressor with a very high ratio: below the threshold it does nothing, and above it nothing gets through. It is the tool for catching a few stray peaks before export, or for raising the overall level of a mix without the peaks clipping.',
		steps: [
			open(),
			importAudio('music-loop'),
			selectAll(),
			effect({
				group: 'Volume and compression',
				name: 'Limiter (Audacity)',
				settings: [{ label: 'Threshold', value: '-6' }],
			}, { why: 'Nothing will exceed −6 dB. The make-up target then lifts the result so the ceiling sits near full scale.' }),
			play({ see: 'The loudest moments are held down; the rest is unchanged.' }),
		],
		tips: [
			'Use a limiter for peaks and a [compressor](guide:even-out-volume-with-a-compressor) for overall evenness; they are not the same job.',
			'Heavy limiting makes everything feel loud and flat. If you need more than a few decibels, the mix itself is probably too hot.',
		],
	},
	{
		id: 'duck-music-under-a-voice',
		title: 'Duck music under a voice',
		description: 'Turn a music bed down automatically whenever a voice track is speaking.',
		audacity: 'Effect → Volume and Compression → Auto Duck',
		intro: 'Podcasts and videos keep music running under speech by lowering it every time someone talks and bringing it back in the gaps. Auto Duck does this from a control track: wherever the control track is louder than a threshold, the selected track is turned down, with fades at the edges.',
		steps: [
			open(),
			importAudio('music-loop'),
			importAudio('second-loop'),
			selectClips(['music-loop'], { why: 'Select the clip to duck — the music, not the voice.' }),
			effect({
				group: 'Volume and compression',
				name: 'Auto Duck',
				settings: [
					{ label: 'Control track', option: 'guide-second-loop' },
					{ label: 'Duck amount', value: '-12' },
				],
			}, { why: 'The control track is the one that triggers the ducking. Twelve decibels down is enough for speech to sit clearly on top.' }),
			play({ see: 'The music drops while the other track plays and recovers where it is quiet.' }),
		],
		tips: [
			'Lengthen the **Outer fade** times if the music pumps up and down too quickly between words.',
			'Put the voice track above the music in the track list so the relationship is easy to see.',
		],
	},
]);
