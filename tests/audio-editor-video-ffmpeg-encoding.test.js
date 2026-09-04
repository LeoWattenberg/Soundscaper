import test from 'node:test';
import assert from 'node:assert/strict';
import {
	FfmpegVideoEncodingError,
	MockVideoFfmpegRuntime,
	buildVideoFfmpegArgs,
	createEditorFfmpeg,
	encoderArgs,
	presentedMp4Plan,
	silentMp4Plan,
	waitFor,
	webmPlan,
	useMockVideoFfmpegRuntime,
} from './helpers/audio-editor-video-ffmpeg-harness.js';

useMockVideoFfmpegRuntime();

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

test('a presented input states its decode and closes the residual once', () => {
	const plan = presentedMp4Plan();
	const args = buildVideoFfmpegArgs(plan, {
		videoInputPaths: { shared: '/stage/rotated.mp4' },
	}, 'output.mp4');

	assert.deepEqual(args.slice(0, 4), ['-autorotate', '1', '-i', '/stage/rotated.mp4']);
	const graph = args[args.indexOf('-filter_complex') + 1];
	assert.ok(graph.startsWith(
		'[0:v:0]scale=w=24:h=64,setsar=1[video_input_0_presented];'
		+ '[video_input_0_presented]split=3',
	), graph);
	assert.equal(graph.includes('[0:v:0]trim'), false, 'no clip may read the unpresented input');
});

test('a version-5 input without a residual still states the decode it was planned against', () => {
	const plan = presentedMp4Plan();
	plan.inputs[0].presentation = null;
	const args = buildVideoFfmpegArgs(plan, {
		videoInputPaths: { shared: '/stage/rotated.mp4' },
	}, 'output.mp4');
	assert.deepEqual(args.slice(0, 4), ['-autorotate', '1', '-i', '/stage/rotated.mp4']);
	assert.ok(args[args.indexOf('-filter_complex') + 1].startsWith('[0:v:0]split=3'));
});

test('an older plan version is presented exactly as its decoder decodes it', () => {
	const plan = presentedMp4Plan();
	plan.version = 2;
	const args = buildVideoFfmpegArgs(plan, {
		videoInputPaths: { shared: '/stage/rotated.mp4' },
	}, 'output.mp4');
	assert.deepEqual(args.slice(0, 2), ['-i', '/stage/rotated.mp4']);
	assert.equal(args[args.indexOf('-filter_complex') + 1].includes('_presented'), false);
});

test('a presentation that would double-apply or apply nothing is rejected', () => {
	const withPresentation = (presentation) => {
		const plan = presentedMp4Plan();
		plan.inputs[0].presentation = presentation;
		return () => buildVideoFfmpegArgs(plan, { videoInputPaths: { shared: '/stage/a.mp4' } }, 'out.mp4');
	};
	const base = {
		autorotate: true,
		sampleAspect: { num: 2, den: 1 },
		decodedWidth: 24,
		decodedHeight: 32,
		scaledWidth: 24,
		scaledHeight: 64,
	};
	assert.throws(withPresentation({ ...base, autorotate: false }), /autorotate must be true/);
	assert.throws(withPresentation({ ...base, scaledHeight: 32 }), /must state a stretch/);
	assert.throws(withPresentation({ ...base, sampleAspect: null }), /sampleAspect\.num/);
	assert.throws(withPresentation({ ...base, scaledWidth: 0 }), /scaledWidth must be a positive safe integer/);
});
