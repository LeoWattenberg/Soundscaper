

export const EFFECT_MENU_GROUPS = Object.freeze([
	['volumeCompression', ['audacity-amplify', 'audacity-auto-duck', 'audacity-compressor', 'audacity-limiter', 'audacity-loudness-normalization', 'audacity-normalize', 'audacity-remove-dc-offset']],
	['fading', ['audacity-fade-in', 'audacity-fade-out']],
	['eqFilters', ['eq', 'audacity-bass-treble', 'audacity-filter-curve-eq', 'audacity-graphic-eq']],
	['noiseRepair', ['audacity-click-removal', 'audacity-noise-reduction', 'audacity-repair']],
	['delayReverb', ['audacity-echo', 'audacity-reverb']],
	['distortionModulation', ['audacity-distortion', 'audacity-phaser', 'audacity-wahwah']],
	['specialEffects', ['audacity-invert', 'audacity-repeat', 'audacity-reverse', 'audacity-truncate-silence']],
	['legacyEffects', ['audacity-legacy-compressor', 'audacity-classic-filters']],
]);

const MUSICAL_SNAP_ITEMS = Object.freeze([
	['bar', 'snapBar'], ['1/2', null], ['1/4', null], ['1/8', null], ['1/16', null], ['1/32', null], ['1/64', null], ['1/128', null],
]);
const TIME_SNAP_ITEMS = Object.freeze([
	['seconds', 'snapSeconds'], ['deciseconds', 'snapDeciseconds'], ['centiseconds', 'snapCentiseconds'],
	['milliseconds', 'snapMilliseconds'], ['samples', 'snapSamples'],
]);
const VIDEO_SNAP_ITEMS = Object.freeze([
	['video-24', 'snapFilm'], ['video-ntsc', 'snapNtsc'], ['video-ntsc-drop', 'snapNtscDrop'], ['video-pal', 'snapPal'],
]);

export function createSnapMenu(copy, project, editBlocked, setSnap) {
	const snap = project?.snap || {};
	const storedUnit = String(snap.division || snap.unit || 'seconds');
	const unit = ({ beats: '1/4', frames: 'video-24' }[storedUnit] || storedUnit).replace(/-triplet$/, '');
	const triplets = Boolean(snap.triplets || /-triplet$/.test(storedUnit));
	const item = ([id, copyKey]) => ({
		id: `snap-${id.replace(/[^a-z0-9]+/gi, '-')}`,
		label: copyKey ? copy[copyKey] : id,
		checked: unit === id,
		disabled: editBlocked,
		onClick: () => setSnap({ unit: id, division: id }),
	});
	const musical = MUSICAL_SNAP_ITEMS.some(([id]) => id === unit);
	return {
		id: 'snap',
		label: copy.snap,
		items: [
			{ id: 'snap-enabled', label: copy.snapEnabled, checked: Boolean(snap.enabled), disabled: editBlocked, onClick: () => setSnap({ enabled: !snap.enabled }) },
			{ id: 'snap-triplets', label: copy.snapTriplets, checked: triplets, disabled: editBlocked || !musical || unit === 'bar', onClick: () => setSnap({ triplets: !triplets }) },
			{ id: 'snap-musical', label: copy.snapMusical, items: MUSICAL_SNAP_ITEMS.map(item) },
			{ id: 'snap-time', label: copy.snapTime, items: TIME_SNAP_ITEMS.map(item) },
			{ id: 'snap-video', label: copy.snapVideo, items: VIDEO_SNAP_ITEMS.map(item) },
			{ id: 'snap-cd', label: copy.snapCd, items: [item(['cdda', 'snapCdda'])] },
		],
	};
}

export function trackSources(project, track) {
	if (!project || !track || track.type !== 'audio') return [];
	const clipById = new Map((project.clips || []).map((clip) => [clip.id, clip]));
	const sourceById = new Map((project.sources || []).map((source) => [source.id, source]));
	return [...new Map((track.clipIds || []).map((clipId) => {
		const source = sourceById.get(clipById.get(clipId)?.sourceId) || null;
		return [source?.id, source];
	}).filter(([, source]) => source)).values()];
}

export function audioEditorTrackBlockBounds(tracks, trackId) {
	const index = tracks.findIndex((track) => track.id === trackId);
	if (index < 0) return null;
	const laneGroupId = tracks[index].laneGroupId;
	if (!laneGroupId) return { start: index, end: index };
	const indexes = tracks
		.map((track, trackIndex) => track.laneGroupId === laneGroupId ? trackIndex : -1)
		.filter((trackIndex) => trackIndex >= 0);
	return {
		start: Math.min(...indexes),
		end: Math.max(...indexes),
	};
}

export function moveAudioEditorTrackBlock(controller, tracks, trackId, direction) {
	const bounds = audioEditorTrackBlockBounds(tracks, trackId);
	if (!bounds) return null;
	const destination = direction === 'top'
		? 0
		: direction === 'bottom'
			? tracks.length - 1
			: direction === 'up'
				? Math.max(0, bounds.start - 1)
				: direction === 'down'
					? Math.min(tracks.length - 1, bounds.end + 1)
					: bounds.start;
	return controller.actions.track.reorder(trackId, destination);
}

export function trackSourceChannelCount(project, track) {
	return trackSources(project, track).reduce((maximum, source) => Math.max(maximum, Number(source.channelCount) || 0), 0);
}

export function trackSourceRate(project, track, fallback) {
	const rates = new Set(trackSources(project, track).map((source) => Number(source.sampleRate)).filter(Number.isFinite));
	return rates.size === 1 ? [...rates][0] : fallback;
}
