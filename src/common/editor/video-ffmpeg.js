import {
	serializeVideoEffectsToFfmpegOperations,
} from './video-effects.js';
import { appendVideoEffectOperation } from './video-effect-ffmpeg.ts';
import {
	appendVideoFfmpegV6ClipFilters,
	appendVideoFfmpegV6LayerBlend,
	videoFfmpegV6FitFilter,
	videoFfmpegV6FittedSize,
} from './video-ffmpeg-render-description.ts';
import { normalizeVideoExportPlan } from './video-ffmpeg-plan-normalization.js';
import { resolveVideoDeliveryFfmpegQuality } from './video-delivery-quality.ts';
import {
	ffmpegColor,
	ffmpegNumber,
	mappedValue,
	nonEmptyString,
} from './video-ffmpeg-values.js';

/**
 * Build a deterministic FFmpeg command for a video export plan. Input paths
 * are supplied separately from the plan because the browser adapter assigns
 * fresh WORKERFS mount points for every queued job.
 */
export function buildVideoFfmpegArgs(plan, stagedInputs, output) {
	const normalized = normalizeVideoExportPlan(plan);
	const outputPath = nonEmptyString(output, 'output');
	const inputArgs = [];
	const videoInputPaths = stagedInputs?.videoInputPaths;
	const audioInputPath = stagedInputs?.audioInputPath;

	const captionInputPath = stagedInputs?.captionInputPath;
	const burnIn = normalized.burnInStage
		? Object.freeze({
			stage: normalized.burnInStage,
			fontPath: stagedInputs?.burnInFontPath,
			cueTextPaths: burnInCueTextPaths(stagedInputs?.burnInCueTextPaths),
		})
		: null;
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
		} else if (input.kind === 'staged-captions') {
			if (captionInputPath == null) throw new ReferenceError('Missing staged caption document input.');
			path = nonEmptyString(captionInputPath, 'caption input');
		} else {
			if (audioInputPath == null) throw new ReferenceError('Missing staged audio mix input.');
			path = nonEmptyString(audioInputPath, 'audio input');
		}
		inputArgs.push('-i', path);
	}

	const filterGraph = normalized.version === 1
		? buildSequentialVideoFilterGraph(normalized)
		: buildLayeredVideoFilterGraph({ ...normalized, burnIn });
	const descriptor = normalized.descriptor;
	// The plan states a tier; this is where it becomes encoder settings, and the
	// only place it does for this path.
	const encoding = resolveVideoDeliveryFfmpegQuality(descriptor.id, normalized.quality);
	const args = [
		...inputArgs,
		'-filter_complex', filterGraph,
		'-map', '[video_out]',
	];
	if (normalized.audioInput) args.push('-map', '[audio_out]');
	// A caption-carrying delivery maps the staged document's only subtitle
	// stream. `-dn` stays either way: it drops the sources' data streams, which
	// captions have nothing to do with.
	if (normalized.captionInput) args.push('-map', `${normalized.captionInput.inputIndex}:s:0`);
	args.push(
		'-map_metadata', '-1',
		'-map_chapters', '-1',
		// `-sn` would discard the very stream a caption delivery just mapped, so
		// it is emitted for every plan that carries none — which is every plan
		// that shipped before captions were an option.
		...(normalized.captionInput ? [] : ['-sn']),
		'-dn',
		'-c:v', descriptor.videoEncoder,
	);
	if (descriptor.id === 'mp4') {
		args.push(
			'-preset', encoding.preset,
			'-crf', String(encoding.crf),
		);
	} else {
		args.push(
			'-crf', String(encoding.crf),
			'-b:v', '0',
			'-deadline', encoding.deadline,
			'-cpu-used', String(encoding.cpuUsed),
		);
	}
	args.push(
		'-pix_fmt', descriptor.pixelFormat,
		'-r', ffmpegNumber(normalized.frameRate, 'plan.canvas.frameRate'),
	);
	if (normalized.audioInput) {
		args.push(
			'-c:a', descriptor.audioEncoder,
			'-b:a', `${encoding.audioBitRateKbps}k`,
		);
	} else {
		args.push('-an');
	}
	if (normalized.captions?.mux) args.push('-c:s', normalized.captions.subtitleCodec);
	if (descriptor.id === 'mp4') args.push('-movflags', '+faststart');
	args.push(
		'-t', ffmpegNumber(normalized.durationSeconds, 'plan.durationSeconds'),
		'-f', descriptor.container,
		'-y', outputPath,
	);
	return args;
}

function burnInCueTextPaths(value) {
	if (value instanceof Map) return value;
	const paths = new Map();
	for (const [index, path] of Object.entries(value ?? {})) paths.set(Number(index), path);
	return paths;
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
						? videoFfmpegV6FitFilter(clip.renderDescription)
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
					const effectSize = videoFfmpegV6FittedSize(clip.renderDescription);
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
	const concatLabel = plan.burnIn ? 'video_composited' : 'video_out';
	filters.push(
		intervalLabels.map((label) => `[${label}]`).join('')
		+ `concat=n=${intervalLabels.length}:v=1:a=0[${concatLabel}]`,
	);
	if (plan.burnIn) filters.push(burnInFilterChain(plan.burnIn, concatLabel));
	if (plan.audioInput) {
		filters.push(
			`[${plan.audioInput.inputIndex}:a:0]`
			+ `atrim=start=0:duration=${ffmpegNumber(plan.durationSeconds, 'plan.durationSeconds')},`
			+ 'asetpts=PTS-STARTPTS[audio_out]',
		);
	}
	return filters.join(';');
}

/**
 * The burned-in caption chain, applied to the composited picture.
 *
 * One `drawtext` per cue, because a filter's text is fixed for the whole graph
 * and only its `enable` window varies. Each cue's text is read from a staged
 * file rather than written into the graph: the escaping a caption would need to
 * survive three layers of FFmpeg parsing is a defect waiting to happen, and a
 * measured comparison against the file form is what showed the escaped form
 * getting a plain `16:9` wrong.
 */
// A comma inside an option value would end the filter at the graph level, so
// the ones inside `between()` are escaped for that parser rather than this one.
const ESCAPED_COMMA = String.raw`\,`;

function burnInFilterChain(burnIn, inputLabel) {
	const stage = burnIn.stage;
	const steps = stage.cues.map((cue) => {
		const path = burnIn.cueTextPaths.get(cue.index);
		if (path == null) throw new ReferenceError(`Missing staged burn-in text for cue ${cue.index}.`);
		return [
			'drawtext=',
			`fontfile=${nonEmptyString(burnIn.fontPath, 'burn-in font')}`,
			`:textfile=${nonEmptyString(path, `burn-in cue ${cue.index}`)}`,
			`:fontsize=${positiveEvenSafe(stage.fontSizePx, 'burnIn.fontSizePx')}`,
			':fontcolor=white:box=1:boxcolor=black@0.55',
			`:boxborderw=${positiveEvenSafe(stage.boxBorderPx, 'burnIn.boxBorderPx')}`,
			`:line_spacing=${nonNegativeSafe(stage.lineSpacingPx, 'burnIn.lineSpacingPx')}`,
			':x=(w-text_w)/2',
			`:y=h-text_h-${nonNegativeSafe(stage.bottomMarginPx, 'burnIn.bottomMarginPx')}`,
			// No `%{...}` expansion: a caption saying "100%" is a caption, not a
			// directive, and expansion is the only thing that would read it as one.
			':expansion=none',
			// Half-open, not `between`: that is closed at both ends, so a cue ending
			// exactly where the next begins drew both captions on the frame they
			// share, one over the other. Contiguous cues are what a transcript
			// label track produces, so that boundary is the common case.
			`:enable='gte(t${ESCAPED_COMMA}${ffmpegNumber(cue.startSeconds, 'burnIn cue start')})`,
			`*lt(t${ESCAPED_COMMA}${ffmpegNumber(cue.endSeconds, 'burnIn cue end')})'`,
		].join('');
	});
	return `[${inputLabel}]${steps.join(',')}[video_out]`;
}

function positiveEvenSafe(value, name) {
	if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer.`);
	return value;
}

function nonNegativeSafe(value, name) {
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return value;
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
