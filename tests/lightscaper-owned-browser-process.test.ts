/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	classifyOwnedBrowserProcessV1,
	killAndJoinOwnedBrowserProcessV1,
	parseLinuxBrowserProcessStatV1,
} from './browser/helpers/lightscaper-owned-browser-process.ts';
import { readOriginalProcessCrashPrefixNativeV1, recoverOriginalProcessCrashNativeV1 } from './helpers/lightscaper-original-process-crash-native-v1.ts';

type BrowserName = 'chromium' | 'firefox';
interface ProcessRow {
	pid: number;
	parentPid: number;
	processGroupId: number;
	state: string;
	startTicks: string;
	executablePath: string | null;
	argv: string[] | null;
}
interface ClassificationRequest {
	browserName: BrowserName;
	profilePath: string;
	executablePath: string;
	owner: { pid: number; startTicks: string };
	processes: ProcessRow[];
}

const OWNER_PID = 810;
const BROWSER_PID = 820;
const OWNER_START = '900719925474099312345';
const BROWSER_START = '900719925474099312349';
const PROFILE = '/tmp/lightscaper-owned-browser-profile';

function fixture(browserName: BrowserName = 'chromium'): ClassificationRequest {
	const executablePath = browserName === 'chromium' ? '/opt/playwright/chromium/headless_shell' : '/opt/playwright/firefox/firefox';
	const profile = browserName === 'chromium' ? [`--user-data-dir=${PROFILE}`] : ['-profile', PROFILE];
	return {
		browserName, profilePath: PROFILE, executablePath,
		owner: { pid: OWNER_PID, startTicks: OWNER_START },
		processes: [
			{ pid: OWNER_PID, parentPid: 1, processGroupId: OWNER_PID, state: 'S', startTicks: OWNER_START,
				executablePath: '/opt/node/bin/node', argv: ['node', 'owned-playwright-test.js'] },
			{ pid: BROWSER_PID, parentPid: OWNER_PID, processGroupId: BROWSER_PID, state: 'S', startTicks: BROWSER_START,
				executablePath, argv: [executablePath, ...profile, '--headless'] },
		],
	};
}

function browserRow(request: ClassificationRequest): ProcessRow { return request.processes[1]!; }

function expected(request: ClassificationRequest) {
	return { schemaVersion: 1, browserName: request.browserName, profilePath: request.profilePath,
		executablePath: request.executablePath, ownerPid: OWNER_PID, ownerStartTicks: OWNER_START,
		browserPid: BROWSER_PID, browserStartTicks: BROWSER_START, processGroupId: BROWSER_PID };
}

function stat(overrides: Readonly<{ pid?: number; command?: string; state?: string; parentPid?: string; group?: string; start?: string }> = {}): string {
	const fields = Array.from({ length: 50 }, () => '0');
	fields[0] = overrides.state ?? 'S'; fields[1] = overrides.parentPid ?? String(OWNER_PID);
	fields[2] = overrides.group ?? String(BROWSER_PID); fields[19] = overrides.start ?? BROWSER_START;
	return `${overrides.pid ?? BROWSER_PID} (${overrides.command ?? 'headless shell ) child'}) ${fields.join(' ')}`;
}

test('Light owned browser stat retains exact start ticks and parses a command containing spaces and parentheses', () => {
	const value = parseLinuxBrowserProcessStatV1(BROWSER_PID, stat());
	assert.deepEqual(value, { pid: BROWSER_PID, parentPid: OWNER_PID, processGroupId: BROWSER_PID, state: 'S', startTicks: BROWSER_START });
	assert.equal(Object.isFrozen(value), true);
	assert.notEqual(BROWSER_START, String(Number(BROWSER_START)));
});

test('Light owned browser stat refuses malformed fields and a different PID before supplying identity', () => {
	const invalid = [
		'', '820 headless_shell S 810 820', '820 (unterminated S 810 820', '820 (short) S 810 820',
		stat({ pid: BROWSER_PID + 1 }), stat({ state: 'SS' }), stat({ state: '?' }),
		stat({ parentPid: '-1' }), stat({ parentPid: '810x' }), stat({ group: '-1' }),
		stat({ group: '820.5' }), stat({ start: '0' }), stat({ start: '-1' }),
		stat({ start: '01' }), stat({ start: '1.5' }), stat({ start: '1e6' }),
	];
	for (const text of invalid) assert.throws(() => parseLinuxBrowserProcessStatV1(BROWSER_PID, text), TypeError, text);
	for (const pid of [0, -1, 820.5, Number.MAX_SAFE_INTEGER + 1]) {
		assert.throws(() => parseLinuxBrowserProcessStatV1(pid, stat()), TypeError);
	}
});

for (const browserName of ['chromium', 'firefox'] as const) {
	test(`Light owned ${browserName} classification binds the exact profile, executable, owner and group leader`, () => {
		const request = fixture(browserName), value = classifyOwnedBrowserProcessV1(request);
		assert.deepEqual(value, expected(request)); assert.equal(Object.isFrozen(value), true);
		const detached = structuredClone(value);
		browserRow(request).startTicks = '99'; request.owner.startTicks = '88';
		assert.deepEqual(value, detached, 'The admitted scalar identity must not track later input mutation.');
	});

	test(`Light owned ${browserName} classification treats spaces in a profile as part of one exact argument`, () => {
		const request = fixture(browserName); request.profilePath = `${PROFILE} with spaces`;
		browserRow(request).argv = browserName === 'chromium'
			? [request.executablePath, `--user-data-dir=${request.profilePath}`]
			: [request.executablePath, '-profile', request.profilePath];
		assert.deepEqual(classifyOwnedBrowserProcessV1(request), expected(request));
	});
}

test('Light Chromium profile classification rejects near paths, duplicate tokens and alternate syntax', () => {
	const invalid = [
		[`--user-data-dir=${PROFILE}-other`], [`--user-data-dir=${PROFILE}/child`],
		[`--user-data-dir=/prefix${PROFILE}`], [`--user-data-dir=${PROFILE}/../other`],
		[`--user-data-dir=${PROFILE}`, `--user-data-dir=${PROFILE}`],
		[`--user-data-dir=${PROFILE}`, '--user-data-dir=/tmp/other'],
		['--user-data-dir', PROFILE], [`--USER-DATA-DIR=${PROFILE}`],
		['-profile', PROFILE], [`--other=--user-data-dir=${PROFILE}`], [],
	];
	for (const argv of invalid) {
		const request = fixture(); browserRow(request).argv = [request.executablePath, ...argv];
		assert.throws(() => classifyOwnedBrowserProcessV1(request), TypeError, JSON.stringify(argv));
	}
});

test('Light Firefox profile classification rejects duplicate, misplaced and lookalike arguments', () => {
	const invalid = [
		['-profile', `${PROFILE}-other`], ['-profile', `${PROFILE}/child`],
		['-profile', PROFILE, '-profile', PROFILE], ['-profile', PROFILE, '-profile', '/tmp/other'],
		[`-profile=${PROFILE}`], ['--profile', PROFILE], ['-Profile', PROFILE],
		['-profile', '--headless', PROFILE], [PROFILE, '-profile'], ['-profile'],
		[`--user-data-dir=${PROFILE}`], [],
	];
	for (const argv of invalid) {
		const request = fixture('firefox'); browserRow(request).argv = [request.executablePath, ...argv];
		assert.throws(() => classifyOwnedBrowserProcessV1(request), TypeError, JSON.stringify(argv));
	}
});

test('Light owned browser classification never borrows a near-profile process or unrelated missing evidence', () => {
	const request = fixture();
	request.processes.push({ ...browserRow(request), pid: 830, processGroupId: 830, startTicks: '44',
		argv: [request.executablePath, `--user-data-dir=${PROFILE}-user-browser`] });
	request.processes.push({ pid: 840, parentPid: 1, processGroupId: 840, state: 'S', startTicks: '45', executablePath: null, argv: null });
	assert.deepEqual(classifyOwnedBrowserProcessV1(request), expected(request));
});

test('Light native inventory accepts unrelated Linux group-zero rows while refusing a group-zero browser', () => {
	assert.deepEqual(parseLinuxBrowserProcessStatV1(2, stat({ pid: 2, parentPid: '1', group: '0', start: '5' })),
		{ pid: 2, parentPid: 1, processGroupId: 0, state: 'S', startTicks: '5' });
	const request = fixture();
	request.processes.push({ pid: 2, parentPid: 1, processGroupId: 0, state: 'S', startTicks: '5', executablePath: null, argv: null });
	assert.deepEqual(classifyOwnedBrowserProcessV1(request), expected(request));
	browserRow(request).processGroupId = 0;
	assert.throws(() => classifyOwnedBrowserProcessV1(request), TypeError);
});

test('Light Chromium classification admits its observed single native process title with exact tokens', () => {
	const request = fixture();
	browserRow(request).argv = [`${request.executablePath} --headless --user-data-dir=${PROFILE} --remote-debugging-pipe about:blank`];
	assert.deepEqual(classifyOwnedBrowserProcessV1(request), expected(request));
});

test('Light native process title never borrows ambiguous, duplicate or near-profile tokens', () => {
	const executablePath = fixture().executablePath;
	for (const title of [
		`${executablePath} --user-data-dir=${PROFILE}-other`, `${executablePath} --user-data-dir=${PROFILE}/child`,
		`${executablePath} --user-data-dir=${PROFILE} --user-data-dir=${PROFILE}`,
		`${executablePath} --user-data-dir=${PROFILE} --user-data-dir=/tmp/other`,
		`${executablePath} --other=--user-data-dir=${PROFILE}`, `${executablePath} --user-data-dir ${PROFILE}`,
		`${executablePath}  --user-data-dir=${PROFILE}`, ` ${executablePath} --user-data-dir=${PROFILE}`,
		`${executablePath} --user-data-dir=${PROFILE} `, `${executablePath}\t--user-data-dir=${PROFILE}`,
		`${executablePath} --user-data-dir=${PROFILE}\n`, `/other${executablePath} --user-data-dir=${PROFILE}`,
	]) {
		const request = fixture(); browserRow(request).argv = [title];
		assert.throws(() => classifyOwnedBrowserProcessV1(request), TypeError);
	}
	for (const spaced of [true, false]) {
		const request = fixture();
		if (spaced) request.profilePath += ' with spaces'; else request.executablePath += ' with spaces';
		browserRow(request).executablePath = request.executablePath;
		browserRow(request).argv = [`${request.executablePath} --user-data-dir=${request.profilePath}`];
		assert.throws(() => classifyOwnedBrowserProcessV1(request), TypeError);
	}
	const firefox = fixture('firefox'); browserRow(firefox).argv = [`${firefox.executablePath} -profile ${PROFILE}`];
	assert.throws(() => classifyOwnedBrowserProcessV1(firefox), TypeError);
});

test('Light owned browser classification refuses two exact native candidates instead of choosing the first', () => {
	for (const browserName of ['chromium', 'firefox'] as const) {
		const request = fixture(browserName);
		request.processes.push({ ...browserRow(request), pid: 830, processGroupId: 830, startTicks: '44' });
		assert.throws(() => classifyOwnedBrowserProcessV1(request), TypeError);
		request.processes.reverse(); assert.throws(() => classifyOwnedBrowserProcessV1(request), TypeError);
	}
});

test('Light owned browser classification refuses missing, dead or reused owner identities', () => {
	for (const change of [
		(request: ClassificationRequest) => { request.processes.shift(); },
		(request: ClassificationRequest) => { request.processes[0]!.startTicks = '900719925474099312346'; },
		(request: ClassificationRequest) => { request.processes[0]!.state = 'Z'; },
		(request: ClassificationRequest) => { request.owner.pid = BROWSER_PID; },
	]) {
		const request = fixture(); change(request); assert.throws(() => classifyOwnedBrowserProcessV1(request), TypeError);
	}
});

test('Light owned browser classification refuses a grandchild, foreign parent or nonleader process group', () => {
	for (const parentPid of [1, BROWSER_PID, 830]) {
		const request = fixture(); browserRow(request).parentPid = parentPid;
		request.processes.push({ pid: 830, parentPid: OWNER_PID, processGroupId: 830, state: 'S', startTicks: '22',
			executablePath: '/opt/node/bin/node', argv: ['node', 'unrelated-child.js'] });
		assert.throws(() => classifyOwnedBrowserProcessV1(request), TypeError);
	}
	const request = fixture(); browserRow(request).processGroupId = OWNER_PID;
	assert.throws(() => classifyOwnedBrowserProcessV1(request), TypeError);
});

test('Light owned browser classification requires actual executable and argument evidence for its candidate', () => {
	for (const executablePath of [null, '/usr/bin/headless_shell', '/opt/playwright/chromium/headless_shell-other', '/opt/playwright/chromium/../chromium/headless_shell']) {
		const request = fixture(); browserRow(request).executablePath = executablePath;
		assert.throws(() => classifyOwnedBrowserProcessV1(request), TypeError);
	}
	const request = fixture(); browserRow(request).argv = null;
	assert.throws(() => classifyOwnedBrowserProcessV1(request), TypeError);
	const dead = fixture(); browserRow(dead).state = 'Z';
	assert.throws(() => classifyOwnedBrowserProcessV1(dead), TypeError);
});

test('Light owned browser classifier rejects duplicate PIDs even when the duplicate appears unrelated', () => {
	for (const pid of [OWNER_PID, BROWSER_PID]) {
		const request = fixture(); request.processes.push({ pid, parentPid: 1, processGroupId: pid, state: 'S',
			startTicks: '12', executablePath: null, argv: null });
		assert.throws(() => classifyOwnedBrowserProcessV1(request), TypeError);
	}
});

test('Light owned browser classifier retains the full 4096-row inventory and refuses a 4097th row', () => {
	const request = fixture();
	for (let index = 0; index < 4094; index++) {
		request.processes.push({ pid: 3000 + index, parentPid: 1, processGroupId: 3000 + index, state: 'S',
			startTicks: String(index + 1), executablePath: null, argv: null });
	}
	assert.equal(request.processes.length, 4096);
	assert.deepEqual(classifyOwnedBrowserProcessV1(request), expected(request));
	request.processes.push({ pid: 9000, parentPid: OWNER_PID, processGroupId: 9000, state: 'S', startTicks: '555',
		executablePath: request.executablePath, argv: [...browserRow(request).argv!] });
	assert.throws(() => classifyOwnedBrowserProcessV1(request), TypeError, 'Overflow must refuse the whole inventory rather than select a 4096-row prefix.');
});

test('Light owned browser classifier rejects noncanonical paths and malformed closed scalar records', () => {
	for (const profilePath of ['relative/profile', '/tmp//profile', '/tmp/../profile', `${PROFILE}/`, `${PROFILE}\u0000suffix`]) {
		const request = fixture(); request.profilePath = profilePath;
		browserRow(request).argv = [request.executablePath, `--user-data-dir=${profilePath}`];
		assert.throws(() => classifyOwnedBrowserProcessV1(request), TypeError);
	}
	for (const malformed of [
		{ ...fixture(), browserName: 'webkit' }, { ...fixture(), extra: true },
		{ ...fixture(), owner: { pid: OWNER_PID, startTicks: OWNER_START, extra: true } },
		{ ...fixture(), owner: { pid: OWNER_PID, startTicks: Number(OWNER_START) } },
		{ ...fixture(), executablePath: 'headless_shell' },
		{ ...fixture(), processes: [] }, { ...fixture(), processes: [null] },
	]) assert.throws(() => classifyOwnedBrowserProcessV1(malformed), TypeError);
});

test('Light owned browser classifier refuses accessors without invoking their supplied authority', () => {
	let reads = 0;
	const input = fixture();
	Object.defineProperty(input.owner, 'startTicks', { enumerable: true, get() { reads++; return OWNER_START; } });
	assert.throws(() => classifyOwnedBrowserProcessV1(input), TypeError); assert.equal(reads, 0);
	const rowInput = fixture();
	Object.defineProperty(browserRow(rowInput), 'argv', { enumerable: true, get() { reads++; return [`--user-data-dir=${PROFILE}`]; } });
	assert.throws(() => classifyOwnedBrowserProcessV1(rowInput), TypeError); assert.equal(reads, 0);
	const revoked = Proxy.revocable({}, {}); revoked.revoke();
	assert.throws(() => classifyOwnedBrowserProcessV1(revoked.proxy), TypeError);
});

test('Light owned browser classifier rejects sparse inventory and malformed process identity fields', () => {
	const sparse = fixture(); sparse.processes.length = 3;
	assert.throws(() => classifyOwnedBrowserProcessV1(sparse), TypeError);
	for (const fields of [
		{ pid: 820.5 }, { parentPid: -1 }, { processGroupId: -1 }, { startTicks: '01' },
		{ startTicks: '900719925474099312349x' }, { startTicks: 123 }, { state: '?' }, { extra: true },
	]) {
		const request = fixture(); Object.assign(browserRow(request), fields);
		assert.throws(() => classifyOwnedBrowserProcessV1(request), TypeError);
	}
});

test('Light owned browser scalar facts, clones and fabricated identities never authorize browser termination', async () => {
	const request = fixture(), facts = classifyOwnedBrowserProcessV1(request);
	const revoked = Proxy.revocable({}, {}); revoked.revoke();
	let browserReads = 0;
	const browser = {
		get isConnected(): () => boolean { browserReads++; throw new Error('An unissued identity read a browser.'); },
		get once(): () => never { browserReads++; throw new Error('An unissued identity read a browser event port.'); },
		get off(): () => never { browserReads++; throw new Error('An unissued identity read a browser event cleanup port.'); },
	};
	let identityReads = 0;
	const fabricated = Object.defineProperty({}, 'browserPid', { get() { identityReads++; return BROWSER_PID; } });
	for (const identity of [facts, structuredClone(facts), { ...facts }, Object.freeze({ browserPid: BROWSER_PID }), fabricated, revoked.proxy, null]) {
		await assert.rejects(killAndJoinOwnedBrowserProcessV1(identity, browser), TypeError);
	}
	assert.equal(browserReads, 0, 'Only the native capture owner may issue process termination authority.');
	assert.equal(identityReads, 0, 'An unissued identity must refuse before inspecting its claimed PID.');
	const browserProxy = Proxy.revocable(browser, {}); browserProxy.revoke();
	await assert.rejects(killAndJoinOwnedBrowserProcessV1(facts, browserProxy.proxy), TypeError);
});

for (const inspect of [readOriginalProcessCrashPrefixNativeV1, recoverOriginalProcessCrashNativeV1]) {
	test(`Light native crash ${inspect.name} rejects invalid receipts before native storage or companion access`, async () => {
		let nativeReads = 0, receiptReads = 0;
		const names = ['indexedDB', '__assertNativeOpfsWorkerExecution'];
		const originals = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
		const validShape = () => ({ schemaVersion: 1, identity: { catalogId: 'catalog', donorPhotoId: 'donor', unrootedSourceId: 'unrooted',
			currentSourceId: 'current', currentPath: 'current.blob' }, baseline: { stateJson: '{}' }, prefix: { stateJson: '{}' }, native: {} });
		const accessor = validShape(); Object.defineProperty(accessor.identity, 'catalogId', { enumerable: true, get() { receiptReads++; return 'catalog'; } });
		const invalid = [undefined, {}, { ...validShape(), schemaVersion: 2 }, { ...validShape(), extra: true }, accessor,
			{ ...validShape(), identity: { ...validShape().identity, currentPath: null } },
			{ ...validShape(), identity: { ...validShape().identity, currentPath: '' } },
			{ ...validShape(), identity: { ...validShape().identity, currentPath: 'a'.repeat(257) } },
			{ ...validShape(), prefix: { stateJson: 'a'.repeat(262_145) } }];
		try {
			for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, get() { nativeReads++; throw new Error('Unexpected native access.'); } });
			for (const receipt of invalid) await assert.rejects(inspect(receipt), Error);
			assert.equal(nativeReads, 0); assert.equal(receiptReads, 0);
		} finally {
			for (let index = 0; index < names.length; index++) {
				const previous = originals[index];
				if (previous) Object.defineProperty(globalThis, names[index]!, previous); else Reflect.deleteProperty(globalThis, names[index]!);
			}
		}
	});
}
