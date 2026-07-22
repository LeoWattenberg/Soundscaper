import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const ffmpegModuleUrl = `data:text/javascript,${encodeURIComponent(`
	export const FFFSType = { WORKERFS: 'WORKERFS' };
	export class FFmpeg {
		constructor() {
			return new globalThis.__soundscaperVideoFfmpegTestRuntime();
		}
	}
`)}`;
const ffmpegLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/ffmpeg') {
			return { url: ${JSON.stringify(ffmpegModuleUrl)}, shortCircuit: true };
		}
		return nextResolve(specifier, context);
	}
`;

register(`data:text/javascript,${encodeURIComponent(ffmpegLoader)}`, import.meta.url);

const {
	FfmpegVideoEncodingError,
	createEditorFfmpeg,
	encoderArgs,
} = await import('../src/common/editor/ffmpeg.js');
const { buildVideoFfmpegArgs } = await import('../src/common/editor/video-ffmpeg.js');

const originalTestRuntime = globalThis.__soundscaperVideoFfmpegTestRuntime;

test.beforeEach(() => {
	MockVideoFfmpegRuntime.reset();
	globalThis.__soundscaperVideoFfmpegTestRuntime = MockVideoFfmpegRuntime;
});

test.afterEach(() => {
	if (originalTestRuntime === undefined) delete globalThis.__soundscaperVideoFfmpegTestRuntime;
	else globalThis.__soundscaperVideoFfmpegTestRuntime = originalTestRuntime;
});

test('legacy version-1 video FFmpeg arguments remain compatible', () => {
	const plan = webmPlan();
	const args = buildVideoFfmpegArgs(plan, {
		videoInputPaths: new Map([
			['source-a', '/stage/video-a.mp4'],
			['source-b', '/stage/video-b.webm'],
		]),
		audioInputPath: '/stage/mix.wav',
	}, 'output.webm');

	assert.deepEqual(args, [
		'-i', '/stage/video-a.mp4',
		'-i', '/stage/video-b.webm',
		'-i', '/stage/mix.wav',
		'-filter_complex',
		'[0:v:0]trim=start=0.5:end=2.5,setpts=(PTS-STARTPTS)/2,scale=w=640:h=360:force_original_aspect_ratio=decrease,pad=w=640:h=360:x=(ow-iw)/2:y=(oh-ih)/2:color=0x112233,fps=fps=24,format=pix_fmts=yuv420p,setsar=1[video_segment_0];'
			+ 'color=c=0x112233:s=640x360:r=24:d=0.25,format=pix_fmts=yuv420p,setsar=1[video_segment_1];'
			+ '[1:v:0]trim=start=0:end=1,setpts=(PTS-STARTPTS)/1,scale=w=640:h=360:force_original_aspect_ratio=decrease,pad=w=640:h=360:x=(ow-iw)/2:y=(oh-ih)/2:color=0x112233,fps=fps=24,format=pix_fmts=yuv420p,setsar=1[video_segment_2];'
			+ '[video_segment_0][video_segment_1][video_segment_2]concat=n=3:v=1:a=0[video_out];'
			+ '[2:a:0]atrim=start=0:duration=2.25,asetpts=PTS-STARTPTS[audio_out]',
		'-map', '[video_out]',
		'-map', '[audio_out]',
		'-map_metadata', '-1',
		'-map_chapters', '-1',
		'-sn',
		'-dn',
		'-c:v', 'libvpx-vp9',
		'-crf', '31',
		'-b:v', '0',
		'-deadline', 'good',
		'-cpu-used', '4',
		'-pix_fmt', 'yuv420p',
		'-r', '24',
		'-c:a', 'libopus',
		'-b:a', '160k',
		'-t', '2.25',
		'-f', 'webm',
		'-y', 'output.webm',
	]);
});

test('legacy version-1 graphs split a source referenced by multiple sequential segments', () => {
	const plan = webmPlan();
	plan.inputs.splice(1, 1);
	plan.inputs[1].inputIndex = 1;
	plan.filterPlan.audio.inputIndex = 1;
	plan.segments[2].inputIndex = 0;
	plan.segments[2].sourceId = 'source-a';
	const args = buildVideoFfmpegArgs(plan, {
		videoInputPaths: { 'source-a': '/stage/video-a.mp4' },
		audioInputPath: '/stage/mix.wav',
	}, 'output.webm');
	const graph = args[args.indexOf('-filter_complex') + 1];

	assert.match(
		graph,
		/^\[0:v:0\]split=2\[video_input_0_split_0\]\[video_input_0_split_1\];/,
	);
	assert.equal(graph.match(/\[0:v:0\]/g)?.length, 1);
	for (let branchIndex = 0; branchIndex < 2; branchIndex += 1) {
		assert.equal(
			graph.match(new RegExp(`\\[video_input_0_split_${branchIndex}\\]`, 'g'))?.length,
			2,
		);
	}
	assert.match(graph, /\[video_input_0_split_0\]trim=start=0\.5:end=2\.5/);
	assert.match(graph, /\[video_input_0_split_1\]trim=start=0:end=1/);
	assert.match(graph, /\[1:a:0\]atrim=start=0:duration=2\.25/);
});

test('version-2 FFmpeg arguments composite layers and preserve absolute crossfade progress', () => {
	const plan = layeredWebmPlan();
	const args = buildVideoFfmpegArgs(plan, {
		videoInputPaths: new Map([
			['source-a', '/stage/video-a.mp4'],
			['source-b', '/stage/video-b.webm'],
			['source-c', '/stage/video-c.mp4'],
		]),
		audioInputPath: '/stage/mix.wav',
	}, 'layered.webm');

	assert.deepEqual(args, [
		'-i', '/stage/video-a.mp4',
		'-i', '/stage/video-b.webm',
		'-i', '/stage/video-c.mp4',
		'-i', '/stage/mix.wav',
		'-filter_complex',
		'color=c=0x112233:s=640x360:r=24:d=1,format=pix_fmts=rgba,setsar=1[video_interval_0_base];'
			+ '[0:v:0]trim=start=1:end=2,setpts=(PTS-STARTPTS)/1,scale=w=640:h=360:force_original_aspect_ratio=decrease,format=pix_fmts=rgba,pad=w=640:h=360:x=(ow-iw)/2:y=(oh-ih)/2:color=black@0,fps=fps=24,setsar=1,trim=duration=1,setpts=PTS-STARTPTS[video_interval_0_track_0_clip_0];'
			+ '[video_interval_0_base][video_interval_0_track_0_clip_0]overlay=x=0:y=0:eof_action=pass:repeatlast=0:format=auto:alpha=premultiplied[video_interval_0_stack_0];'
			+ '[1:v:0]trim=start=2.5:end=3.5,setpts=(PTS-STARTPTS)/1,scale=w=640:h=360:force_original_aspect_ratio=decrease,format=pix_fmts=rgba,pad=w=640:h=360:x=(ow-iw)/2:y=(oh-ih)/2:color=black@0,fps=fps=24,setsar=1,trim=duration=1,setpts=PTS-STARTPTS[video_interval_0_track_1_clip_0];'
			+ '[2:v:0]trim=start=0.5:end=2.5,setpts=(PTS-STARTPTS)/2,scale=w=640:h=360:force_original_aspect_ratio=decrease,format=pix_fmts=rgba,pad=w=640:h=360:x=(ow-iw)/2:y=(oh-ih)/2:color=black@0,fps=fps=24,setsar=1,trim=duration=1,setpts=PTS-STARTPTS[video_interval_0_track_1_clip_1];'
			+ "[video_interval_0_track_1_clip_0][video_interval_0_track_1_clip_1]blend=all_expr='A*(0.75-0.5*T/1)+B*(0.25+0.5*T/1)'[video_interval_0_track_1];"
			+ '[video_interval_0_stack_0][video_interval_0_track_1]overlay=x=0:y=0:eof_action=pass:repeatlast=0:format=auto:alpha=premultiplied[video_interval_0_stack_1];'
			+ '[video_interval_0_stack_1]format=pix_fmts=yuv420p,setsar=1[video_interval_0];'
			+ 'color=c=0x112233:s=640x360:r=24:d=0.5,format=pix_fmts=rgba,setsar=1[video_interval_1_base];'
			+ '[video_interval_1_base]format=pix_fmts=yuv420p,setsar=1[video_interval_1];'
			+ '[video_interval_0][video_interval_1]concat=n=2:v=1:a=0[video_out];'
			+ '[3:a:0]atrim=start=0:duration=1.5,asetpts=PTS-STARTPTS[audio_out]',
		'-map', '[video_out]',
		'-map', '[audio_out]',
		'-map_metadata', '-1',
		'-map_chapters', '-1',
		'-sn',
		'-dn',
		'-c:v', 'libvpx-vp9',
		'-crf', '31',
		'-b:v', '0',
		'-deadline', 'good',
		'-cpu-used', '4',
		'-pix_fmt', 'yuv420p',
		'-r', '24',
		'-c:a', 'libopus',
		'-b:a', '160k',
		'-t', '1.5',
		'-f', 'webm',
		'-y', 'layered.webm',
	]);
});

test('version-3 FFmpeg graphs serialize the ordered allowlisted video effect stack before padding', () => {
	const plan = layeredWebmPlan();
	plan.version = 3;
	plan.intervals[0].layers[0].clips[0].videoEffects = [
		videoEffect('color', 'color-adjust', {
			brightness: 0.25,
			contrast: 1.5,
			saturation: 0.75,
			gamma: 1.25,
			hueDegrees: -30,
		}),
		videoEffect('pixel', 'pixelate', { blockSize: 12 }),
		videoEffect('vignette', 'vignette', { amount: 0.5 }),
		videoEffect('blur', 'gaussian-blur', { sigma: 6 }),
		videoEffect('sharpen', 'sharpen', { amount: 1.25 }),
		videoEffect('split', 'rgb-split', { offsetX: 7, offsetY: -3 }),
		videoEffect('bypassed', 'pixelate', { blockSize: 99 }, false),
	];
	const args = buildVideoFfmpegArgs(plan, {
		videoInputPaths: {
			'source-a': '/stage/video-a.mp4',
			'source-b': '/stage/video-b.webm',
			'source-c': '/stage/video-c.mp4',
		},
		audioInputPath: '/stage/mix.wav',
	}, 'effects.webm');
	const graph = args[args.indexOf('-filter_complex') + 1];

	const orderedFilters = [
		'format=pix_fmts=yuva444p',
		'eq=brightness=0.25:contrast=1.5:saturation=0.75:gamma=1.25:eval=init',
		'hue=h=-30',
		'limiter=min=16:max=235:planes=1',
		'limiter=min=16:max=240:planes=6',
		'pixelize=w=12:h=12:mode=avg:planes=15',
		'vignette=angle=0.7848981633974483:x0=w/2:y0=h/2:mode=forward:eval=init:dither=0',
		'gblur=sigma=6:sigmaV=6:steps=1:planes=15',
		'unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=1.25:chroma_msize_x=5:chroma_msize_y=5:chroma_amount=0',
		'rgbashift=rh=7:rv=-3:gh=0:gv=0:bh=-7:bv=3:ah=0:av=0:edge=smear',
		'pad=w=640:h=360:x=(ow-iw)/2:y=(oh-ih)/2:color=black@0',
		'premultiply=inplace=1',
	];
	let previousIndex = -1;
	for (const filter of orderedFilters) {
		const filterIndex = graph.indexOf(filter, previousIndex + 1);
		assert.ok(filterIndex > previousIndex, `${filter} must follow the preceding effect.`);
		previousIndex = filterIndex;
	}
	assert.match(graph, /format=pix_fmts=rgba,split=2\[[^\]]+_color\]\[[^\]]+_alpha_source\]/);
	assert.match(graph, /\[[^\]]+_alpha_source\]alphaextract\[[^\]]+_alpha\]/);
	assert.match(graph, /vignette=[^;]+,format=pix_fmts=rgb24\[[^\]]+_filtered_color\]/);
	assert.match(
		graph,
		/\[[^\]]+_filtered_color\]\[[^\]]+_alpha\]alphamerge,format=pix_fmts=rgba,setpts=PTS-STARTPTS\[[^\]]+\]/,
	);
	assert.match(
		graph,
		/format=pix_fmts=rgba,fps=fps=24\[[^\]]+_effect_input\]/,
	);
	assert.match(
		graph,
		/pad=[^;]+,premultiply=inplace=1,setsar=1/,
	);
	assert.doesNotMatch(graph, /pixelize=w=99/);
});

test('version-3 FFmpeg validation rejects malformed effects and ignores effects injected into version 2', () => {
	const unsafe = layeredWebmPlan();
	unsafe.version = 3;
	unsafe.intervals[0].layers[0].clips[0].videoEffects = [
		videoEffect('unsafe', 'pixelate;movie=secret', { blockSize: 16 }),
	];
	assert.throws(
		() => buildVideoFfmpegArgs(unsafe, {
			videoInputPaths: {
				'source-a': '/stage/video-a.mp4',
				'source-b': '/stage/video-b.webm',
				'source-c': '/stage/video-c.mp4',
			},
			audioInputPath: '/stage/mix.wav',
		}, 'unsafe.webm'),
		/Unsupported video effect type/,
	);

	const legacy = layeredWebmPlan();
	legacy.intervals[0].layers[0].clips[0].videoEffects = [
		videoEffect('ignored', 'pixelate', { blockSize: 64 }),
	];
	const legacyArgs = buildVideoFfmpegArgs(legacy, {
		videoInputPaths: {
			'source-a': '/stage/video-a.mp4',
			'source-b': '/stage/video-b.webm',
			'source-c': '/stage/video-c.mp4',
		},
		audioInputPath: '/stage/mix.wav',
	}, 'legacy.webm');
	assert.doesNotMatch(legacyArgs[legacyArgs.indexOf('-filter_complex') + 1], /pixelize/);
});

test('version-2 FFmpeg graph splits a source used across crossfade clips and intervals', () => {
	const args = buildVideoFfmpegArgs(reusedSourceMp4Plan(), {
		videoInputPaths: { shared: '/stage/shared.mp4' },
	}, 'shared.mp4');

	assert.deepEqual(args.slice(0, 3), ['-i', '/stage/shared.mp4', '-filter_complex']);
	assert.equal(
		args[3],
		'[0:v:0]split=3[video_input_0_split_0][video_input_0_split_1][video_input_0_split_2];'
			+ 'color=c=black:s=320x180:r=30:d=1,format=pix_fmts=rgba,setsar=1[video_interval_0_base];'
			+ '[video_input_0_split_0]trim=start=0:end=1,setpts=(PTS-STARTPTS)/1,scale=w=320:h=180:force_original_aspect_ratio=decrease,format=pix_fmts=rgba,pad=w=320:h=180:x=(ow-iw)/2:y=(oh-ih)/2:color=black@0,fps=fps=30,setsar=1,trim=duration=1,setpts=PTS-STARTPTS[video_interval_0_track_0_clip_0];'
			+ '[video_input_0_split_1]trim=start=1:end=2,setpts=(PTS-STARTPTS)/1,scale=w=320:h=180:force_original_aspect_ratio=decrease,format=pix_fmts=rgba,pad=w=320:h=180:x=(ow-iw)/2:y=(oh-ih)/2:color=black@0,fps=fps=30,setsar=1,trim=duration=1,setpts=PTS-STARTPTS[video_interval_0_track_0_clip_1];'
			+ "[video_interval_0_track_0_clip_0][video_interval_0_track_0_clip_1]blend=all_expr='A*(1-1*T/1)+B*(0+1*T/1)'[video_interval_0_track_0];"
			+ '[video_interval_0_base][video_interval_0_track_0]overlay=x=0:y=0:eof_action=pass:repeatlast=0:format=auto:alpha=premultiplied[video_interval_0_stack_0];'
			+ '[video_interval_0_stack_0]format=pix_fmts=yuv420p,setsar=1[video_interval_0];'
			+ 'color=c=black:s=320x180:r=30:d=1,format=pix_fmts=rgba,setsar=1[video_interval_1_base];'
			+ '[video_input_0_split_2]trim=start=2:end=3,setpts=(PTS-STARTPTS)/1,scale=w=320:h=180:force_original_aspect_ratio=decrease,format=pix_fmts=rgba,pad=w=320:h=180:x=(ow-iw)/2:y=(oh-ih)/2:color=black@0,fps=fps=30,setsar=1,trim=duration=1,setpts=PTS-STARTPTS[video_interval_1_track_0_clip_0];'
			+ '[video_interval_1_base][video_interval_1_track_0_clip_0]overlay=x=0:y=0:eof_action=pass:repeatlast=0:format=auto:alpha=premultiplied[video_interval_1_stack_0];'
			+ '[video_interval_1_stack_0]format=pix_fmts=yuv420p,setsar=1[video_interval_1];'
			+ '[video_interval_0][video_interval_1]concat=n=2:v=1:a=0[video_out]',
	);
	assert.equal(args[3].match(/\[0:v:0\]/g)?.length, 1);
	for (let branchIndex = 0; branchIndex < 3; branchIndex += 1) {
		assert.equal(
			args[3].match(new RegExp(`\\[video_input_0_split_${branchIndex}\\]`, 'g'))?.length,
			2,
		);
	}
});

test('silent MP4 arguments use an encoder-safe color source and do not add an audio stream', () => {
	const plan = silentMp4Plan();
	const args = buildVideoFfmpegArgs(plan, { videoInputPaths: new Map() }, 'output.mp4');
	assert.equal(args[0], '-filter_complex');
	assert.match(args[1], /^color=c=black:s=1280x720:r=30:d=5,/);
	assert.deepEqual(args.slice(args.indexOf('-c:v'), args.indexOf('-t')), [
		'-c:v', 'libx264',
		'-preset', 'medium',
		'-crf', '23',
		'-pix_fmt', 'yuv420p',
		'-r', '30',
		'-an',
		'-movflags', '+faststart',
	]);
	assert.deepEqual(args.slice(-6), ['-t', '5', '-f', 'mp4', '-y', 'output.mp4']);
});

test('video plan validation rejects missing media and unsafe filter colors', () => {
	const plan = webmPlan();
	assert.throws(
		() => buildVideoFfmpegArgs(plan, {
			videoInputPaths: { 'source-a': '/stage/video-a.mp4' },
			audioInputPath: '/stage/mix.wav',
		}, 'output.webm'),
		/Missing staged video input for source source-b/,
	);
	const unsafe = structuredClone(silentMp4Plan());
	unsafe.segments[0].color = 'black;movie=secret';
	assert.throws(
		() => buildVideoFfmpegArgs(unsafe, { videoInputPaths: {} }, 'output.mp4'),
		/Unsupported FFmpeg video color/,
	);

	const invalidCrossfade = layeredWebmPlan();
	invalidCrossfade.intervals[0].layers[1].clips[1].opacityStart = 0.5;
	assert.throws(
		() => buildVideoFfmpegArgs(invalidCrossfade, {
			videoInputPaths: {
				'source-a': '/stage/video-a.mp4',
				'source-b': '/stage/video-b.webm',
				'source-c': '/stage/video-c.mp4',
			},
			audioInputPath: '/stage/mix.wav',
		}, 'output.webm'),
		/crossfade opacities must be complementary/,
	);
});

test('video encoding mounts every input once, runs in plan order, and cleans WORKERFS', async () => {
	const ffmpeg = createEditorFfmpeg({ idleTimeoutMs: false });
	const firstVideo = new Blob([Uint8Array.of(1, 2)], { type: 'video/mp4' });
	const secondVideo = new Blob([Uint8Array.of(3, 4)], { type: 'video/webm' });
	const audio = new Blob([Uint8Array.of(5, 6)], { type: 'audio/wav' });

	const encoded = await ffmpeg.encodeVideo(new Map([
		['source-b', secondVideo],
		['source-a', firstVideo],
	]), audio, webmPlan());
	const runtime = MockVideoFfmpegRuntime.instances[0];
	assert.deepEqual(encoded, {
		bytes: Uint8Array.of(9, 8, 7),
		extension: '.webm',
		mimeType: 'video/webm',
	});
	assert.equal(runtime.mountCalls.length, 1);
	assert.equal(runtime.mountCalls[0].type, 'WORKERFS');
	assert.deepEqual(runtime.mountCalls[0].options.blobs.map(({ name, data }) => [name, data]), [
		['video-000.mp4', firstVideo],
		['video-001.webm', secondVideo],
		['audio-002.wav', audio],
	]);
	const mountPoint = runtime.mountCalls[0].mountPoint;
	assert.deepEqual(runtime.execCalls[0].args.slice(0, 6), [
		'-i', `${mountPoint}/video-000.mp4`,
		'-i', `${mountPoint}/video-001.webm`,
		'-i', `${mountPoint}/audio-002.wav`,
	]);
	assert.deepEqual(runtime.unmountCalls, [mountPoint]);
	assert.deepEqual(runtime.deleteDirCalls, [mountPoint]);
	assert.equal(runtime.deleteFileCalls.length, 1);
	ffmpeg.dispose();
});

test('video encoding surfaces codec failures after cleaning staged inputs', async () => {
	MockVideoFfmpegRuntime.nextExitCode = 7;
	const ffmpeg = createEditorFfmpeg({ idleTimeoutMs: false });
	const plan = silentMp4Plan();
	const error = await ffmpeg.encodeVideo({}, null, plan).catch((caught) => caught);
	assert.ok(error instanceof FfmpegVideoEncodingError);
	assert.equal(error.code, 'FFMPEG_VIDEO_ENCODING_FAILED');
	assert.equal(error.format, 'mp4');
	assert.equal(error.videoEncoder, 'libx264');
	assert.equal(error.exitCode, 7);
	assert.equal(MockVideoFfmpegRuntime.instances[0].deleteFileCalls.length, 1);
	ffmpeg.dispose();
});

test('aborting video encoding terminates the active runtime and unmounts its inputs', async () => {
	MockVideoFfmpegRuntime.pauseExec = true;
	const ffmpeg = createEditorFfmpeg({ idleTimeoutMs: false });
	const controller = new AbortController();
	const encoding = ffmpeg.encodeVideo(
		new Map([
			['source-a', new Blob([Uint8Array.of(1)], { type: 'video/mp4' })],
			['source-b', new Blob([Uint8Array.of(2)], { type: 'video/webm' })],
		]),
		new Blob([Uint8Array.of(3)], { type: 'audio/wav' }),
		webmPlan(),
		{ signal: controller.signal },
	);
	await waitFor(() => MockVideoFfmpegRuntime.instances[0]?.pendingExec.length === 1);
	const runtime = MockVideoFfmpegRuntime.instances[0];
	controller.abort();
	await assert.rejects(encoding);
	assert.equal(runtime.terminateCalls, 1);
	assert.deepEqual(runtime.unmountCalls, [runtime.mountCalls[0].mountPoint]);
});

test('the custom audio FFmpeg command path remains unchanged', () => {
	assert.deepEqual(
		encoderArgs('input.wav', 'output.caf', 'custom-ffmpeg', {
			sampleRate: 48_000,
			channelCount: 2,
			extension: 'caf',
			mimeType: 'audio/x-caf',
			customArguments: ['-c:a', 'pcm_s24be', '-f', 'caf'],
		}),
		[
			'-i', 'input.wav',
			'-vn',
			'-map_metadata', '-1',
			'-ar', '48000',
			'-ac', '2',
			'-c:a', 'pcm_s24be',
			'-f', 'caf',
			'-y', 'output.caf',
		],
	);
});

class MockVideoFfmpegRuntime {
	static instances = [];
	static nextExitCode = 0;
	static pauseExec = false;

	static reset() {
		this.instances = [];
		this.nextExitCode = 0;
		this.pauseExec = false;
	}

	constructor() {
		this.loaded = false;
		this.mountCalls = [];
		this.execCalls = [];
		this.unmountCalls = [];
		this.deleteDirCalls = [];
		this.deleteFileCalls = [];
		this.terminateCalls = 0;
		this.pendingExec = [];
		MockVideoFfmpegRuntime.instances.push(this);
	}

	on() {}

	off() {}

	async load() {
		this.loaded = true;
	}

	async createDir(path) {
		this.createdDir = path;
	}

	async mount(type, options, mountPoint) {
		this.mountCalls.push({ type, options, mountPoint });
	}

	async exec(args, timeout, options) {
		this.execCalls.push({ args, timeout, options });
		if (MockVideoFfmpegRuntime.pauseExec) {
			return new Promise((resolve, reject) => this.pendingExec.push({ resolve, reject }));
		}
		return MockVideoFfmpegRuntime.nextExitCode;
	}

	async readFile() {
		return Uint8Array.of(9, 8, 7);
	}

	async deleteFile(path) {
		this.deleteFileCalls.push(path);
	}

	async unmount(path) {
		this.unmountCalls.push(path);
	}

	async deleteDir(path) {
		this.deleteDirCalls.push(path);
	}

	terminate() {
		this.terminateCalls += 1;
		this.loaded = false;
		for (const pending of this.pendingExec.splice(0)) pending.reject(new Error('FFmpeg runtime terminated.'));
	}
}

async function waitFor(predicate) {
	const deadline = performance.now() + 5_000;
	while (performance.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setImmediate(resolve));
	}
	throw new Error('Timed out waiting for the video FFmpeg runtime fixture.');
}

function webmPlan() {
	return {
		version: 1,
		format: 'webm',
		container: 'webm',
		extension: 'webm',
		mimeType: 'video/webm',
		durationSeconds: 2.25,
		canvas: {
			width: 640,
			height: 360,
			frameRate: 24,
			pixelFormat: 'yuv420p',
			backgroundColor: '#112233',
		},
		codecs: {
			video: 'vp9',
			videoEncoder: 'libvpx-vp9',
			audio: 'opus',
			audioEncoder: 'libopus',
			pixelFormat: 'yuv420p',
		},
		inputs: [
			{ kind: 'video-source', inputIndex: 0, sourceId: 'source-a', mimeType: 'video/mp4' },
			{ kind: 'video-source', inputIndex: 1, sourceId: 'source-b', mimeType: 'video/webm' },
			{ kind: 'staged-audio-mix', inputIndex: 2, fileName: 'audio-mix.wav' },
		],
		segments: [
			{
				kind: 'video',
				inputIndex: 0,
				sourceId: 'source-a',
				sourceStartTimeSeconds: 0.5,
				sourceEndTimeSeconds: 2.5,
				playbackRate: 2,
				durationSeconds: 1,
			},
			{ kind: 'black', color: '#112233', durationSeconds: 0.25 },
			{
				kind: 'video',
				inputIndex: 1,
				sourceId: 'source-b',
				sourceStartTimeSeconds: 0,
				sourceEndTimeSeconds: 1,
				playbackRate: 1,
				durationSeconds: 1,
			},
		],
		filterPlan: { audio: { strategy: 'staged-mix', inputIndex: 2 } },
	};
}

function layeredWebmPlan() {
	return {
		version: 2,
		format: 'webm',
		container: 'webm',
		extension: 'webm',
		mimeType: 'video/webm',
		durationSeconds: 1.5,
		canvas: {
			width: 640,
			height: 360,
			frameRate: 24,
			pixelFormat: 'yuv420p',
			backgroundColor: '#112233',
		},
		codecs: {
			video: 'vp9',
			videoEncoder: 'libvpx-vp9',
			audio: 'opus',
			audioEncoder: 'libopus',
			pixelFormat: 'yuv420p',
		},
		inputs: [
			{ kind: 'video-source', inputIndex: 0, sourceId: 'source-a', mimeType: 'video/mp4' },
			{ kind: 'video-source', inputIndex: 1, sourceId: 'source-b', mimeType: 'video/webm' },
			{ kind: 'video-source', inputIndex: 2, sourceId: 'source-c', mimeType: 'video/mp4' },
			{ kind: 'staged-audio-mix', inputIndex: 3, fileName: 'audio-mix.wav' },
		],
		intervals: [
			{
				kind: 'composition',
				durationSeconds: 1,
				layers: [
					{
						trackId: 'lower-track',
						clips: [{
							role: 'single',
							inputIndex: 0,
							sourceId: 'source-a',
							sourceStartTimeSeconds: 1,
							sourceEndTimeSeconds: 2,
							playbackRate: 1,
							opacityStart: 1,
							opacityEnd: 1,
						}],
					},
					{
						trackId: 'top-track',
						clips: [
							{
								role: 'outgoing',
								inputIndex: 1,
								sourceId: 'source-b',
								sourceStartTimeSeconds: 2.5,
								sourceEndTimeSeconds: 3.5,
								playbackRate: 1,
								opacityStart: 0.75,
								opacityEnd: 0.25,
							},
							{
								role: 'incoming',
								inputIndex: 2,
								sourceId: 'source-c',
								sourceStartTimeSeconds: 0.5,
								sourceEndTimeSeconds: 2.5,
								playbackRate: 2,
								opacityStart: 0.25,
								opacityEnd: 0.75,
							},
						],
					},
				],
			},
			{
				kind: 'black',
				color: '#112233',
				durationSeconds: 0.5,
				layers: [],
			},
		],
		filterPlan: { audio: { strategy: 'staged-mix', inputIndex: 3 } },
	};
}

function reusedSourceMp4Plan() {
	return {
		version: 2,
		format: 'mp4',
		container: 'mp4',
		extension: 'mp4',
		mimeType: 'video/mp4',
		durationSeconds: 2,
		canvas: {
			width: 320,
			height: 180,
			frameRate: 30,
			pixelFormat: 'yuv420p',
			backgroundColor: 'black',
		},
		codecs: {
			video: 'h264',
			videoEncoder: 'libx264',
			audio: null,
			audioEncoder: null,
			pixelFormat: 'yuv420p',
		},
		inputs: [
			{ kind: 'video-source', inputIndex: 0, sourceId: 'shared', mimeType: 'video/mp4' },
		],
		intervals: [
			{
				kind: 'composition',
				durationSeconds: 1,
				layers: [{
					trackId: 'video-track',
					clips: [
						{
							role: 'outgoing',
							inputIndex: 0,
							sourceId: 'shared',
							sourceStartTimeSeconds: 0,
							sourceEndTimeSeconds: 1,
							playbackRate: 1,
							opacityStart: 1,
							opacityEnd: 0,
						},
						{
							role: 'incoming',
							inputIndex: 0,
							sourceId: 'shared',
							sourceStartTimeSeconds: 1,
							sourceEndTimeSeconds: 2,
							playbackRate: 1,
							opacityStart: 0,
							opacityEnd: 1,
						},
					],
				}],
			},
			{
				kind: 'composition',
				durationSeconds: 1,
				layers: [{
					trackId: 'video-track',
					clips: [{
						role: 'single',
						inputIndex: 0,
						sourceId: 'shared',
						sourceStartTimeSeconds: 2,
						sourceEndTimeSeconds: 3,
						playbackRate: 1,
						opacityStart: 1,
						opacityEnd: 1,
					}],
				}],
			},
		],
		filterPlan: { audio: { strategy: 'none' } },
	};
}

function silentMp4Plan() {
	return {
		version: 1,
		format: 'mp4',
		container: 'mp4',
		extension: 'mp4',
		mimeType: 'video/mp4',
		durationSeconds: 5,
		canvas: {
			width: 1_280,
			height: 720,
			frameRate: 30,
			pixelFormat: 'yuv420p',
			backgroundColor: 'black',
		},
		codecs: {
			video: 'h264',
			videoEncoder: 'libx264',
			audio: null,
			audioEncoder: null,
			pixelFormat: 'yuv420p',
		},
		inputs: [],
		segments: [
			{ kind: 'black', color: 'black', durationSeconds: 5 },
		],
		filterPlan: { audio: { strategy: 'none' } },
	};
}

function videoEffect(id, type, params, enabled = true) {
	return { id, type, enabled, params };
}
