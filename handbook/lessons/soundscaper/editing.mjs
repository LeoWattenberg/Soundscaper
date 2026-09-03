/* SPDX-License-Identifier: AGPL-3.0-only */

import { check, cursor, effect, generate, importAudio, marker, menu, open, play, selectClips, selectRange, tool } from '../steps.mjs';

const selectAll = (extras) => menu(['Select', 'Select all'], extras);

export const EDITING_LESSONS = Object.freeze([
	{
		id: 'cut-out-a-mistake',
		title: 'Cut a mistake out of a recording',
		description: 'Select a slip, remove it, and close the gap so the recording flows on.',
		audacity: 'Select the region, then Edit → Delete (or Ctrl+K)',
		intro: 'The most common edit there is: a false start, a cough, a retake. Select the part you do not want, remove it, and let the rest of the track slide left to close the gap.',
		steps: [
			open(),
			importAudio('music-loop'),
			selectRange(0.4, 0.6, { why: 'Select exactly the part you want gone. Zoom in with **View → Zoom → Zoom in** if the mistake is short.' }),
			menu(['Edit', 'Cut', 'Cut and close gap per track'], { why: 'The selection is removed and everything after it moves left, so no silence is left behind.' }),
			check({ clips: 2 }, { see: 'Two clips sit end to end where the selection was, and the track is shorter by exactly that much. Play across the join to check it.' }),
		],
		tips: [
			'**Cut and leave gap** removes the sound but keeps the time, which is right when the track has to stay in sync with a video or another track.',
			'Not happy with the join? **Edit → Undo**, adjust the selection and try again.',
		],
	},
	{
		id: 'split-a-clip-at-the-cursor',
		title: 'Split a clip in two',
		description: 'Cut a clip at a point so each part can be moved or treated separately.',
		audacity: 'Edit → Clip Boundaries → Split (Ctrl+I)',
		intro: 'A split does not remove anything. It turns one clip into two that sit end to end, so you can drag one part elsewhere, delete it, or apply an effect to it alone. The quickest way is the split tool: while it is active, every click on a clip cuts it at that point.',
		steps: [
			open(),
			importAudio('music-loop'),
			tool('Split tool', { why: 'The pointer now cuts instead of selecting. Press **S** to toggle the tool from the keyboard.' }),
			cursor(0.5, { why: 'With the split tool active, the click cuts the clip here.' }),
			check({ clips: 2 }, { see: 'Two clips now sit where there was one.' }),
			tool('Split tool', { why: 'Press it again to return to the normal pointer.' }),
		],
		tips: [
			'To split at the playhead instead, select the clip and choose **Edit → Audio clips → Split**; with a time range selected, it splits at both ends of the range.',
			'Select both halves and choose **Edit → Audio clips → Join selected clips** to make them one clip again.',
		],
	},
	{
		id: 'keep-only-a-selection',
		title: 'Keep only the part you want',
		description: 'Trim away everything outside a selection in one step.',
		audacity: 'Edit → Remove Special → Trim Audio',
		intro: 'When a long recording contains one good take, it is quicker to select the take and throw away the rest than to delete the surroundings in pieces. Trim keeps the selection and removes the audio on both sides of it.',
		steps: [
			open(),
			importAudio('music-loop'),
			selectRange(0.25, 0.75, { why: 'Select the passage you want to keep.' }),
			menu(['Edit', 'Remove special', 'Trim audio outside selection']),
			check({ clips: 1 }, { see: 'Only the selected passage remains on the track.' }),
		],
		tips: [
			'The trimmed clip stays where it was on the timeline. Drag it to the start if you want it to begin at zero.',
			'Trim is an edit like any other; **Edit → Undo** restores what was outside the selection.',
		],
	},
	{
		id: 'repeat-a-section',
		title: 'Repeat a section',
		description: 'Loop a selection a set number of times to make it longer.',
		audacity: 'Effect → Special → Repeat',
		intro: 'A two-bar loop, a background bed that needs to run under a longer voice-over, a sound effect that should go on: Repeat copies the selection straight after itself as many times as you ask.',
		steps: [
			open(),
			importAudio('music-loop'),
			selectAll(),
			effect({
				group: 'Special',
				name: 'Repeat',
				settings: [{ label: 'Number of repeats', value: '2' }],
			}, { why: 'Two repeats give three copies in a row.' }),
			play({ see: 'The loop plays three times without a gap.' }),
		],
		tips: [
			'For a seamless loop, make sure the selection starts and ends on silence or at a zero crossing (**Select → At zero crossings**).',
			'The effect changes the length of the clip, so anything after it on the same track is pushed along.',
		],
	},
	{
		id: 'reverse-audio',
		title: 'Play a recording backwards',
		description: 'Reverse a selection so it plays from end to start.',
		audacity: 'Effect → Special → Reverse',
		intro: 'Reverse flips the selection in time. It is an effect for sound design — reversed cymbals, swelling pre-echoes — and occasionally for checking whether a room’s reverb tail hides anything.',
		steps: [
			open(),
			importAudio('music-loop'),
			selectAll(),
			effect({ group: 'Special', name: 'Reverse', direct: true }),
			play({ see: 'The loop plays backwards.' }),
		],
		tips: [
			'Apply Reverse twice and you are back where you started, sample for sample.',
			'Reverse a short selection at the start of a clip to build a swell that leads into it.',
		],
	},
	{
		id: 'add-markers',
		title: 'Mark places in a recording',
		description: 'Drop named markers on the timeline so you can find points again later.',
		audacity: 'Edit → Labels → Add Label at Selection (Ctrl+B)',
		intro: 'Markers are notes on the timeline: where a chapter starts, where a mistake needs fixing, where the good take begins. They do not change the audio, they travel with the project, and they can be exported as a label file for other tools.',
		steps: [
			open(),
			importAudio('music-loop'),
			menu(['View', 'Show markers'], { why: 'This adds a marker lane above the tracks. Markers exist without it, but the lane is where you see and edit them.' }),
			cursor(0.5, { why: 'The marker goes where the cursor is.' }),
			marker('Chorus', { see: 'The marker shows in the lane above the tracks and in the panel’s list, with the name you typed.' }),
		],
		tips: [
			'With a time range selected, the same button adds a named region instead of a single point.',
			'**File → Export other → Export labels** writes the markers as a text file that Audacity and other editors can read.',
		],
	},
	{
		id: 'copy-and-paste-a-section',
		title: 'Copy and paste a section',
		description: 'Copy a passage and paste it in somewhere else on the track.',
		audacity: 'Edit → Copy, then Edit → Paste (Ctrl+C, Ctrl+V)',
		intro: 'Copying a good chorus to replace a weak one, repeating a bar, moving a sentence to the end: copy and paste work on audio the way they do on text. Select a passage, copy it, put the cursor where it should go, and paste.',
		steps: [
			open(),
			importAudio('music-loop'),
			selectRange(0.25, 0.5, { why: 'Select the passage to copy.' }),
			menu(['Edit', 'Copy']),
			cursor(1, { why: 'The paste lands at the cursor, so put it at the end of the clip.' }),
			menu(['Edit', 'Paste', 'Paste']),
			check({ clips: 2 }, { see: 'The copied passage is a new clip after the original.' }),
		],
		tips: [
			'**Edit → Paste → Insert** pushes later audio along instead of laying the paste over it.',
			'The clipboard works across project tabs, so a passage can be copied from one project into another.',
		],
	},
	{
		id: 'duplicate-a-selection-to-a-new-track',
		title: 'Duplicate a selection to a new track',
		description: 'Copy a passage onto its own track so you can process it separately.',
		audacity: 'Edit → Duplicate (Ctrl+D)',
		intro: 'Duplicate copies the selection onto a new track directly below, at the same position in time. It is the usual first step for parallel processing — a heavily compressed copy mixed under the original, a reverb-only track, a doubled vocal.',
		steps: [
			open(),
			importAudio('music-loop'),
			selectRange(0.25, 0.75, { why: 'Select the passage to duplicate.' }),
			menu(['Edit', 'Duplicate']),
			check({ clips: 2 }, { see: 'A second clip holding just the selection, on a new track under the first, lined up in time.' }),
		],
		tips: [
			'Mute one of the two tracks to hear the other on its own while you shape it.',
			'When you are happy with the blend, [mix the tracks down](/lessons/mix-tracks-into-one/).',
		],
	},
	{
		id: 'add-silence-after-a-clip',
		title: 'Add silence after a clip',
		description: 'Generate a gap of exact length at the cursor.',
		audacity: 'Generate → Silence',
		intro: 'Effects like echo and reverb need room to ring out, and a podcast needs a breath between segments. The Silence generator inserts a gap of exactly the length you type at the cursor, which is more precise than dragging clips apart by eye.',
		steps: [
			open(),
			importAudio('music-loop'),
			cursor(1, { why: 'The silence goes in at the cursor, so put it at the end of the clip.' }),
			generate({
				name: 'Silence',
				fields: [{ field: 'durationSeconds', label: 'Duration (seconds)', value: '1' }],
			}),
			check({ clips: 2 }, { see: 'A one-second silent clip follows the loop.' }),
		],
		tips: [
			'With a time range selected, the generator replaces the selection instead of inserting at the cursor.',
			'To silence audio that is already there rather than add time, see [Silence part of a recording](/lessons/silence-part-of-a-recording/).',
		],
	},
	{
		id: 'line-up-clips-end-to-end',
		title: 'Line up clips end to end',
		description: 'Butt two clips on different tracks against each other so one follows the other.',
		audacity: 'Tracks → Align Tracks → Align End to End',
		intro: 'Two takes recorded separately land on their own tracks, both starting at zero. To play one after the other, the second has to move to where the first ends. Align end to end does that arithmetic for every selected clip in track order.',
		steps: [
			open(),
			importAudio('music-loop'),
			importAudio('second-loop'),
			selectClips(['music-loop', 'second-loop']),
			menu(['Tracks', 'Align content', 'Align end to end']),
			check({ startsAt: { fixture: 'second-loop', seconds: 2 } }, { see: 'The second clip now starts where the first one ends.' }),
		],
		tips: [
			'**Align together** does the opposite: it moves the selected clips to start at the same time.',
			'Drag a clip by its name bar to place it by hand; hold Shift to keep it on the same track.',
		],
	},
	{
		id: 'zoom-in-for-precise-edits',
		title: 'Zoom in for precise edits',
		description: 'Get close enough to the waveform to cut on a beat or between words.',
		audacity: 'View → Zoom (Ctrl+1, Ctrl+2, Ctrl+3)',
		intro: 'At the default zoom a whole song fits on the screen and a single word is a few pixels wide. Zooming in lets you place the cursor exactly on a beat or in the gap between two words; zoom to selection frames just the passage you are working on.',
		steps: [
			open(),
			importAudio('music-loop'),
			menu(['View', 'Zoom', 'Zoom in'], { why: 'Each step doubles the width of a second. Ctrl+1 does the same.' }),
			menu(['View', 'Zoom', 'Zoom in']),
			selectRange(0.4, 0.6, { why: 'Select the passage you want to work on.' }),
			menu(['View', 'Zoom', 'Zoom to selection'], { why: 'The selection now fills the timeline.' }),
			menu(['View', 'Zoom', 'Zoom normal'], { why: 'Ctrl+2 brings the default zoom back.' }),
		],
		tips: [
			'Ctrl and the mouse wheel zoom around the pointer, which is the quickest way to dive into one spot.',
			'Zooming changes nothing in the project; it is only your view.',
		],
	},
]);
