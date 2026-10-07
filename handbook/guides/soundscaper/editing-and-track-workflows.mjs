/* SPDX-License-Identifier: AGPL-3.0-only */

import { check, cursor, dragClip, importAudio, menu, open, selectClips, selectRange, trackMenu } from '../steps.mjs';

export const EDITING_WORKFLOW_GUIDES = Object.freeze([
	{
		id: 'lift-a-passage-to-a-new-track',
		title: 'Lift a passage onto its own track',
		description: 'Move a selected passage to a new track while keeping the surrounding audio in place.',
		audacity: 'Edit → Clip → Split New',
		intro: 'A phrase or take may need its own level, pan, or effects while the rest of the recording stays intact. Split into new track cuts at the selection edges and moves only the selected passage to a new track at the same timeline position.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording with the passage you want to lift' }),
			selectRange(0.25, 0.75, { where: 'the passage you want to move onto its own track' }),
			menu(['Edit', 'Audio clips', 'Split into new track'], { why: 'The selection moves to a new track while the audio before and after it stays on the original track.' }),
			check({ clips: 3 }, { see: 'The original track has a clip on either side of the selection, and a new track holds the passage between them.' }),
		],
		tips: [
			'The selected passage keeps its original timeline position on the new track.',
			'Use a track that contains only this recording when you want to move the lifted passage without affecting other material on its track.',
		],
	},
	{
		id: 'split-clips-at-silent-pauses',
		title: 'Split a take into clips at silent pauses',
		description: 'Separate phrases at silent pauses without shifting them along the timeline.',
		audacity: 'Edit → Audio Clips → Detach at Silences (Audacity 3)',
		intro: 'Long pauses can make a spoken take easier to edit when each phrase is its own clip. Split clips at silences removes the silent runs and leaves the separated phrases in place, so their timing on the timeline does not change.',
		steps: [
			open(),
			importAudio('gapped-take', { what: 'the take with pauses between its phrases' }),
			menu(['Edit', 'Audio clips', 'Split clips at silences'], { why: 'Each detected silent run is removed from the clip and the phrases on either side become separate clips.' }),
			check({ clips: 4 }, { that: 'The phrases are now separate clips at their original times.', see: 'Each phrase keeps its place in the recording.' }),
		],
		tips: [
			'This command separates a clip at silence; it does not shorten the gaps between the phrases.',
			'For pauses you want to keep but shorten, use [Remove silent pauses](guide:remove-silent-pauses) instead.',
		],
	},
	{
		id: 'ungroup-linked-clips',
		title: 'Ungroup clips without joining them',
		description: 'Separate grouped clips again while keeping their clip boundaries.',
		audacity: 'Edit → Clip → Ungroup Clips',
		intro: 'Grouped clips can be selected and moved as a unit while remaining separate pieces of audio. Ungroup restores independent clip selection; it does not join the pieces or render them into one clip.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording with clips you want to separate' }),
			cursor(0.5, { where: 'where you want to divide the clip into two pieces' }),
			menu(['Edit', 'Audio clips', 'Split']),
			selectClips(['music-loop', 'music-loop'], { which: ['the first piece', 'the second piece'] }),
			menu(['Edit', 'Audio clips', 'Group clips'], { why: 'Grouping lets the two selected pieces move together without joining their audio.' }),
			menu(['Edit', 'Audio clips', 'Ungroup clips'], { why: 'Ungroup restores the two pieces as separately selectable clips.' }),
			check({ clips: 2 }, { see: 'The recording is still two separate clips that meet at the split point.' }),
		],
		tips: [
			'Grouping is useful when separate clips need to keep their relative timing during a move.',
			'Choose **Edit → Audio clips → Join selected clips** when you want adjacent pieces to become one clip.',
		],
	},
	{
		id: 'align-a-track-to-the-playhead',
		title: 'Align a track start to the playhead',
		description: 'Place a recording’s start at the current cursor position with an alignment command.',
		audacity: 'Tracks → Align Tracks → Align Start to Playhead',
		intro: 'When a recording needs to begin at a particular cue, dragging it by eye can be imprecise. Align start to playhead moves the selected track’s content so its start meets the cursor, while preserving the recording’s length.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording you want to place at a cue' }),
			dragClip(1, { where: 'to a later point on the timeline', why: 'Move the clip first so the cursor can mark a different start position.' }),
			cursor(0.5, { where: 'the cue where the recording should start' }),
			menu(['Tracks', 'Align content', 'Align start to playhead'], { why: 'The selected track’s earliest clip is moved to the cursor position.' }),
			check({ startsAt: { fixture: 'music-loop', seconds: 2 } }, { that: 'The recording now starts at the playhead.', see: 'The clip begins at the cue and keeps its original length.' }),
		],
		tips: [
			'Alignment moves every clip on each selected track. Use a track that contains only the recording you want to move.',
			'Use **Tracks → Align content → Align start to zero** to return a selected track to the project start.',
		],
	},
]);

export const TRACK_WORKFLOW_GUIDES = Object.freeze([
	{
		id: 'sort-tracks-by-name',
		title: 'Sort tracks by name',
		description: 'Reorder tracks alphabetically when a project has several recordings.',
		audacity: 'Tracks → Sort Tracks → Sort by Name',
		intro: 'A project with several takes is easier to navigate when related track names sit together. Sort by name reorders tracks alphabetically without changing where any clips start on the timeline.',
		steps: [
			open(),
			importAudio('second-loop', { what: 'the recording you want to place after the other by name' }),
			importAudio('music-loop', { what: 'the recording you want to place before it by name' }),
			menu(['Tracks', 'Sort tracks', 'Sort by name'], { why: 'The track names are sorted alphabetically.' }),
			check({ clips: 2 }, { see: 'Both recordings remain in the project, with track names in alphabetical order.' }),
		],
		tips: [
			'Sorting changes track order, not clip timing or audio content.',
			'Use **Tracks → Sort tracks → Sort by time** when you want the track order to follow clip start times.',
		],
	},
	{
		id: 'move-a-track-to-the-top',
		title: 'Move a track to the top',
		description: 'Reorder one track without moving its clips in time.',
		audacity: 'Track menu → Move track → Move track to top',
		intro: 'Moving a track up or down changes its vertical position in the project, not the start times of its clips. Move track to top is useful for bringing a voice or other important part into view above the rest.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording that should stay below' }),
			importAudio('second-loop', { what: 'the recording you want at the top' }),
			trackMenu(['Move track', 'Move track to top'], { fixture: 'second-loop', which: 'the track you want to bring to the top', why: 'The command changes this track’s vertical order while preserving its clip timing.' }),
			check({ clips: 2 }, { see: 'The selected track is above the other one, and both clips keep their timeline positions.' }),
		],
		tips: [
			'Use **Move track → Move track down** from the track menu to reverse the order.',
			'Track order changes which audio appears above another in the project; it does not change the mix or panning.',
		],
	},
	{
		id: 'view-a-track-as-a-spectrogram',
		title: 'View a track as a spectrogram',
		description: 'Switch a track from its waveform to a frequency view.',
		audacity: 'Track menu → Track Visualization → Spectrogram',
		intro: 'A waveform shows changes in amplitude, while a spectrogram shows how frequencies change over time. Switch one track to spectrogram view to inspect a tone, noise, or other frequency detail without changing its audio.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording whose frequencies you want to inspect' }),
			trackMenu(['Track visualization', 'Spectrogram'], { fixture: 'music-loop', which: 'the recording you want to inspect', why: 'The track changes to a frequency display; its audio and clip timing are unchanged.' }),
			check({ clips: 1 }, { see: 'The track shows a spectrogram while the clip remains on the same timeline.' }),
		],
		tips: [
			'Choose **Track visualization → Waveform** from the same track menu to return to the amplitude view.',
			'Spectrogram settings are available from the track menu when you need to adjust its frequency range or scale.',
		],
	},
]);
