/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createDesktopSmokeProjectFoundation } from '../../desktop/project-library-smoke-project.js';
import {
	packagedExecutableCandidates,
	resolveSmokeArchitecture,
} from './desktop-smoke.mjs';

export const DESKTOP_PROJECT_LIBRARY_HANDOFF_MODE = 'project-library-handoff-v1';
export const DESKTOP_PROJECT_LIBRARY_HANDOFF_OUTPUT_PREFIX = 'SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_SMOKE ';
export const DESKTOP_PROJECT_LIBRARY_HANDOFF_AGGREGATE_PREFIX = 'SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_HANDOFF ';
export const DESKTOP_PROJECT_LIBRARY_HANDOFF_PROJECT_ID = 'packaged-project-library-handoff';
export const MAX_DESKTOP_PROJECT_LIBRARY_HANDOFF_PLAN_BYTES = 64 * 1024;

const MAXIMUM_CHILD_OUTPUT_BYTES = 1024 * 1024;
const MAXIMUM_AGGREGATE_BYTES = 64 * 1024;
const CHILD_TIMEOUT_MS = 30_000;
const CREATED_AT = '2026-07-30T12:00:01.000Z';
const HANDOFF_TIMELINE_ANNOTATIONS = Object.freeze([
	Object.freeze({
		id: 'packaged-handoff-marker',
		sequenceId: 'main-sequence',
		name: 'Shared marker',
		color: 'violet',
		batchId: 'packaged-handoff-batch',
		opaqueExtensions: Object.freeze({}),
		kind: 'marker',
		anchor: 'sample',
		positionFrame: 24_000,
	}),
	Object.freeze({
		id: 'packaged-handoff-region',
		sequenceId: 'main-sequence',
		name: 'Shared region',
		color: 'violet',
		batchId: 'packaged-handoff-batch',
		opaqueExtensions: Object.freeze({}),
		kind: 'region',
		anchor: 'musical',
		startBeat: Object.freeze({ num: 2, den: 1 }),
		endBeat: Object.freeze({ num: 4, den: 1 }),
	}),
]);
const STAGE_DEFINITIONS = Object.freeze([
	Object.freeze({
		stage: 'publish',
		productId: 'soundscaper',
		profileId: 'soundscaper',
		revision: 1,
		title: 'Packaged handoff published in Soundscaper',
	}),
	Object.freeze({
		stage: 'advance',
		productId: 'framescaper',
		profileId: 'framescaper',
		revision: 2,
		title: 'Packaged handoff advanced in Framescaper',
	}),
	Object.freeze({
		stage: 'return',
		productId: 'soundscaper',
		profileId: 'soundscaper',
		revision: 3,
		title: 'Packaged handoff returned to Soundscaper',
	}),
]);

const HANDOFF_STAGES = createStages();

export function createDesktopProjectLibraryHandoffStages() {
	return HANDOFF_STAGES;
}

export function encodeDesktopProjectLibraryHandoffPlan(value) {
	const encoded = Buffer.from(canonicalJson(value), 'utf8').toString('base64url');
	if (Buffer.byteLength(encoded, 'utf8') > MAX_DESKTOP_PROJECT_LIBRARY_HANDOFF_PLAN_BYTES) {
		throw new RangeError('Desktop project-library handoff plan exceeds the 64 KiB command-line limit');
	}
	return encoded;
}

export function decodeDesktopProjectLibraryHandoffPlan(value) {
	if (typeof value !== 'string' || !value || !/^[A-Za-z0-9_-]+$/u.test(value)) {
		throw new TypeError('Desktop project-library handoff plan must be canonical base64url');
	}
	if (Buffer.byteLength(value, 'utf8') > MAX_DESKTOP_PROJECT_LIBRARY_HANDOFF_PLAN_BYTES) {
		throw new RangeError('Desktop project-library handoff plan exceeds the 64 KiB command-line limit');
	}
	let plan;
	try {
		plan = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
	} catch (error) {
		throw new TypeError('Desktop project-library handoff plan is not valid base64url JSON', { cause: error });
	}
	validateHandoffPlan(plan);
	if (encodeDesktopProjectLibraryHandoffPlan(plan) !== value) {
		throw new TypeError('Desktop project-library handoff plan is not canonical base64url JSON');
	}
	return deepFreeze(plan);
}

export function createDesktopProjectLibraryHandoffInvocations({
	arch,
	outputRoot,
	platform,
	profileRoot,
}) {
	const targetArch = resolveSmokeArchitecture(arch, arch);
	const output = absolutePath(outputRoot, 'package output root');
	const profile = absolutePath(profileRoot, 'profile root');
	const sharedAppDataPath = resolve(profile, 'application-data');
	return Object.freeze(HANDOFF_STAGES.map((fixture) => {
		const userDataPath = resolve(profile, 'profiles', fixture.profileId);
		const encodedPlan = encodeDesktopProjectLibraryHandoffPlan(fixture.plan);
		const productName = fixture.productId === 'framescaper' ? 'Framescaper' : 'Soundscaper';
		const executableCandidates = packagedExecutableCandidates({
			arch: targetArch,
			outputRoot: resolve(output, fixture.productId),
			platform,
			productId: fixture.productId,
			productName,
		});
		return deepFreeze({
			stage: fixture.stage,
			productId: fixture.productId,
			plan: fixture.plan,
			encodedPlan,
			userDataPath,
			sharedAppDataPath,
			executableCandidates,
			appArguments: [
				`--user-data-dir=${userDataPath}`,
				'--soundscaper-smoke',
				`--soundscaper-smoke-mode=${DESKTOP_PROJECT_LIBRARY_HANDOFF_MODE}`,
				`--soundscaper-smoke-plan=${encodedPlan}`,
				`--soundscaper-smoke-app-data=${sharedAppDataPath}`,
			],
		});
	}));
}

export function parseDesktopProjectLibraryHandoffOutput(output, invocation) {
	if (typeof output !== 'string') throw new TypeError('Packaged handoff child output must be text');
	if (Buffer.byteLength(output, 'utf8') > MAXIMUM_CHILD_OUTPUT_BYTES) {
		throw new RangeError('Packaged handoff child output exceeds its 1 MiB limit');
	}
	validateInvocation(invocation);
	const matches = output.split(/\r?\n/u)
		.filter((line) => line.startsWith(DESKTOP_PROJECT_LIBRARY_HANDOFF_OUTPUT_PREFIX));
	if (matches.length !== 1) {
		throw new Error('Packaged handoff child must emit exactly one project-library smoke result');
	}
	let payload;
	try {
		payload = JSON.parse(matches[0].slice(DESKTOP_PROJECT_LIBRARY_HANDOFF_OUTPUT_PREFIX.length));
	} catch (error) {
		throw new TypeError('Packaged handoff child emitted invalid result JSON', { cause: error });
	}
	validateOutputPayload(payload, invocation);
	return deepFreeze(payload);
}

export function validateDesktopProjectLibraryHandoffResults(results) {
	if (!Array.isArray(results) || results.length !== HANDOFF_STAGES.length) {
		throw new TypeError('Packaged handoff requires exactly three sequential stage results');
	}
	let fencingToken = 0;
	let catalogRevision = -1;
	for (const [index, result] of results.entries()) {
		const fixture = HANDOFF_STAGES[index];
		validateOutputPayload(result, { ...fixture, plan: fixture.plan });
		if (result.host.fencingToken <= fencingToken) {
			throw new Error('Packaged handoff fencing tokens must strictly increase');
		}
		if (result.catalogRevision <= catalogRevision) {
			throw new Error('Packaged handoff catalog revisions must strictly increase');
		}
		fencingToken = result.host.fencingToken;
		catalogRevision = result.catalogRevision;
	}
	return results;
}

export function createDesktopProjectLibraryHandoffAggregate(results) {
	validateDesktopProjectLibraryHandoffResults(results);
	const final = results.at(-1);
	return deepFreeze({
		schemaVersion: 1,
		mode: DESKTOP_PROJECT_LIBRARY_HANDOFF_MODE,
		project: final.project,
		catalogRevision: final.catalogRevision,
		stages: results.map((result) => ({
			stage: result.stage,
			productId: result.productId,
			fencingToken: result.host.fencingToken,
			catalogRevision: result.catalogRevision,
		})),
	});
}

export function formatDesktopProjectLibraryHandoffAggregate(aggregate) {
	const line = `${DESKTOP_PROJECT_LIBRARY_HANDOFF_AGGREGATE_PREFIX}${canonicalJson(aggregate)}`;
	if (Buffer.byteLength(line, 'utf8') > MAXIMUM_AGGREGATE_BYTES) {
		throw new RangeError('Packaged handoff aggregate exceeds its 64 KiB output limit');
	}
	return line;
}

export async function runDesktopProjectLibraryHandoffSmoke({
	repositoryRoot,
	arch = process.env.SOUNDSCAPER_SMOKE_ARCH || process.arch,
	platform = process.platform,
	environment = process.env,
	outputRoot = resolve(repositoryRoot, 'release/desktop-handoff'),
} = {}) {
	const root = absolutePath(repositoryRoot, 'repository root');
	const profileRoot = await mkdtemp(join(tmpdir(), 'scape-project-library-handoff-'));
	try {
		const invocations = createDesktopProjectLibraryHandoffInvocations({
			arch,
			outputRoot,
			platform,
			profileRoot,
		});
		const results = [];
		for (const invocation of invocations) {
			const executable = await findPackagedExecutable(invocation);
			const useXvfb = platform === 'linux' && environment.SOUNDSCAPER_SMOKE_XVFB === 'true';
			const command = useXvfb ? 'xvfb-run' : executable;
			const args = useXvfb
				? ['-a', executable, ...invocation.appArguments]
				: invocation.appArguments;
			const childEnvironment = { ...environment };
			delete childEnvironment.ELECTRON_RUN_AS_NODE;
			delete childEnvironment.SCAPE_PRODUCT;
			const child = await runBoundedChild(command, args, {
				cwd: root,
				environment: childEnvironment,
			});
			if (child.code !== 0) {
				throw new Error(
					`Packaged ${invocation.productId} ${invocation.stage} handoff exited with code ${String(child.code)}.\n${child.output}`,
				);
			}
			results.push(parseDesktopProjectLibraryHandoffOutput(child.output, invocation));
		}
		return createDesktopProjectLibraryHandoffAggregate(results);
	} finally {
		await rm(profileRoot, { recursive: true, force: true });
	}
}

function createStages() {
	let previous = null;
	return Object.freeze(STAGE_DEFINITIONS.map((definition) => {
		const document = createSourceFreeProjectDocument(definition);
		const target = deepFreeze({
			id: DESKTOP_PROJECT_LIBRARY_HANDOFF_PROJECT_ID,
			title: definition.title,
			revision: definition.revision,
			sha256: sha256(document),
			document,
		});
		const plan = deepFreeze({
			schemaVersion: 1,
			mode: DESKTOP_PROJECT_LIBRARY_HANDOFF_MODE,
			stage: definition.stage,
			productId: definition.productId,
			previous,
			target,
		});
		const fixture = deepFreeze({ ...definition, previous, target, plan });
		previous = descriptorWithoutDocument(target);
		return fixture;
	}));
}

function createSourceFreeProjectDocument({ revision, title }) {
	const updatedAt = `2026-07-30T12:00:0${String(revision)}.000Z`;
	return JSON.stringify({
		...createDesktopSmokeProjectFoundation([]),
		timelineAnnotations: HANDOFF_TIMELINE_ANNOTATIONS,
		id: DESKTOP_PROJECT_LIBRARY_HANDOFF_PROJECT_ID,
		title,
		revision,
		createdAt: CREATED_AT,
		updatedAt,
		sampleRate: 48_000,
		masterChannels: 2,
		tempo: { bpm: 120, timeSignature: { numerator: 4, denominator: 4 }, detected: false },
		snap: { enabled: false, unit: 'seconds', mode: 'nearest', triplets: false, division: 'seconds', opaqueType: 0 },
		timeDisplay: { format: 'hh:mm:ss+milliseconds' },
		metadata: { title, artist: '', album: '', trackNumber: '', year: '', comments: '', tags: {}, bext: null, adm: null },
		selection: {
			startFrame: 0,
			endFrame: 0,
			trackIds: [],
			clipIds: [],
			annotationIds: [],
			frequencyRange: null,
		},
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		view: {
			scrollFrame: 0,
			pixelsPerSecond: 100,
			playheadFrame: 0,
			zoom: 100,
			horizontalPosition: 0,
			verticalPosition: 0,
			selectedTrackIds: [],
			panelState: {},
		},
		sources: [],
		clips: [],
		tracks: [],
		master: { gain: 1, pan: 0, mute: false, solo: false, envelope: [], collapsed: true, effectsActive: true, effects: [] },
		mixer: { groups: [], sends: [], routes: {} },
		opaqueExtensions: {},
		projectBin: { clips: [] },
		featureRequirements: { schemaVersion: 2, requirements: [{
			id: 'soundscaper.timeline-annotations',
			featureId: 'org.soundscaper.capability.timeline-annotations',
			displayName: 'Timeline markers and regions',
			disposition: 'bypass',
			fallback: null,
		}] },
	});
}

function validateHandoffPlan(plan) {
	assertPlainRecord(plan, 'handoff plan');
	assertExactKeys(plan, ['schemaVersion', 'mode', 'stage', 'productId', 'previous', 'target'], 'handoff plan');
	if (plan.schemaVersion !== 1 || plan.mode !== DESKTOP_PROJECT_LIBRARY_HANDOFF_MODE) {
		throw new TypeError('Desktop project-library handoff plan has an unsupported schema or mode');
	}
	const fixture = HANDOFF_STAGES.find(({ stage }) => stage === plan.stage);
	if (!fixture || plan.productId !== fixture.productId) {
		throw new TypeError('Desktop project-library handoff plan has an invalid stage product');
	}
	if (canonicalJson(plan.previous) !== canonicalJson(fixture.previous)
		|| canonicalJson(plan.target) !== canonicalJson(fixture.target)) {
		throw new TypeError('Desktop project-library handoff plan does not match the fixed fixture');
	}
}

function validateInvocation(invocation) {
	assertPlainRecord(invocation, 'handoff invocation');
	const fixture = HANDOFF_STAGES.find(({ stage }) => stage === invocation.stage);
	if (!fixture || invocation.productId !== fixture.productId
		|| canonicalJson(invocation.plan) !== canonicalJson(fixture.plan)) {
		throw new TypeError('Packaged handoff invocation does not match a fixed stage');
	}
}

function validateOutputPayload(payload, invocation) {
	assertPlainRecord(payload, 'handoff result');
	assertExactKeys(payload, [
		'schemaVersion', 'mode', 'stage', 'productId', 'project', 'summary', 'host',
		'preferredProduct', 'catalogRevision',
	], 'handoff result');
	if (payload.schemaVersion !== 1 || payload.mode !== DESKTOP_PROJECT_LIBRARY_HANDOFF_MODE) {
		throw new TypeError('Packaged handoff result has an unsupported schema or mode');
	}
	if (payload.stage !== invocation.stage) throw new Error('Packaged handoff result stage is incorrect');
	if (payload.productId !== invocation.productId) throw new Error('Packaged handoff result product is incorrect');
	const target = descriptorWithoutDocument(invocation.plan.target);
	assertPlainRecord(payload.project, 'handoff result project');
	assertExactKeys(payload.project, ['id', 'title', 'revision', 'sha256'], 'handoff result project');
	if (canonicalJson(payload.project) !== canonicalJson(target)) {
		throw new Error('Packaged handoff result project is incorrect');
	}
	assertPlainRecord(payload.summary, 'handoff result summary');
	assertExactKeys(payload.summary, ['id', 'title', 'revision'], 'handoff result summary');
	const summary = { id: target.id, title: target.title, revision: target.revision };
	if (canonicalJson(payload.summary) !== canonicalJson(summary)) {
		throw new Error('Packaged handoff result summary is incorrect');
	}
	assertPlainRecord(payload.host, 'handoff result host');
	assertExactKeys(payload.host, ['owner', 'fencingToken', 'tookOverStaleLease', 'recovery'], 'handoff result host');
	assertPlainRecord(payload.host.owner, 'handoff result host owner');
	assertExactKeys(payload.host.owner, ['product'], 'handoff result host owner');
	if (payload.host.owner.product !== invocation.productId) {
		throw new Error('Packaged handoff result host owner is incorrect');
	}
	if (!Number.isSafeInteger(payload.host.fencingToken) || payload.host.fencingToken < 1) {
		throw new RangeError('Packaged handoff result fencing token is invalid');
	}
	if (payload.host.tookOverStaleLease !== false) {
		throw new Error('Packaged handoff result used stale takeover');
	}
	assertPlainRecord(payload.host.recovery, 'handoff result recovery');
	assertExactKeys(payload.host.recovery, ['outcome'], 'handoff result recovery');
	if (payload.host.recovery.outcome !== 'clean') {
		throw new Error('Packaged handoff result recovery is not clean');
	}
	if (payload.preferredProduct !== invocation.productId) {
		throw new Error('Packaged handoff result preferred product is incorrect');
	}
	if (!Number.isSafeInteger(payload.catalogRevision) || payload.catalogRevision < 0) {
		throw new RangeError('Packaged handoff result catalog revision is invalid');
	}
}

async function findPackagedExecutable(invocation) {
	for (const candidate of invocation.executableCandidates) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Try the next electron-builder output convention.
		}
	}
	throw new Error(`No packaged ${invocation.productId} executable was found for the handoff smoke`);
}

function runBoundedChild(command, args, { cwd, environment }) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, {
			cwd,
			env: environment,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let output = '';
		let failure = null;
		let settled = false;
		const append = (chunk) => {
			if (failure) return;
			output += String(chunk);
			if (Buffer.byteLength(output, 'utf8') <= MAXIMUM_CHILD_OUTPUT_BYTES) return;
			failure = new RangeError('Packaged handoff child output exceeds its 1 MiB limit');
			child.kill();
		};
		child.stdout.on('data', append);
		child.stderr.on('data', append);
		let timeout;
		child.once('error', (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			reject(error);
		});
		timeout = setTimeout(() => {
			failure = new Error('Packaged handoff child timed out after 30 seconds');
			child.kill();
		}, CHILD_TIMEOUT_MS);
		child.once('exit', (code, signal) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (failure) return reject(failure);
			if (signal) return reject(new Error(`Packaged handoff child exited with signal ${signal}`));
			resolvePromise({ code, output });
		});
	});
}

function descriptorWithoutDocument(target) {
	return deepFreeze({
		id: target.id,
		title: target.title,
		revision: target.revision,
		sha256: target.sha256,
	});
}

function canonicalJson(value, active = new Set()) {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new TypeError('Canonical handoff JSON requires finite numbers');
		return JSON.stringify(value);
	}
	if (!value || typeof value !== 'object') throw new TypeError('Canonical handoff JSON contains an unsupported value');
	if (active.has(value)) throw new TypeError('Canonical handoff JSON cannot contain cycles');
	active.add(value);
	try {
		if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, active)).join(',')}]`;
		if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
			throw new TypeError('Canonical handoff JSON requires plain objects');
		}
		return `{${Object.keys(value).sort().map((key) => (
			`${JSON.stringify(key)}:${canonicalJson(value[key], active)}`
		)).join(',')}}`;
	} finally {
		active.delete(value);
	}
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function absolutePath(value, label) {
	if (typeof value !== 'string' || !value || value.includes('\0')) {
		throw new TypeError(`Desktop project-library handoff ${label} is required`);
	}
	const path = resolve(value);
	if (path !== value) throw new TypeError(`Desktop project-library handoff ${label} must be absolute`);
	return path;
}

function assertPlainRecord(value, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`Desktop project-library ${label} must be a plain object`);
	}
}

function assertExactKeys(value, expected, label) {
	const actual = Object.keys(value).sort();
	const normalized = [...expected].sort();
	if (canonicalJson(actual) !== canonicalJson(normalized)) {
		throw new TypeError(`Desktop project-library ${label} has unexpected fields`);
	}
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) deepFreeze(child);
	return value;
}
