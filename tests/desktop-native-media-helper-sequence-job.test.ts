/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { FramescaperMediaHostDescriptor } from '../desktop/framescaper-media-host-payload.ts';
import type { HelperDataPlaneBinding } from '../desktop/helper-data-plane.ts';
import { sendHelperDataPlaneFile, type HelperDataPlaneIoPort } from '../desktop/helper-data-plane-io.ts';
import {
	createNativeMediaHelperJobRunner,
	type NativeMediaHostInvocation,
} from '../desktop/native-media-helper-job.ts';
import { createNativeMediaOutputTreeIdentity } from '../desktop/native-media-output-tree.ts';
import { canonicalizeNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { createFramescaperNativeRenderPlanAuthorityV28 } from '../src/framescaper/editor-native-render-plan-authority-v28.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV28 } from '../src/framescaper/editor-project-unified-render-plan-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { framescaperMediaHostDescriptorFixture } from './helpers/framescaper-media-host-descriptor-fixture.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const JOB_ID = 'ab'.repeat(20);
const ROOT_GRANT_ID = 'cd'.repeat(16);

test('the helper seals a native sequence result and returns only its authenticated tree lease', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-helper-sequence-job-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const outputRoot = join(directory, 'output');
	const scratchRoot = join(directory, 'scratch');
	await Promise.all([mkdir(outputRoot), mkdir(scratchRoot)]);
	const descriptor = await mediaHostDescriptor(directory);
	const carrierPath = join(directory, 'carrier.frames');
	const carrierBytes = Buffer.from('evaluated-rgba-carrier');
	await writeFile(carrierPath, carrierBytes);
	const plan = sequencePlan();
	const planBytes = Buffer.from(canonicalizeNativeMediaPlan(plan));
	const planPath = join(directory, 'plan.json');
	await writeFile(planPath, planBytes);
	const planBinding = binding(planBytes);
	const temporaryPath = join(outputRoot, '.sequence.partial');
	const finalPath = join(outputRoot, 'sequence');
	const treeIdentity = createNativeMediaOutputTreeIdentity({
		jobId: JOB_ID, planFingerprint: planBinding.sha256, rootGrantId: ROOT_GRANT_ID,
		relativeDestination: 'sequence',
		sources: plan.sources.map(({ sourceId, contentSha256 }) => ({ sourceId, contentSha256 })),
		profileId: 'encode-png-sequence', frameCount: plan.output.frameCount,
	});
	const invocations: NativeMediaHostInvocation[] = [];
	const runner = createNativeMediaHelperJobRunner({
		descriptor,
		invokeHost: (invocation) => {
			invocations.push(invocation);
			const completion = writeNativeSequence(
				invocation.temporaryOutputPath!, plan.output.frameCount,
			).then((control) => ({ exitCode: 0, stdout: JSON.stringify(control), stderr: '' }));
			return { completion, cancel: async () => undefined };
		},
	});
	const [hostPort, helperPort] = portPair();
	const job = runner.run({
		kind: 'media-render',
		grant: {
			backend: 'native-cpu',
			executable: {
				role: 'ffmpeg', path: descriptor.path, bytes: descriptor.byteLength,
				sha256: descriptor.sha256, identity: descriptor.identity,
			},
			plan: planBinding,
			sources: [{ type: 'file', role: 'evaluated-rgba-frame-pack', path: carrierPath,
				bytes: carrierBytes.byteLength, sha256: digest(carrierBytes), identity: await identity(carrierPath) }],
			output: {
				kind: 'directory', rootPath: outputRoot, rootIdentity: await identity(outputRoot),
				temporaryPath, finalPath, maximumBytes: 1024 * 1024, treeIdentity,
			},
			scratch: { rootPath: scratchRoot, rootIdentity: await identity(scratchRoot),
				reservationId: 'ef'.repeat(20), maximumBytes: 1024 * 1024 },
		},
		ports: [helperPort],
	});
	const [result] = await Promise.all([
		job.completion,
		sendHelperDataPlaneFile({ binding: planBinding, port: hostPort, path: planPath }),
	]);
	const output = (result as Readonly<{ output: Readonly<Record<string, unknown>> }>).output;
	assert.equal(output.kind, 'directory');
	assert.equal(output.temporaryPath, temporaryPath);
	assert.equal(output.sha256, (output.tree as Readonly<{ manifestSha256: string }>).manifestSha256);
	assert.deepEqual((output.tree as Readonly<{ identity: unknown }>).identity, treeIdentity);
	assert.equal((await lstat(temporaryPath)).isDirectory(), true);
	assert.equal(invocations[0]?.operation, 'media-render');
	assert.equal(invocations[0]?.temporaryOutputPath, temporaryPath);
	assert.equal(await missing(join(scratchRoot, 'ef'.repeat(20))), true);
});

async function writeNativeSequence(path: string, frameCount: number) {
	await mkdir(path);
	const frames = [];
	let byteLength = 0;
	for (let ordinal = 0; ordinal < frameCount; ordinal += 1) {
		const fileName = `frame-${String(ordinal).padStart(8, '0')}.png`;
		const bytes = Buffer.from(`png-${String(ordinal)}`);
		await writeFile(join(path, fileName), bytes);
		byteLength += bytes.byteLength;
		frames.push({ ordinal, fileName, byteLength: bytes.byteLength, sha256: digest(bytes) });
	}
	const manifest = Buffer.from(JSON.stringify({
		schemaVersion: 1, profileId: 'encode-png-sequence', frameCount, frames,
	}));
	await writeFile(join(path, 'manifest.json'), manifest);
	byteLength += manifest.byteLength;
	return Object.freeze({
		contractVersion: 1, operation: 'media-render', profileId: 'encode-png-sequence',
		frameCount, byteLength, manifestSha256: digest(manifest), publication: 'temporary-directory',
	});
}

function sequencePlan() {
	const options = framescaperV20Options();
	const project = createFramescaperProjectV28(FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, options);
	const base = createFramescaperProjectUnifiedExactRenderPlanV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, project,
		createFramescaperNativeRenderPlanAuthorityV28(project),
	);
	return {
		...base, format: { container: 'image2', extension: 'png', mimeType: 'image/png' },
		deliveryProfile: 'encode-png-sequence',
		codecs: { video: 'png', videoEncoder: 'png', audio: null,
			audioEncoder: null, pixelFormat: 'rgba64be' },
		output: { ...base.output, canvas: { ...base.output.canvas, pixelFormat: 'rgba64be' },
			includeAudio: false, audioLayout: null },
	};
}

async function mediaHostDescriptor(directory: string): Promise<FramescaperMediaHostDescriptor> {
	const path = join(directory, 'framescaper-media-host');
	const bytes = Buffer.from('synthetic executable');
	await writeFile(path, bytes, { mode: 0o700 });
	return framescaperMediaHostDescriptorFixture({
		target: 'linux-x64', runtime: 'linux-x64', path,
		byteLength: bytes.byteLength, sha256: digest(bytes), identity: await identity(path),
		hostVersion: 'test', ffmpegVersion: '9.0.1',
	});
}

function binding(bytes: Uint8Array): HelperDataPlaneBinding {
	return Object.freeze({
		dataPlaneVersion: 1, transport: 'message-port', streamId: '12'.repeat(20),
		direction: 'host-to-helper', byteLength: bytes.byteLength, sha256: digest(bytes),
		maximumChunkBytes: 4096, maximumInFlightChunks: 1,
	});
}

async function identity(path: string) {
	const details = await lstat(path);
	return Object.freeze({ dev: details.dev, ino: details.ino });
}
async function missing(path: string): Promise<boolean> {
	try { await lstat(path); return false; }
	catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error; }
}
function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

class Port extends EventEmitter implements HelperDataPlaneIoPort {
	peer: Port | null = null;
	readonly pending: unknown[] = [];
	started = false;
	postMessage(message: unknown): void { queueMicrotask(() => this.peer?.accept(message)); }
	start(): void {
		this.started = true;
		for (const message of this.pending.splice(0)) this.emit('message', { data: message });
	}
	close(): void {}
	accept(message: unknown): void {
		if (!this.started) this.pending.push(message);
		else this.emit('message', { data: message });
	}
}

function portPair(): readonly [Port, Port] {
	const left = new Port(); const right = new Port();
	left.peer = right; right.peer = left;
	return [left, right] as const;
}
