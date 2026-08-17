import { getVideoExportFormat } from './video-export.js';
import {
	serializeVideoEffectsToFfmpegOperations,
} from './video-effects.js';
import { appendVideoEffectOperation } from './video-effect-ffmpeg.ts';
import {
	appendVideoFfmpegV6ClipFilters,
	appendVideoFfmpegV6LayerBlend,
	normalizeVideoFfmpegCompositionIntervals,
	videoFfmpegV6ContainedSize,
	videoFfmpegV6ContainFilter,
} from './video-ffmpeg-render-description.ts';
import { SUPPORTED_VIDEO_EXPORT_PLAN_VERSIONS } from './video-export-plan-version.ts';

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
			// State the decode this graph was planned against instead of inheriting
			// a build default: every presentation is the residual left after FFmpeg
			// has applied the container display matrix itself.
			if (normalized.version >= 5) inputArgs.push('-autorotate', '1');
		} else {
			if (audioInputPath == null) throw new ReferenceError('Missing staged audio mix input.');
			path = nonEmptyString(audioInputPath, 'audio input');
		}
		inputArgs.push('-i', path);
	}

	const filterGraph = normalized.version === 1
		? buildSequentialVideoFilterGraph(normalized)
		: buildLayeredVideoFilterGraph(normalized);
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

function buildSequentialVideoFilterGraph(plan) {
	const filters = [];
	const inputLabelForSegment = createVideoInputBranchAllocator(
		plan,
		filters,
		plan.segments
			.filter((segment) => segment.kind === 'video')
			.map((segment) => segment.inputIndex),
	);
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
			`[${inputLabelForSegment(segment.inputIndex)}]`
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

function buildLayeredVideoFilterGraph(plan) {
	const filters = [];
	const inputLabelForClip = createVideoInputBranchAllocator(
		plan,
		filters,
		plan.intervals.flatMap((interval) => interval.layers.flatMap(
			(layer) => layer.clips.map((clip) => clip.inputIndex),
		)),
	);
	const intervalLabels = [];
	for (const [intervalIndex, interval] of plan.intervals.entries()) {
		const prefix = `video_interval_${intervalIndex}`;
		const baseLabel = `${prefix}_base`;
		const intervalLabel = prefix;
		intervalLabels.push(intervalLabel);
		filters.push([
			`color=c=${ffmpegColor(interval.color || plan.backgroundColor)}`,
			`s=${plan.width}x${plan.height}`,
			`r=${ffmpegNumber(plan.frameRate, 'plan.canvas.frameRate')}`,
			`d=${ffmpegNumber(interval.durationSeconds, `plan.intervals[${intervalIndex}].durationSeconds`)}`,
		].join(':')
			+ `,format=pix_fmts=rgba,setsar=1[${baseLabel}]`);

		let stackLabel = baseLabel;
		for (const [trackIndex, track] of interval.layers.entries()) {
			const clipLabels = [];
			for (const [clipIndex, clip] of track.clips.entries()) {
				const clipLabel = `${prefix}_track_${trackIndex}_clip_${clipIndex}`;
				clipLabels.push(clipLabel);
				const start = ffmpegNumber(
					clip.sourceStartTimeSeconds,
					`plan.intervals[${intervalIndex}].layers[${trackIndex}].clips[${clipIndex}].sourceStartTimeSeconds`,
				);
				const end = ffmpegNumber(
					clip.sourceEndTimeSeconds,
					`plan.intervals[${intervalIndex}].layers[${trackIndex}].clips[${clipIndex}].sourceEndTimeSeconds`,
				);
				const playbackRate = ffmpegNumber(
					clip.playbackRate,
					`plan.intervals[${intervalIndex}].layers[${trackIndex}].clips[${clipIndex}].playbackRate`,
				);
				const effectOperations = serializeVideoEffectsToFfmpegOperations(
					clip.videoEffects,
					`plan.intervals[${intervalIndex}].layers[${trackIndex}].clips[${clipIndex}].videoEffects`,
				);
				const inputFilters = [
					`trim=start=${start}:end=${end}`,
					`setpts=(PTS-STARTPTS)/${playbackRate}`,
					plan.version >= 6
						? videoFfmpegV6ContainFilter(clip.renderDescription)
						: `scale=w=${plan.width}:h=${plan.height}:force_original_aspect_ratio=decrease`,
					'format=pix_fmts=rgba',
					...(plan.version >= 3
						? [`fps=fps=${ffmpegNumber(plan.frameRate, 'plan.canvas.frameRate')}`]
						: []),
				];
				const legacyOutputFilters = [
					`pad=w=${plan.width}:h=${plan.height}:x=(ow-iw)/2:y=(oh-ih)/2:color=black@0`,
					...(plan.version >= 3 ? ['premultiply=inplace=1'] : []),
					...(plan.version >= 3
						? []
						: [`fps=fps=${ffmpegNumber(plan.frameRate, 'plan.canvas.frameRate')}`]),
					'setsar=1',
					`trim=duration=${ffmpegNumber(interval.durationSeconds, `plan.intervals[${intervalIndex}].durationSeconds`)}`,
					'setpts=PTS-STARTPTS',
				];
				if (plan.version >= 6) {
					let geometryInputLabel = `${clipLabel}_geometry_input`;
					filters.push(
						`[${inputLabelForClip(clip.inputIndex)}]${inputFilters.join(',')}[${geometryInputLabel}]`,
					);
					const effectSize = videoFfmpegV6ContainedSize(clip.renderDescription);
					for (const [effectIndex, operation] of effectOperations.entries()) {
						const effectOutputLabel = `${clipLabel}_effect_${effectIndex}`;
						appendVideoEffectOperation({
							filters,
							inputLabel: geometryInputLabel,
							outputLabel: effectOutputLabel,
							operation,
							width: effectSize.width,
							height: effectSize.height,
						});
						geometryInputLabel = effectOutputLabel;
					}
					appendVideoFfmpegV6ClipFilters({
						filters,
						inputLabel: geometryInputLabel,
						outputLabel: clipLabel,
						description: clip.renderDescription,
						canvasWidth: plan.width,
						canvasHeight: plan.height,
						frameRate: plan.frameRate,
						durationSeconds: interval.durationSeconds,
						applyStaticOpacity: track.clips.length === 1,
					});
				} else if (effectOperations.length === 0) {
					filters.push(
						`[${inputLabelForClip(clip.inputIndex)}]`
						+ [...inputFilters, ...legacyOutputFilters].join(',')
						+ `[${clipLabel}]`,
					);
				} else {
					let effectInputLabel = `${clipLabel}_effect_input`;
					filters.push(`[${inputLabelForClip(clip.inputIndex)}]${inputFilters.join(',')}[${effectInputLabel}]`);
					for (const [effectIndex, operation] of effectOperations.entries()) {
						const effectOutputLabel = `${clipLabel}_effect_${effectIndex}`;
						appendVideoEffectOperation({
							filters,
							inputLabel: effectInputLabel,
							outputLabel: effectOutputLabel,
							operation,
							width: plan.width,
							height: plan.height,
						});
						effectInputLabel = effectOutputLabel;
					}
					filters.push(`[${effectInputLabel}]${legacyOutputFilters.join(',')}[${clipLabel}]`);
				}
			}

			let trackLabel = clipLabels[0];
			if (clipLabels.length === 2) {
				trackLabel = `${prefix}_track_${trackIndex}`;
				const outgoing = opacityExpression(
					track.clips[0].opacityStart,
					track.clips[0].opacityEnd,
					interval.durationSeconds,
				);
				const incoming = opacityExpression(
					track.clips[1].opacityStart,
					track.clips[1].opacityEnd,
					interval.durationSeconds,
				);
				filters.push(
					`[${clipLabels[0]}][${clipLabels[1]}]`
					+ `blend=all_expr='A*(${outgoing})+B*(${incoming})'[${trackLabel}]`,
				);
			}

			const nextStackLabel = `${prefix}_stack_${trackIndex}`;
			if (plan.version >= 6) {
				appendVideoFfmpegV6LayerBlend({
					filters,
					backdropLabel: stackLabel,
					layerLabel: trackLabel,
					outputLabel: nextStackLabel,
					blendMode: track.clips[0].renderDescription.blendMode,
				});
			} else {
				filters.push(
					`[${stackLabel}][${trackLabel}]`
					+ 'overlay=x=0:y=0:eof_action=pass:repeatlast=0:format=auto:alpha=premultiplied'
					+ `[${nextStackLabel}]`,
				);
			}
			stackLabel = nextStackLabel;
		}

		filters.push(
			`[${stackLabel}]format=pix_fmts=${plan.pixelFormat},setsar=1[${intervalLabel}]`,
		);
	}
	filters.push(
		intervalLabels.map((label) => `[${label}]`).join('')
		+ `concat=n=${intervalLabels.length}:v=1:a=0[video_out]`,
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

function createVideoInputBranchAllocator(plan, filters, inputIndexes) {
	const useCounts = new Map();
	for (const inputIndex of inputIndexes) {
		useCounts.set(inputIndex, (useCounts.get(inputIndex) || 0) + 1);
	}

	const branchLabels = new Map();
	const sourceLabels = new Map();
	for (const input of plan.inputs) {
		if (input.kind !== 'video-source') continue;
		const useCount = useCounts.get(input.inputIndex) || 0;
		let sourceLabel = `${input.inputIndex}:v:0`;
		// The presentation carries coded frames to display geometry once per
		// input, ahead of any branch, so every clip of a source shares it.
		if (input.presentation && useCount > 0) {
			const presentedLabel = `video_input_${input.inputIndex}_presented`;
			filters.push(
				`[${sourceLabel}]${videoPresentationFilters(input.presentation).join(',')}[${presentedLabel}]`,
			);
			sourceLabel = presentedLabel;
			sourceLabels.set(input.inputIndex, sourceLabel);
		}
		if (useCount <= 1) continue;
		const labels = Array.from(
			{ length: useCount },
			(_, branchIndex) => `video_input_${input.inputIndex}_split_${branchIndex}`,
		);
		branchLabels.set(input.inputIndex, labels);
		filters.push(
			`[${sourceLabel}]split=${useCount}`
			+ labels.map((label) => `[${label}]`).join(''),
		);
	}

	const nextBranchIndexes = new Map();
	return (inputIndex) => {
		const labels = branchLabels.get(inputIndex);
		if (!labels) return sourceLabels.get(inputIndex) ?? `${inputIndex}:v:0`;
		const branchIndex = nextBranchIndexes.get(inputIndex) || 0;
		const label = labels[branchIndex];
		if (!label) throw new RangeError(`Video input ${inputIndex} has too many filter branches.`);
		nextBranchIndexes.set(inputIndex, branchIndex + 1);
		return label;
	};
}

/**
 * The chain that closes the distance FFmpeg's own decode left: the pixel aspect
 * ratio the decoder ignored, stretched along whichever axis carries the coded
 * width once the display matrix has been applied.
 */
function videoPresentationFilters(presentation) {
	return [`scale=w=${presentation.scaledWidth}:h=${presentation.scaledHeight}`, 'setsar=1'];
}

function normalizeVideoInputPresentation(value, name) {
	if (value == null) return null;
	if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	if (value.autorotate !== true) {
		throw new TypeError(`${name}.autorotate must be true: the decode applies the display matrix.`);
	}
	const decodedWidth = positiveSafeInteger(value.decodedWidth, `${name}.decodedWidth`);
	const decodedHeight = positiveSafeInteger(value.decodedHeight, `${name}.decodedHeight`);
	const scaledWidth = positiveSafeInteger(value.scaledWidth, `${name}.scaledWidth`);
	const scaledHeight = positiveSafeInteger(value.scaledHeight, `${name}.scaledHeight`);
	if (scaledWidth === decodedWidth && scaledHeight === decodedHeight) {
		throw new RangeError(`${name} must state a stretch the decode did not already apply.`);
	}
	return Object.freeze({
		autorotate: true,
		decodedWidth,
		decodedHeight,
		sampleAspect: Object.freeze({
			num: positiveSafeInteger(value.sampleAspect?.num, `${name}.sampleAspect.num`),
			den: positiveSafeInteger(value.sampleAspect?.den, `${name}.sampleAspect.den`),
		}),
		scaledWidth,
		scaledHeight,
	});
}

function opacityExpression(start, end, durationSeconds) {
	const initial = ffmpegNumber(start, 'clip opacityStart');
	const delta = Number(end) - Number(start);
	if (Math.abs(delta) <= Number.EPSILON) return initial;
	const magnitude = ffmpegNumber(Math.abs(delta), 'clip opacity delta');
	const duration = ffmpegNumber(durationSeconds, 'interval durationSeconds');
	return delta > 0
		? `${initial}+${magnitude}*T/${duration}`
		: `${initial}-${magnitude}*T/${duration}`;
}

function normalizeVideoExportPlan(plan) {
	if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
		throw new TypeError('Expected a video export plan.');
	}
	if (!SUPPORTED_VIDEO_EXPORT_PLAN_VERSIONS.includes(plan.version)) {
		throw new RangeError(`Unsupported video export plan version: ${plan.version}.`);
	}
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
	const inputs = [...plan.inputs]
		.sort((left, right) => left.inputIndex - right.inputIndex)
		.map((input, index) => (input?.kind === 'video-source'
			? {
				...input,
				// Version 5 and later state a presentation; an older plan is presented
				// exactly as its decoder decodes it.
				presentation: plan.version >= 5
					? normalizeVideoInputPresentation(input.presentation, `plan.inputs[${index}].presentation`)
					: null,
			}
			: input));
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

	const content = plan.version === 1
		? { segments: normalizeSequentialSegments(plan, inputs) }
		: {
				intervals: normalizeVideoFfmpegCompositionIntervals(
					plan, inputs, durationSeconds, { width, height },
				),
		};

	return {
		version: plan.version,
		descriptor,
		inputs,
		audioInput,
		...content,
		width,
		height,
		frameRate,
		durationSeconds,
		pixelFormat,
		backgroundColor: plan.canvas?.backgroundColor || '#000000',
	};
}

function normalizeSequentialSegments(plan, inputs) {
	if (!Array.isArray(plan.segments) || plan.segments.length === 0) {
		throw new RangeError('Video export plan must contain at least one segment.');
	}
	return plan.segments.map((segment, index) => {
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

function positiveSafeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
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
