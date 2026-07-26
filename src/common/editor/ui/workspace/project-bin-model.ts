
type ProjectBinCopy = Record<string, string | undefined>;

interface ProjectBinClip {
	binItemId?: string;
	durationFrames?: number;
	envelope?: readonly unknown[];
	fadeInFrames?: number;
	fadeOutFrames?: number;
	gain?: number;
	id: string;
	kind?: string;
	pitchCents?: number;
	preserveFormants?: boolean;
	renderCacheRevision?: number;
	reversed?: boolean;
	sourceDurationFrames?: number;
	sourceStartFrame?: number;
	speedRatio?: number;
	stretchToTempo?: boolean;
	trimEndFrames?: number;
	trimStartFrames?: number;
}

interface ProjectBinSource {
	channelCount?: number;
	frameCount?: number;
	height?: number;
	kind?: string;
	mimeType?: string;
	width?: number;
}

interface ProjectBinPeakChannel {
	maximums: ArrayLike<number>;
	minimums: ArrayLike<number>;
}

interface ProjectBinPeakLevel {
	blockSize?: number;
	channels?: readonly ProjectBinPeakChannel[];
}

interface AudioBufferLike {
	length: number;
	numberOfChannels: number;
	getChannelData(channel: number): ArrayLike<number>;
}

interface ProjectBinVisual {
	buffer?: AudioBufferLike;
	peaks?: { levels?: readonly ProjectBinPeakLevel[] };
}

export interface ProjectBinItem {
	clips: readonly ProjectBinClip[];
	id: string;
	primaryClip: ProjectBinClip;
}

export interface ProjectBinRange {
	maximum: number;
	minimum: number;
}

export function projectBinItems(clips: readonly ProjectBinClip[] = []): ProjectBinItem[] {
	const grouped = new Map<string, ProjectBinClip[]>();
	for (const clip of clips) {
		const id = clip.binItemId || clip.id;
		const item = grouped.get(id) || [];
		item.push(clip);
		grouped.set(id, item);
	}
	return [...grouped].map(([id, itemClips]) => Object.freeze({
		id,
		clips: Object.freeze(itemClips),
		primaryClip: itemClips.find((clip) => clip.kind === 'video') || itemClips[0],
	}));
}

export function projectBinColorName(copy: ProjectBinCopy, color: string): string {
	const key = `color${color.charAt(0).toUpperCase()}${color.slice(1)}`;
	return copy[key] || color;
}

export function projectBinTransformBadges(
	clip: ProjectBinClip,
	source: ProjectBinSource | null | undefined,
	copy: ProjectBinCopy,
): string[] {
	const badges: string[] = [];
	const sourceEnd = (clip.sourceStartFrame || 0) + (clip.sourceDurationFrames || clip.durationFrames || 0);
	if ((clip.trimStartFrames || 0) > 0
		|| (clip.trimEndFrames || 0) > 0
		|| (clip.sourceStartFrame || 0) > 0
		|| (source?.frameCount && sourceEnd < source.frameCount)) badges.push(copy.projectBinTransformTrim || 'trim');
	if (Math.abs((clip.gain ?? 1) - 1) > 1e-9) badges.push(copy.projectBinTransformGain || 'gain');
	if ((clip.fadeInFrames || 0) > 0 || (clip.fadeOutFrames || 0) > 0) badges.push(copy.projectBinTransformFade || 'fade');
	if (clip.envelope?.length) badges.push(copy.projectBinTransformEnvelope || 'envelope');
	if (clip.reversed) badges.push(copy.projectBinTransformReverse || 'reverse');
	if (Math.abs(clip.pitchCents || 0) > 1e-9) badges.push(copy.projectBinTransformPitch || 'pitch');
	if (Math.abs((clip.speedRatio ?? 1) - 1) > 1e-9 || clip.stretchToTempo) {
		badges.push(copy.projectBinTransformSpeed || 'speed');
	}
	if (clip.preserveFormants) badges.push(copy.projectBinTransformFormants || 'formants');
	if ((clip.renderCacheRevision || 0) > 0) badges.push(copy.projectBinTransformRendered || 'rendered');
	return badges;
}

export function formatProjectBinDuration(durationFrames: number, sampleRate: number, locale: string): string {
	const seconds = Math.max(0, Number(durationFrames) || 0) / Math.max(1, Number(sampleRate) || 48_000);
	const wholeMinutes = Math.floor(seconds / 60);
	const remaining = seconds - wholeMinutes * 60;
	const number = new Intl.NumberFormat(locale, {
		minimumIntegerDigits: 2,
		minimumFractionDigits: remaining < 10 ? 1 : 0,
		maximumFractionDigits: 1,
	}).format(remaining);
	return `${wholeMinutes}:${number}`;
}

export function formatProjectBinSource(source: ProjectBinSource | null | undefined, copy: ProjectBinCopy): string {
	if (!source) return copy.projectBinUnknownFormat || '';
	const mimeSubtype = String(source.mimeType || '')
		.replace(/^(?:audio|video)\//i, '')
		.replace(/^x-/i, '')
		.replace('mpeg', 'mp3');
	const format = mimeSubtype ? mimeSubtype.toUpperCase() : copy.projectBinUnknownFormat || '';
	if (source.kind === 'video') {
		const resolution = source.width && source.height ? `${source.width}×${source.height}` : copy.videoResolution || '';
		return `${format} · ${resolution}`;
	}
	const channels = Number(source.channelCount) === 1
		? copy.projectBinMono || ''
		: (copy.projectBinChannels || '').replace('{count}', String(source.channelCount || 0));
	return `${format} · ${channels}`;
}

export function projectBinWaveformPath(
	visual: ProjectBinVisual | null | undefined,
	clip: ProjectBinClip,
	width = 160,
	height = 44,
): string {
	if (!visual) return '';
	const ranges = projectBinPeakRanges(visual, clip, width);
	if (!ranges.length) return '';
	const middle = height / 2;
	const amplitude = Math.max(1, middle - 3);
	return ranges.map(({ minimum, maximum }, index) => {
		const x = ranges.length === 1 ? width / 2 : index * width / (ranges.length - 1);
		const top = middle - Math.max(-1, Math.min(1, maximum)) * amplitude;
		const bottom = middle - Math.max(-1, Math.min(1, minimum)) * amplitude;
		return `M${x.toFixed(2)} ${top.toFixed(2)}V${bottom.toFixed(2)}`;
	}).join('');
}

export function projectBinPeakRanges(
	visual: ProjectBinVisual,
	clip: ProjectBinClip,
	maximumColumns: number,
): ProjectBinRange[] {
	const sourceStartFrame = Math.max(0, Number(clip.sourceStartFrame) || 0);
	const sourceDurationFrames = Math.max(1, Number(clip.sourceDurationFrames || clip.durationFrames) || 1);
	const levels = visual.peaks?.levels || [];
	let level = levels[levels.length - 1] || null;
	for (const candidate of levels) {
		const count = Math.ceil(sourceDurationFrames / Math.max(1, Number(candidate.blockSize) || 1));
		if (count <= maximumColumns) {
			level = candidate;
			break;
		}
	}
	const peakChannels = level?.channels || [];
	const peakLength = peakChannels[0]?.minimums?.length || 0;
	if (peakLength && peakChannels.every((channel) => (
		channel.minimums?.length === peakLength && channel.maximums?.length === peakLength
	))) {
		const blockSize = Math.max(1, Number(level.blockSize) || 1);
		const start = Math.max(0, Math.floor(sourceStartFrame / blockSize));
		const end = Math.min(
			peakLength,
			Math.max(start + 1, Math.ceil((sourceStartFrame + sourceDurationFrames) / blockSize)),
		);
		const minimums = new Float32Array(peakLength).fill(1);
		const maximums = new Float32Array(peakLength).fill(-1);
		for (const channel of peakChannels) {
			for (let block = 0; block < peakLength; block += 1) {
				minimums[block] = Math.min(minimums[block], channel.minimums[block]);
				maximums[block] = Math.max(maximums[block], channel.maximums[block]);
			}
		}
		return aggregateProjectBinRanges(minimums, maximums, start, end, maximumColumns);
	}
	const buffer = visual.buffer;
	if (!buffer?.numberOfChannels || !buffer.length || typeof buffer.getChannelData !== 'function') return [];
	const end = Math.min(buffer.length, sourceStartFrame + sourceDurationFrames);
	const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel: number) => buffer.getChannelData(channel));
	const columns = Math.max(1, Math.min(maximumColumns, end - sourceStartFrame));
	const ranges: ProjectBinRange[] = [];
	for (let column = 0; column < columns; column += 1) {
		const startFrame = Math.floor(sourceStartFrame + column * (end - sourceStartFrame) / columns);
		const endFrame = Math.max(startFrame + 1, Math.ceil(sourceStartFrame + (column + 1) * (end - sourceStartFrame) / columns));
		let minimum = 1;
		let maximum = -1;
		const stride = Math.max(1, Math.floor((endFrame - startFrame) / 32));
		for (let frame = startFrame; frame < endFrame; frame += stride) {
			let sample = 0;
			for (const channel of channels) sample += (Number(channel[frame]) || 0) / channels.length;
			minimum = Math.min(minimum, sample);
			maximum = Math.max(maximum, sample);
		}
		ranges.push({ minimum, maximum });
	}
	return ranges;
}

export function aggregateProjectBinRanges(
	minimums: ArrayLike<number>,
	maximums: ArrayLike<number>,
	start: number,
	end: number,
	maximumColumns: number,
): ProjectBinRange[] {
	const columns = Math.max(1, Math.min(maximumColumns, end - start));
	const ranges: ProjectBinRange[] = [];
	for (let column = 0; column < columns; column += 1) {
		const rangeStart = Math.floor(start + column * (end - start) / columns);
		const rangeEnd = Math.max(rangeStart + 1, Math.ceil(start + (column + 1) * (end - start) / columns));
		let minimum = 1;
		let maximum = -1;
		for (let index = rangeStart; index < rangeEnd; index += 1) {
			minimum = Math.min(minimum, Number(minimums[index]) || 0);
			maximum = Math.max(maximum, Number(maximums[index]) || 0);
		}
		ranges.push({ minimum, maximum });
	}
	return ranges;
}
