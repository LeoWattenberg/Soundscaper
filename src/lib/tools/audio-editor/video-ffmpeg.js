import { getVideoExportFormat } from './video-export.js';

const DEFAULT_VIDEO_ENCODING_SETTINGS = Object.freeze({
	mp4: Object.freeze({
		crf: 23,
		preset: 'medium',
		audioBitRateKbps: 192,
	}),
	webm: Object.freeze({
		crf: 31,
		deadline: 'good',
		cpuUsed: 4,
		audioBitRateKbps: 160,
	}),
});

/**
 * Build a deterministic FFmpeg command for a video export plan. Input paths
 * are supplied separately from the plan because the browser adapter assigns
 * fresh WORKERFS mount points for every queued job.
 */
export function buildVideoFfmpegArgs(plan, stagedInputs, output, options = {}) {
	const normalized = normalizeVideoExportPlan(plan);
	const outputPath = nonEmptyString(output, 'output');
	const inputArgs = [];
	const videoInputPaths = stagedInputs?.videoInputPaths;
	const audioInputPath = stagedInputs?.audioInputPath;

	for (const input of normalized.inputs) {
		let path;
		if (input.kind === 'video-source') {
			path = mappedValue(videoInputPaths, input.sourceId);
			if (path == null) throw new ReferenceError(`Missing staged video input for source ${input.sourceId}.`);
			path = nonEmptyString(path, `video input ${input.sourceId}`);
		} else {
			if (audioInputPath == null) throw new ReferenceError('Missing staged audio mix input.');
			path = nonEmptyString(audioInputPath, 'audio input');
		}
		inputArgs.push('-i', path);
	}

	const filterGraph = buildVideoFilterGraph(normalized);
	const descriptor = normalized.descriptor;
	const defaults = DEFAULT_VIDEO_ENCODING_SETTINGS[descriptor.id];
	const args = [
		...inputArgs,
		'-filter_complex', filterGraph,
		'-map', '[video_out]',
	];
	if (normalized.audioInput) args.push('-map', '[audio_out]');
	args.push(
		'-map_metadata', '-1',
		'-map_chapters', '-1',
		'-sn',
		'-dn',
		'-c:v', descriptor.videoEncoder,
	);
	if (descriptor.id === 'mp4') {
		args.push(
			'-preset', defaults.preset,
			'-crf', String(defaults.crf),
		);
	} else {
		args.push(
			'-crf', String(defaults.crf),
			'-b:v', '0',
			'-deadline', defaults.deadline,
			'-cpu-used', String(defaults.cpuUsed),
		);
	}
	args.push(
		'-pix_fmt', descriptor.pixelFormat,
		'-r', ffmpegNumber(normalized.frameRate, 'plan.canvas.frameRate'),
	);
	if (normalized.audioInput) {
		args.push(
			'-c:a', descriptor.audioEncoder,
			'-b:a', `${defaults.audioBitRateKbps}k`,
		);
	} else {
		args.push('-an');
	}
	if (descriptor.id === 'mp4') args.push('-movflags', '+faststart');
	args.push(
		'-t', ffmpegNumber(normalized.durationSeconds, 'plan.durationSeconds'),
		'-f', descriptor.container,
		'-y', outputPath,
	);
	return args;
}

function buildVideoFilterGraph(plan) {
	const filters = [];
	const segmentLabels = [];
	for (const [index, segment] of plan.segments.entries()) {
		const label = `video_segment_${index}`;
		segmentLabels.push(label);
		if (segment.kind === 'black') {
			filters.push([
				`color=c=${ffmpegColor(segment.color || plan.backgroundColor)}`,
				`s=${plan.width}x${plan.height}`,
				`r=${ffmpegNumber(plan.frameRate, 'plan.canvas.frameRate')}`,
				`d=${ffmpegNumber(segment.durationSeconds, `plan.segments[${index}].durationSeconds`)}`,
			].join(':')
				+ `,format=pix_fmts=${plan.pixelFormat},setsar=1[${label}]`);
			continue;
		}

		const start = ffmpegNumber(segment.sourceStartTimeSeconds, `plan.segments[${index}].sourceStartTimeSeconds`);
		const end = ffmpegNumber(segment.sourceEndTimeSeconds, `plan.segments[${index}].sourceEndTimeSeconds`);
		const playbackRate = ffmpegNumber(segment.playbackRate, `plan.segments[${index}].playbackRate`);
		filters.push(
			`[${segment.inputIndex}:v:0]`
			+ `trim=start=${start}:end=${end},`
			+ `setpts=(PTS-STARTPTS)/${playbackRate},`
			+ `scale=w=${plan.width}:h=${plan.height}:force_original_aspect_ratio=decrease,`
			+ `pad=w=${plan.width}:h=${plan.height}:x=(ow-iw)/2:y=(oh-ih)/2:color=${ffmpegColor(plan.backgroundColor)},`
			+ `fps=fps=${ffmpegNumber(plan.frameRate, 'plan.canvas.frameRate')},`
			+ `format=pix_fmts=${plan.pixelFormat},`
			+ `setsar=1[${label}]`,
		);
	}
	filters.push(
		segmentLabels.map((label) => `[${label}]`).join('')
		+ `concat=n=${segmentLabels.length}:v=1:a=0[video_out]`,
	);
	if (plan.audioInput) {
		filters.push(
			`[${plan.audioInput.inputIndex}:a:0]`
			+ `atrim=start=0:duration=${ffmpegNumber(plan.durationSeconds, 'plan.durationSeconds')},`
			+ 'asetpts=PTS-STARTPTS[audio_out]',
		);
	}
	return filters.join(';');
}

function normalizeVideoExportPlan(plan) {
	if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
		throw new TypeError('Expected a video export plan.');
	}
	if (plan.version !== 1) throw new RangeError(`Unsupported video export plan version: ${plan.version}.`);
	const descriptor = getVideoExportFormat(plan.format);
	if (plan.container !== descriptor.container) {
		throw new TypeError(`Video export plan container must be ${descriptor.container}.`);
	}
	if (plan.codecs?.videoEncoder !== descriptor.videoEncoder) {
		throw new TypeError(`Video export plan encoder must be ${descriptor.videoEncoder}.`);
	}
	const width = positiveEvenInteger(plan.canvas?.width, 'plan.canvas.width');
	const height = positiveEvenInteger(plan.canvas?.height, 'plan.canvas.height');
	const frameRate = positiveFiniteNumber(plan.canvas?.frameRate, 'plan.canvas.frameRate');
	const durationSeconds = positiveFiniteNumber(plan.durationSeconds, 'plan.durationSeconds');
	const pixelFormat = nonEmptyString(plan.codecs?.pixelFormat, 'plan.codecs.pixelFormat');
	if (pixelFormat !== descriptor.pixelFormat) {
		throw new TypeError(`Video export plan pixel format must be ${descriptor.pixelFormat}.`);
	}

	if (!Array.isArray(plan.inputs)) throw new TypeError('Video export plan inputs must be an array.');
	const inputs = [...plan.inputs].sort((left, right) => left.inputIndex - right.inputIndex);
	const sourceInputIndexes = new Map();
	let audioInput = null;
	for (const [expectedIndex, input] of inputs.entries()) {
		if (input?.inputIndex !== expectedIndex) {
			throw new RangeError('Video export plan input indexes must be contiguous and zero-based.');
		}
		if (input.kind === 'video-source') {
			const sourceId = nonEmptyString(input.sourceId, `plan.inputs[${expectedIndex}].sourceId`);
			if (sourceInputIndexes.has(sourceId)) {
				throw new RangeError(`Video export plan contains duplicate source ${sourceId}.`);
			}
			sourceInputIndexes.set(sourceId, expectedIndex);
		} else if (input.kind === 'staged-audio-mix') {
			if (audioInput) throw new RangeError('Video export plan may contain only one staged audio mix.');
			audioInput = input;
		} else {
			throw new TypeError(`Unsupported video export input kind: ${input?.kind}.`);
		}
	}
	if (audioInput && audioInput !== inputs.at(-1)) {
		throw new RangeError('The staged audio mix must be the final video export input.');
	}
	const expectsAudio = plan.filterPlan?.audio?.strategy === 'staged-mix';
	if (expectsAudio !== Boolean(audioInput)) {
		throw new TypeError('Video export plan audio input and filter strategy do not agree.');
	}
	if (Boolean(audioInput) !== Boolean(plan.codecs?.audioEncoder)) {
		throw new TypeError('Video export plan audio input and encoder do not agree.');
	}
	if (audioInput && plan.codecs.audioEncoder !== descriptor.audioEncoder) {
		throw new TypeError(`Video export plan audio encoder must be ${descriptor.audioEncoder}.`);
	}

	if (!Array.isArray(plan.segments) || plan.segments.length === 0) {
		throw new RangeError('Video export plan must contain at least one segment.');
	}
	const segments = plan.segments.map((segment, index) => {
		const duration = positiveFiniteNumber(
			segment?.durationSeconds,
			`plan.segments[${index}].durationSeconds`,
		);
		if (segment.kind === 'black') {
			return {
				kind: 'black',
				color: segment.color,
				durationSeconds: duration,
			};
		}
		if (segment.kind !== 'video') {
			throw new TypeError(`Unsupported video export segment kind: ${segment?.kind}.`);
		}
		const inputIndex = nonNegativeInteger(segment.inputIndex, `plan.segments[${index}].inputIndex`);
		const input = inputs[inputIndex];
		if (input?.kind !== 'video-source' || input.sourceId !== segment.sourceId) {
			throw new ReferenceError(`Video export segment ${index} references an incompatible input.`);
		}
		const sourceStartTimeSeconds = nonNegativeFiniteNumber(
			segment.sourceStartTimeSeconds,
			`plan.segments[${index}].sourceStartTimeSeconds`,
		);
		const sourceEndTimeSeconds = positiveFiniteNumber(
			segment.sourceEndTimeSeconds,
			`plan.segments[${index}].sourceEndTimeSeconds`,
		);
		if (sourceEndTimeSeconds <= sourceStartTimeSeconds) {
			throw new RangeError(`Video export segment ${index} source range must have positive duration.`);
		}
		return {
			kind: 'video',
			inputIndex,
			sourceStartTimeSeconds,
			sourceEndTimeSeconds,
			playbackRate: positiveFiniteNumber(
				segment.playbackRate,
				`plan.segments[${index}].playbackRate`,
			),
			durationSeconds: duration,
		};
	});

	return {
		descriptor,
		inputs,
		audioInput,
		segments,
		width,
		height,
		frameRate,
		durationSeconds,
		pixelFormat,
		backgroundColor: plan.canvas?.backgroundColor || '#000000',
	};
}

function mappedValue(mapping, key) {
	if (mapping instanceof Map) return mapping.get(key);
	if (mapping && typeof mapping === 'object' && Object.prototype.hasOwnProperty.call(mapping, key)) {
		return mapping[key];
	}
	return undefined;
}

function ffmpegColor(value) {
	const color = nonEmptyString(value, 'video color').trim();
	if (/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color)) return `0x${color.slice(1)}`;
	if (/^0x[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color)) return color;
	if (/^[a-z][a-z0-9_-]*(?:@(?:0(?:\.\d+)?|1(?:\.0+)?))?$/i.test(color)) return color;
	throw new TypeError(`Unsupported FFmpeg video color: ${value}.`);
}

function ffmpegNumber(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new RangeError(`${name} must be finite.`);
	return String(Object.is(number, -0) ? 0 : number);
}

function nonEmptyString(value, name) {
	const text = String(value ?? '');
	if (!text) throw new TypeError(`${name} must not be empty.`);
	return text;
}

function nonNegativeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return number;
}

function positiveEvenInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 2 || number % 2 !== 0) {
		throw new RangeError(`${name} must be a positive even integer.`);
	}
	return number;
}

function nonNegativeFiniteNumber(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < 0) throw new RangeError(`${name} must be non-negative.`);
	return number;
}

function positiveFiniteNumber(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${name} must be positive.`);
	return number;
}
