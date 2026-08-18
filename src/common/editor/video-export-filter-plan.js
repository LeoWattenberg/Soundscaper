/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The serializable filter description a video export plan carries.
 *
 * The executed FFmpeg graph derives its own numbers from each clip's render
 * description; this is the plan's own statement of the same work, for a
 * consumer that reads the plan rather than runs it. The two must agree about
 * what the delivery does, which is why the fit lives here as an operation
 * rather than as an assumption the reader has to make.
 */

export function createFilterPlan(intervals, canvas, projectSampleRate, options) {
	const filters = intervals.map((interval) => ({
		kind: interval.kind,
		intervalIndex: interval.index,
		outputLabel: `video_interval_${interval.index}`,
		durationSeconds: interval.durationSeconds,
		base: {
			name: 'color',
			color: interval.color || canvas.backgroundColor,
			width: canvas.width,
			height: canvas.height,
			frameRate: canvas.frameRate,
			pixelFormat: 'rgba',
		},
		layers: interval.layers.map((layer, layerIndex) => ({
			trackId: layer.trackId,
			trackIndex: layer.trackIndex,
			outputLabel: `video_interval_${interval.index}_track_${layerIndex}`,
			clips: layer.clips.map((clip, clipIndex) => ({
				clipId: clip.clipId,
				sourceId: clip.sourceId,
				inputIndex: clip.inputIndex,
				role: clip.role,
				opacityStart: clip.opacityStart,
				opacityEnd: clip.opacityEnd,
				renderDescription: clip.renderDescription,
				outputLabel: `video_interval_${interval.index}_track_${layerIndex}_clip_${clipIndex}`,
				operations: [
					{
						name: 'trim',
						startSeconds: clip.sourceStartTimeSeconds,
						endSeconds: clip.sourceEndTimeSeconds,
					},
					{
						name: 'setpts',
						origin: 'PTS-STARTPTS',
						playbackRate: clip.playbackRate,
						multiplier: 1 / clip.playbackRate,
					},
					canvasFitScaleOperation(canvas),
					{ name: 'format', pixelFormat: 'rgba' },
					{ name: 'fps', frameRate: canvas.frameRate },
					...clip.videoEffects
						.filter((effect) => effect.enabled)
						.map((effect) => ({ name: 'video-effect', effect })),
					...canvasFitPlacementOperations(canvas),
					{ name: 'premultiply', inplace: true },
					{ name: 'setsar', value: 1 },
				],
			})),
			blend: layer.clips.length === 2
				? {
					name: 'blend',
					opacityStart: layer.clips.map((clip) => clip.opacityStart),
					opacityEnd: layer.clips.map((clip) => clip.opacityEnd),
				}
				: null,
		})),
		overlays: interval.layers.map((layer) => ({
			name: 'overlay',
			trackId: layer.trackId,
			alpha: 'premultiplied',
		})),
	}));
	return {
		strategy: 'layered-composition',
		backgroundColor: canvas.backgroundColor,
		intervals: filters,
		concat: {
			name: 'concat',
			inputLabels: filters.map((filter) => filter.outputLabel),
			videoStreams: 1,
			audioStreams: 0,
			outputLabel: 'video_out',
		},
		audio: options.audioInput
			? {
				strategy: 'staged-mix',
				inputIndex: options.audioInput.inputIndex,
				startFrame: options.audioInput.startFrame,
				durationFrames: options.audioInput.durationFrames,
				sampleRate: projectSampleRate,
				codec: options.format.audioCodec,
			}
			: { strategy: 'none' },
		// The stage is described here and rendered by the adapter, so a consumer
		// that only reads the plan still knows the delivery has text burned into
		// it and exactly when each line is on screen.
		burnIn: options.burnIn ?? null,
		output: {
			videoLabel: 'video_out',
			videoCodec: options.format.videoEncoder,
			audioCodec: options.audioInput ? options.format.audioEncoder : null,
			pixelFormat: options.format.pixelFormat,
		},
	};
}

/**
 * How the filter plan describes reaching the canvas extents.
 *
 * `contain` shrinks until the whole source fits, `cover` grows until no
 * background shows, and `stretch` takes the extents outright. The description
 * uses FFmpeg's own aspect flags rather than resolved pixel counts, exactly as
 * the contain description always has: the executed graph derives its numbers
 * from the render description, and this list states the same operation for a
 * consumer reading the plan.
 */
function canvasFitScaleOperation(canvas) {
	const fit = canvas.fit ?? 'contain';
	if (fit === 'stretch') return { name: 'scale', width: canvas.width, height: canvas.height };
	return {
		name: 'scale',
		width: canvas.width,
		height: canvas.height,
		forceOriginalAspectRatio: fit === 'cover' ? 'increase' : 'decrease',
	};
}

function canvasFitPlacementOperations(canvas) {
	const fit = canvas.fit ?? 'contain';
	// Stretch already occupies the canvas exactly, so it neither pads nor crops.
	if (fit === 'stretch') return [];
	if (fit === 'cover') {
		return [{
			name: 'crop',
			width: canvas.width,
			height: canvas.height,
			x: '(iw-ow)/2',
			y: '(ih-oh)/2',
			exact: true,
		}];
	}
	return [{
		name: 'pad',
		width: canvas.width,
		height: canvas.height,
		x: '(ow-iw)/2',
		y: '(oh-ih)/2',
		color: 'black@0',
	}];
}
