/* SPDX-License-Identifier: AGPL-3.0-only */
// @ts-check

/**
 * What a macro program's worker looks like before the program's first statement.
 *
 * This file is inlined verbatim into the worker a program becomes, so it has no
 * imports and nothing to resolve. It runs first and does three things: it takes
 * the worker's ambient capabilities away, it replaces the sources of
 * nondeterminism with reproducible ones, and it hands the program the only
 * channel it has left.
 *
 * The capability reduction is defence in depth, not the security boundary. The
 * boundary is the host's dispatch table and its admission of every value; this
 * is what makes the program's own reach obviously small rather than merely
 * checked. It is written as an allowlist because a denylist is a negative claim
 * about a namespace that differs between three engines and changes under us.
 */

const MACRO_GLOBAL_ALLOWLIST = new Set([
	'globalThis', 'undefined', 'NaN', 'Infinity',
	'Object', 'Array', 'Function', 'Boolean', 'Number', 'String', 'Symbol', 'BigInt',
	'Math', 'JSON', 'Date', 'RegExp', 'Promise', 'Proxy', 'Reflect',
	'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry',
	'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
	'EvalError', 'URIError', 'AggregateError',
	'ArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
	'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
	'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
	'TextEncoder', 'TextDecoder', 'structuredClone', 'queueMicrotask',
	'isNaN', 'isFinite', 'parseInt', 'parseFloat',
	'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
	'Intl', 'console', '__macroBoot',
]);

const post = self.postMessage.bind(self);
const listen = self.addEventListener.bind(self);

let runId = '';
let limits = { maxCalls: 4096, maxMutations: 256, maxLogEntries: 1000, maxLogBytes: 262144 };
let environment = {};
let nextCallId = 0;
let mutations = 0;
let logEntries = 0;
let logBytes = 0;
let logDropped = 0;
let clock = 0;
let randomState = 1;
const pending = new Map();
let booted = null;
let begun = null;

// An error thrown while the module is still being evaluated has nowhere else to
// go: the host would see only an `error` event, which some engines deliver with
// no message at all. Reporting it from inside is what makes a program's own
// mistake readable rather than "the macro could not be compiled".
listen('error', (event) => {
	post({
		protocolVersion: 1,
		type: 'failed',
		runId,
		message: String((event && (event.message || (event.error && event.error.message))) || 'The macro failed.'),
		line: event && Number.isInteger(event.lineno) ? event.lineno : null,
		column: null,
	});
});

listen('unhandledrejection', (event) => {
	const reason = event && event.reason;
	post({
		protocolVersion: 1,
		type: 'failed',
		runId,
		message: String((reason && reason.message) || reason || 'The macro failed.'),
		line: null,
		column: null,
	});
});

listen('message', (event) => {
	const message = event.data;
	if (!message || typeof message !== 'object') return;
	if (message.type === 'begin') {
		runId = String(message.runId || '');
		limits = { ...limits, ...(message.limits || {}) };
		environment = message.env || {};
		randomState = seedFrom(String(environment.seed || runId));
		if (begun) begun();
		return;
	}
	if (message.type !== 'result' && message.type !== 'error') return;
	const settle = pending.get(message.callId);
	if (!settle) return;
	pending.delete(message.callId);
	clock += 1;
	if (message.type === 'result') settle.resolve(message.value);
	else settle.reject(assignCode(new Error(String(message.message || 'The editor refused.')), message.code));
});

/**
 * A program's only way to reach the editor.
 *
 * Every call is a message and a promise. There is no synchronous path, which is
 * what stops a program from holding the editor still while it thinks.
 */
function call(method, ...args) {
	if (nextCallId >= limits.maxCalls) {
		return Promise.reject(new Error(`A macro may ask the editor at most ${limits.maxCalls} times.`));
	}
	if (pending.size >= (limits.maxInflightCalls || 8)) {
		return Promise.reject(new Error('Too many editor calls are already in flight; await them.'));
	}
	const callId = ++nextCallId;
	return new Promise((resolve, reject) => {
		pending.set(callId, { resolve, reject });
		post({ protocolVersion: 1, type: 'call', runId, callId, method, args });
	});
}

function mutating(method) {
	return (...args) => {
		if (mutations >= limits.maxMutations) {
			return Promise.reject(new Error(`A macro may change the project at most ${limits.maxMutations} times.`));
		}
		mutations += 1;
		return call(method, ...args);
	};
}

function log(level, values) {
	if (logEntries >= limits.maxLogEntries || logBytes >= limits.maxLogBytes) {
		logDropped += 1;
		return;
	}
	const text = values.map((value) => stringify(value)).join(' ').slice(0, 4096);
	logEntries += 1;
	logBytes += text.length;
	post({ protocolVersion: 1, type: 'log', runId, entries: [{ level, text, at: clock }] });
}

function stringify(value) {
	if (typeof value === 'string') return value;
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

/** sfc32, so a run can be replayed from the seed printed in its own log. */
function seedFrom(text) {
	let hash = 2166136261;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0 || 1;
}

function nextRandom() {
	randomState ^= randomState << 13;
	randomState ^= randomState >>> 17;
	randomState ^= randomState << 5;
	randomState >>>= 0;
	return randomState / 4294967296;
}

function assignCode(error, code) {
	if (code) Object.defineProperty(error, 'code', { value: code, enumerable: false });
	return error;
}

/**
 * Take the worker's ambient capabilities away.
 *
 * Most of them are accessors on a prototype rather than own properties of the
 * global, so deleting from `self` alone would return true and remove nothing.
 * The whole chain is walked, and each name is replaced by an unconfigurable
 * `undefined` so nothing can put it back.
 */
function reduceCapabilities() {
	for (let holder = globalThis; holder && holder !== Object.prototype; holder = Object.getPrototypeOf(holder)) {
		for (const key of Object.getOwnPropertyNames(holder)) {
			if (MACRO_GLOBAL_ALLOWLIST.has(key)) continue;
			try {
				Object.defineProperty(holder, key, {
					value: undefined, writable: false, configurable: false, enumerable: false,
				});
			} catch {
				// A non-configurable own property cannot be replaced; the allowlist
				// covers the ones that matter and the boundary is the host anyway.
			}
		}
	}
}

/** A virtual clock and a seeded generator, so a run reads the same twice. */
function installDeterminism() {
	const RealDate = Date;
	const virtual = () => clock;
	globalThis.Date = class extends RealDate {
		constructor(...args) {
			if (args.length === 0) super(virtual());
			else super(...args);
		}

		static now() { return virtual(); }
	};
	globalThis.Math.random = nextRandom;
}

function createApi() {
	const api = {
		env: environment,
		log: {
			info: (...values) => log('info', values),
			warn: (...values) => log('warn', values),
			error: (...values) => log('error', values),
		},
		project: {
			snapshot: () => call('project.snapshot'),
			tracks: () => call('project.tracks'),
			clips: (trackId) => call('project.clips', trackId ?? null),
			selection: () => call('project.selection'),
		},
		select: {
			time: (start, end, options) => mutating('select.time')(start, end, options ?? null),
			frames: (startFrame, endFrame, options) => mutating('select.frames')(startFrame, endFrame, options ?? null),
			tracks: (options) => mutating('select.tracks')(options ?? null),
			frequencies: (options) => mutating('select.frequencies')(options ?? null),
			all: () => mutating('select.all')(),
			none: () => mutating('select.none')(),
		},
		effect: mutating('effect.apply'),
		effects: mutating('effect.chain'),
		runSaved: mutating('macro.runSaved'),
		command: mutating('command.run'),
		wait: (milliseconds) => {
			clock += Math.max(0, Math.round(Number(milliseconds) || 0));
			return Promise.resolve();
		},
		random: nextRandom,
		assert(condition, message) {
			if (!condition) throw new Error(String(message || 'A macro assertion failed.'));
		},
		assertEqual(actual, expected, message) {
			const same = JSON.stringify(actual) === JSON.stringify(expected);
			if (!same) {
				throw new Error(String(message
					|| `Expected ${stringify(expected)} but the macro saw ${stringify(actual)}.`));
			}
		},
	};
	api.log.debug = api.log.info;
	return Object.freeze(api);
}

globalThis.__macroBoot = (main) => {
	if (booted) return booted;
	booted = (async () => {
		await new Promise((resolve) => {
			if (runId) resolve();
			else begun = resolve;
		});
		reduceCapabilities();
		installDeterminism();
		const console = {
			log: (...values) => log('info', values),
			info: (...values) => log('info', values),
			warn: (...values) => log('warn', values),
			error: (...values) => log('error', values),
			debug: (...values) => log('info', values),
		};
		globalThis.console = console;
		try {
			await main(createApi());
			if (logDropped) log('warn', [`${logDropped} further messages were dropped.`]);
			post({ protocolVersion: 1, type: 'done', runId, calls: nextCallId });
		} catch (error) {
			post({
				protocolVersion: 1,
				type: 'failed',
				runId,
				message: String((error && error.message) || error || 'The macro failed.'),
				line: lineOf(error),
				column: null,
			});
		}
	})();
	return booted;
};

/**
 * The line of the program that failed, or nothing.
 *
 * A stack begins with the message, which can hold a colon-separated pair of its
 * own — a timecode reads exactly like a position — so only the frames are read.
 * The frame that matters is the program's own body: an error thrown by one of
 * the API's helpers has that helper's line on top, and this file's lines are
 * never the author's. Reporting no line is better than reporting someone
 * else's, so a stack that never entered the program yields nothing.
 */
function lineOf(error) {
	const frames = String((error && error.stack) || '')
		.split('\n')
		.map((entry) => entry.trim())
		// Frames are `at name (url:line:column)` in V8 and `name@url:line:column`
		// elsewhere; a message line matches neither.
		.filter((entry) => /^(?:at\s|\S*@)/u.test(entry) && /:\d+:\d+\)?$/u.test(entry));
	const frame = frames.find((entry) => entry.includes('__macroMain'));
	const match = frame ? /:(\d+):\d+\)?$/u.exec(frame) : null;
	return match ? Number(match[1]) : null;
}
