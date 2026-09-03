/* SPDX-License-Identifier: AGPL-3.0-only */

import { analyze, check, importAudio, menu, nyquist, open } from '../steps.mjs';

const selectAll = (extras) => menu(['Select', 'Select all'], extras);

export const ANALYSIS_LESSONS = Object.freeze([
	{
		id: 'measure-loudness',
		title: 'Measure how loud your mix is',
		description: 'Read the integrated loudness, range and true peak of the project the way broadcasters do.',
		audacity: 'Analyze → Measure RMS, or Loudness Normalization’s measurement',
		intro: 'Before you normalize or export, it helps to know where you are. The EBU R 128 analyzer measures the programme the way streaming platforms and broadcasters do — integrated loudness in LUFS, loudness range, and true peak — so you can compare against a target instead of guessing from the meter.',
		steps: [
			open(),
			importAudio('music-loop'),
			selectAll(),
			analyze({ name: 'EBU R 128', panel: 'ebu-r128' }, { see: 'Integrated loudness, loudness range and true peak for the selection.' }),
		],
		tips: [
			'Podcast platforms commonly ask for −16 LUFS stereo or −19 LUFS mono with true peaks below −1 dBTP; check the platform’s own guidance.',
			'If the numbers are far from the target, run [Loudness Normalization](/lessons/normalize-loudness-for-podcasts/) and measure again.',
		],
	},
	{
		id: 'plot-a-spectrum',
		title: 'See which frequencies a sound contains',
		description: 'Plot the spectrum of a selection to find hum, hiss or resonances.',
		audacity: 'Analyze → Plot Spectrum',
		intro: 'A waveform shows how loud a sound is over time; a spectrum shows which frequencies it is made of. Plotting the spectrum of a problem passage is the fastest way to find a 50 or 60 Hz hum, a whistle from a monitor, or the frequency a room is ringing at — and then to know where to point an equalizer.',
		steps: [
			open(),
			importAudio('noisy-take'),
			selectAll(),
			analyze({ name: 'Plot spectrum', panel: 'spectrum' }, { see: 'A graph of level against frequency for the selection.' }),
		],
		tips: [
			'Select only the problem passage — a stretch of hum on its own, say — so the spectrum is not dominated by the music or speech around it.',
			'A tall narrow spike is a tone; a broad plateau is noise. Tones respond to a narrow EQ cut, noise to [Noise Reduction](/lessons/remove-background-noise/).',
		],
	},
	{
		id: 'find-clipping',
		title: 'Find where a recording clipped',
		description: 'Locate the places where a recording hit full scale and distorted.',
		audacity: 'Analyze → Find Clipping',
		intro: 'A recording made too hot flattens against the top of the range and distorts. The damage is easy to hear but hard to find by eye in a long take. Find Clipping scans the selection and lists every run of samples that sits at full scale, so you can decide whether to repair, redo or live with each one.',
		steps: [
			open(),
			importAudio('clicky-take'),
			selectAll(),
			analyze({ name: 'Find clipping', panel: 'clipping' }, { see: 'A list of the clipped runs, or a note that none were found.' }),
		],
		tips: [
			'Turning a clipped recording down does not repair it; the flattened peaks stay flattened. **Effect → Noise removal and repair → Repair** can rebuild a very short clipped run.',
			'To avoid clipping next time, record with peaks around −12 dB and raise the level afterwards.',
		],
	},
	{
		id: 'find-the-beats',
		title: 'Find the beats in a loop',
		description: 'Let the Beat Finder analyzer mark every beat it hears.',
		audacity: 'Analyze → Beat Finder',
		intro: 'Beat Finder is one of the bundled Nyquist analyzers. It listens for sudden rises in level above a threshold and writes a label at each one, which is a quick way to mark the beats of a loop or the hits in a drum take before you cut it up.',
		steps: [
			open(),
			importAudio('gapped-take'),
			selectAll(),
			nyquist({
				menu: 'Analyze',
				name: 'Beat Finder',
				fields: [{ label: 'Threshold Percentage', value: '60' }],
			}, { why: 'A lower percentage finds quieter beats as well; raise it if it marks too much.' }),
			check({ track: 'Beat Finder' }, { see: 'A new label track named Beat Finder under the audio, with one label at each beat.' }),
		],
		tips: [
			'The labels land on a new label track under the audio. Rename or delete any the analyzer got wrong.',
			'**Analyze → Nyquist → Label Sounds** does a similar job for whole sounds separated by silence.',
		],
	},
]);
