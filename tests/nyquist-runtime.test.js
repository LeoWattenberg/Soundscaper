import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	NYQUIST_BUNDLED_PLUGINS,
	NYQUIST_MAX_SOURCE_BYTES,
	NYQUIST_MAX_TEXT_BYTES,
	NyquistEvaluationClient,
	buildNyquistEvaluationSource,
	evaluateNyquist,
	loadNyquistWasm,
	loadNyquistPlugin,
	normalizeNyquistRequest,
	normalizeNyquistResult,
} from '../src/lib/tools/audio-editor/nyquist/index.js';

const NYQUIST_WASM_PATH = new URL('../src/lib/tools/audio-editor/nyquist/nyquist.wasm', import.meta.url);

test('Nyquist requests strip Audacity headers and safely bind controls and host properties', () => {
	const source = [
		'$nyquist plug-in',
		'$version 4',
		'$type process',
		'$control GAIN (_ "Gain") real "" 0.5 0 1',
		'',
		'(mult *track* GAIN)',
	].join('\n');
	const prepared = buildNyquistEvaluationSource({
		source,
		language: 'lisp',
		sampleRate: 48_000,
		channels: [Float32Array.of(0.25, -0.25)],
		controls: { GAIN: 0.5, TITLE: 'a "safe" \\ title' },
		properties: {
			AUDACITY: { VERSION: [3, 7, 7] },
			SELECTION: { LOW_HZ: 100, PEAK: { kind: 'vector', values: [0.5, 0.25] } },
		},
		globals: { PREVIEWP: true },
	});
	assert.doesNotMatch(prepared, /^\s*\$(?:nyquist|version|type|control)/m);
	assert.match(prepared, /\(putprop '\*AUDACITY\* \(list 3 7 7\) 'VERSION\)/);
	assert.match(prepared, /\(putprop '\*SELECTION\* \(vector 0\.5 0\.25\) 'PEAK\)/);
	assert.match(prepared, /\(setf \*PREVIEWP\* T\)/);
	assert.match(prepared, /\(setf TITLE "a \\"safe\\" \\\\ title"\)/);
	assert.match(prepared, /\(mult \*track\* GAIN\)/);
	assert.doesNotMatch(buildNyquistEvaluationSource({
		source: '$nyquist plugin\n$type process\n(mult *track* 0.5)',
		sampleRate: 48_000,
		channels: [Float32Array.of(1)],
	}), /\$nyquist/);

	const sal = buildNyquistEvaluationSource({
		source: 'define function main()\n  return 42\nend',
		language: 'sal',
		channels: [],
		sampleRate: 44_100,
		debug: true,
	});
	assert.match(sal, /\(sal-compile-audacity "/);
	assert.match(sal, /set aud:result = main\(\)/);
	assert.match(sal, /\(prog1 aud:result \(setf aud:result NIL\)\)/);
});

test('Nyquist protocol rejects unsafe PCM and validates every result variant', () => {
	assert.throws(() => normalizeNyquistRequest({
		source: '(mult *track* 0.5)',
		channels: [new Float32Array(2), new Float32Array(3)],
	}), /matching frame counts/);
	assert.throws(() => normalizeNyquistRequest({
		source: '(mult *track* 0.5)',
		channels: [Float32Array.of(Number.NaN)],
	}), /non-finite sample/);
	assert.throws(() => normalizeNyquistRequest({
		source: '(mult *track* 0.5)',
		controls: { 'bad name': 1 },
	}), /Invalid Nyquist control name/);

	const audio = normalizeNyquistResult({
		type: 'audio',
		channels: [Float32Array.of(1, 2)],
		sampleRate: 48_000,
		frameCount: 2,
		output: '',
	});
	assert.equal(audio.frameCount, 2);
	assert.deepEqual(normalizeNyquistResult({
		type: 'labels', labels: [{ start: 1, end: 2, text: 'beat' }], output: '',
	}).labels[0], { start: 1, end: 2, text: 'beat' });
	assert.deepEqual(normalizeNyquistResult({
		type: 'number', value: 7, numericType: 'integer', output: '',
	}), { type: 'number', value: 7, numericType: 'integer', output: '' });
	assert.deepEqual(normalizeNyquistResult({
		type: 'message', message: 'done', output: 'trace',
	}), { type: 'message', message: 'done', output: 'trace' });
	assert.throws(() => normalizeNyquistResult({ type: 'audio', channels: [], sampleRate: 48_000 }), /at least one channel/);
});

test('Nyquist request normalization bounds the cumulative encoded Lisp bindings', () => {
	const largeBinding = 'x'.repeat(700_000);
	assert.ok(new TextEncoder().encode(largeBinding).byteLength < NYQUIST_MAX_TEXT_BYTES);
	assert.throws(() => normalizeNyquistRequest({
		source: '42',
		controls: { FIRST: largeBinding, SECOND: largeBinding },
		properties: {
			PROJECT: { NAME: largeBinding },
			TRACK: { NAME: largeBinding },
		},
		globals: { THIRD: largeBinding, FOURTH: largeBinding },
	}), /encoded-Lisp binding\/property budget exceeds/);

	const nestedBinding = 'y'.repeat(900_000);
	assert.throws(() => normalizeNyquistRequest({
		source: '42',
		controls: { CHUNKS: Array(5).fill(nestedBinding) },
	}), /encoded-Lisp binding\/property budget exceeds/);
	assert.ok(NYQUIST_MAX_SOURCE_BYTES > NYQUIST_MAX_TEXT_BYTES);
});

test('Nyquist result normalization bounds aggregate label text bytes', () => {
	const labelText = 'é'.repeat(Math.floor(NYQUIST_MAX_TEXT_BYTES / 4) + 1);
	assert.ok(new TextEncoder().encode(labelText).byteLength < NYQUIST_MAX_TEXT_BYTES);
	assert.throws(() => normalizeNyquistResult({
		type: 'labels',
		labels: [
			{ start: 0, text: labelText },
			{ start: 1, text: labelText },
		],
		output: '',
	}), /aggregate label text exceeds/);
});

test('Nyquist runtime accepts a mockable adapter contract', async () => {
	let received;
	const runtime = {
		async evaluate(request, hooks) {
			received = request;
			hooks.onProgress?.(1);
			return { type: 'number', value: 6.25, numericType: 'double', output: '' };
		},
	};
	const progress = [];
	const result = await evaluateNyquist({
		source: '(sum 1 2)', sampleRate: 44_100, channels: [],
	}, runtime, { onProgress: (value) => progress.push(value) });
	assert.equal(received.language, 'lisp');
	assert.equal(result.value, 6.25);
	assert.deepEqual(progress, [1]);
});

test('Nyquist WASM evaluates Lisp, SAL, PCM, generated audio, and labels', async () => {
	const runtime = await loadNyquistWasm(await readFile(NYQUIST_WASM_PATH));
	const number = await evaluateNyquist({ source: '42', sampleRate: 44_100, channels: [] }, runtime);
	assert.deepEqual(number, { type: 'number', value: 42, numericType: 'integer', output: '' });

	const labels = await evaluateNyquist({
		source: '\'((0.1 "one") (0.2 0.3 "span"))', sampleRate: 44_100, channels: [],
	}, runtime);
	assert.deepEqual(labels.labels, [
		{ start: 0.1, end: 0.1, text: 'one' },
		{ start: 0.2, end: 0.3, text: 'span' },
	]);
	const largeLabelText = 'x'.repeat(Math.floor(NYQUIST_MAX_TEXT_BYTES * 0.6));
	await assert.rejects(evaluateNyquist({
		source: `(let ((text "${largeLabelText}")) (list (list 0 text) (list 1 text)))`,
		sampleRate: 44_100,
		channels: [],
	}, runtime), (error) => error?.code === 'NYQUIST_OUTPUT_LIMIT');

	const processed = await evaluateNyquist({
		source: '(mult *track* 0.5)',
		sampleRate: 44_100,
		channels: [Float32Array.of(1, -0.5, 0.25)],
	}, runtime);
	assert.deepEqual(Array.from(processed.channels[0]), [0.5, -0.25, 0.125]);

	const generated = await evaluateNyquist({
		source: '(osc 60 0.01)', sampleRate: 44_100, channels: [], maxOutputFrames: 2_000,
	}, runtime);
	assert.equal(generated.type, 'audio');
	assert.equal(generated.frameCount, 441);
	assert.ok(generated.channels[0].some((sample) => Math.abs(sample) > 0.01));

	const sal = await evaluateNyquist({
		source: 'return 42', language: 'sal', sampleRate: 44_100, channels: [],
	}, runtime);
	assert.deepEqual(sal, { type: 'number', value: 42, numericType: 'integer', output: '' });
});

test('every bundled Nyquist plug-in evaluates with its default controls', async () => {
	const sampleRate = 8_000;
	const input = Float32Array.from(
		{ length: sampleRate },
		(_, frame) => 0.25 * Math.sin(2 * Math.PI * 220 * frame / sampleRate),
	);
	const runtime = await loadNyquistWasm(await readFile(NYQUIST_WASM_PATH));
	const evaluated = [];
	for (const entry of NYQUIST_BUNDLED_PLUGINS) {
		const plugin = await loadNyquistPlugin(entry.id);
		const controls = Object.fromEntries(plugin.controls
			.filter((control) => control.variable)
			.map((control) => [control.variable, control.defaultValue]));
		const generator = plugin.role === 'generate';
		const selectionTracks = plugin.id === 'nyquist:crossfadeclips' ? [1] : [1, 2];
		const result = await evaluateNyquist({
			source: plugin.source,
			sampleRate,
			channels: generator ? [] : [input],
			controls,
			globals: { PREVIEWP: false },
			maxOutputFrames: sampleRate * (generator ? 45 : 6),
			properties: {
				PROJECT: { RATE: sampleRate, PREVIEW_DURATION: 6 },
				SELECTION: {
					START: 0,
					END: 1,
					TRACKS: selectionTracks,
					LOW_HZ: 100,
					HIGH_HZ: 2_000,
					CENTER_HZ: Math.sqrt(200_000),
					BANDWIDTH: Math.log2(20),
					PEAK: 0.25,
					RMS: 0.25 / Math.sqrt(2),
				},
				TRACK: {
					INDEX: 1,
					NAME: 'Test track',
					CLIPS: [[0, 0.5], [0.5, 1]],
					INCLIPS: [[0, 0.5], [0.5, 1]],
				},
			},
		}, runtime);
		assert.ok(['audio', 'labels', 'message', 'number'].includes(result.type), plugin.id);
		evaluated.push(plugin.id);
	}
	assert.equal(evaluated.length, 25);
});

test('Nyquist worker client validates results, reports progress, and hard-stops cancellation', async () => {
	const workers = [];
	const client = new NyquistEvaluationClient({
		workerFactory() {
			const worker = new FakeWorker();
			workers.push(worker);
			return worker;
		},
		wasmUrl: '/runtime/nyquist.wasm',
		timeoutMs: 5_000,
	});
	try {
		const progress = [];
		const pending = client.evaluate({
			source: '(mult *track* 0.5)',
			sampleRate: 8_000,
			channels: [Float32Array.of(1, 2)],
		}, { onProgress: (value) => progress.push(value) });
		const message = workers[0].messages[0].message;
		assert.equal(message.type, 'evaluate');
		assert.equal(message.wasmUrl, '/runtime/nyquist.wasm');
		workers[0].emit({ type: 'progress', id: message.id, progress: 0.5 });
		workers[0].emit({
			type: 'result',
			id: message.id,
			result: {
				type: 'audio', channels: [Float32Array.of(0.5, 1)], sampleRate: 8_000, frameCount: 2, output: '',
			},
		});
		const result = await pending;
		assert.deepEqual(Array.from(result.channels[0]), [0.5, 1]);
		assert.deepEqual(progress, [0.5]);

		const controller = new AbortController();
		const cancelled = client.evaluate({
			source: '(do () (nil))', sampleRate: 8_000, channels: [],
		}, { signal: controller.signal });
		controller.abort();
		await assert.rejects(cancelled, { name: 'AbortError' });
		assert.equal(workers[0].terminated, true);

		const afterRestart = client.evaluate({ source: '42', sampleRate: 8_000, channels: [] });
		assert.equal(workers.length, 2);
		const restartedMessage = workers[1].messages[0].message;
		workers[1].emit({
			type: 'result', id: restartedMessage.id,
			result: { type: 'number', value: 42, numericType: 'integer', output: '' },
		});
		assert.equal((await afterRestart).value, 42);
	} finally {
		client.dispose();
	}
});

test('Nyquist worker client terminates a non-responsive interpreter at its deadline', async () => {
	const worker = new FakeWorker();
	const client = new NyquistEvaluationClient({ workerFactory: () => worker, timeoutMs: 10 });
	try {
		await assert.rejects(
			client.evaluate({ source: '(do () (nil))', sampleRate: 8_000, channels: [] }),
			(error) => error.name === 'TimeoutError' && error.code === 'NYQUIST_TIMEOUT',
		);
		assert.equal(worker.terminated, true);
	} finally {
		client.dispose();
	}
});

class FakeWorker {
	constructor() {
		this.listeners = new Map();
		this.messages = [];
		this.terminated = false;
	}
	addEventListener(type, listener) { this.listeners.set(type, listener); }
	postMessage(message, transfer = []) { this.messages.push({ message, transfer }); }
	emit(data) { this.listeners.get('message')?.({ data }); }
	terminate() { this.terminated = true; }
}
