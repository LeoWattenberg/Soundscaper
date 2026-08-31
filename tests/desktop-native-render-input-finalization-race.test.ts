/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';

import type { HelperDataPlaneIoPort } from '../desktop/helper-data-plane-io.ts';
import { sendHelperDataPlaneFile } from '../desktop/helper-data-plane-io.ts';
import { FramescaperNativeRenderInputStaging } from
	'../desktop/native-services-render-input-staging.ts';
import { createNativeMediaPlanEnvelopeV1 } from
	'../src/common/editor/native-media-plan-envelope.ts';
import { nativeQueueSmallStaticAudioPlanV8 } from './helpers/native-queue-plan-fixture.ts';

const STAGE_ID = 'cd'.repeat(20);
const OWNER = Object.freeze({ generation: 21 });

test('render-input finalization serializes with claims and remains abandonable until claim', async (context) => {
	const first = await receivedStage(context, 'claim');
	await Promise.all([
		first.staging.finalize(OWNER, { stageId: STAGE_ID }),
		first.staging.claim(OWNER, claimRequest(first.envelope)),
	]);

	const second = await receivedStage(context, 'abandon');
	await second.staging.finalize(OWNER, { stageId: STAGE_ID });
	await second.staging.abandon(OWNER, { stageId: STAGE_ID });
	await assert.rejects(access(join(second.root, `stage-${STAGE_ID}`, 'manifest.json')), /ENOENT/iu);

	const third = await receivedStage(context, 'owner-abandon');
	await third.staging.finalize(OWNER, { stageId: STAGE_ID });
	assert.equal(await third.staging.abandonOwner(OWNER), 1);
	await assert.rejects(access(join(third.root, `stage-${STAGE_ID}`, 'manifest.json')), /ENOENT/iu);
});

async function receivedStage(context: test.TestContext, suffix: string) {
	const root = await mkdtemp(join(tmpdir(), `framescaper-finalize-${suffix}-`));
	context.after(() => rm(root, { recursive: true, force: true }));
	const envelope = createNativeMediaPlanEnvelopeV1(nativeQueueSmallStaticAudioPlanV8());
	const audio = float32Wav(1_000, 1_000, 2);
	const source = join(root, 'source.wav');
	await writeFile(source, audio);
	const staging = new FramescaperNativeRenderInputStaging({ root, mintStageId: () => STAGE_ID });
	const admission = await staging.begin(OWNER, beginRequest(envelope, audio));
	const channel = new MessageChannel();
	context.after(() => { channel.port1.close(); channel.port2.close(); });
	const received = staging.receive(OWNER, {
		stageId: STAGE_ID, inputIndex: 0, binding: admission.inputs[0]!.binding,
	}, channel.port2 as unknown as HelperDataPlaneIoPort);
	await sendHelperDataPlaneFile({
		binding: admission.inputs[0]!.binding,
		port: channel.port1 as unknown as HelperDataPlaneIoPort, path: source,
	});
	await received;
	return { root, envelope, staging };
}

function beginRequest(
	envelope: ReturnType<typeof createNativeMediaPlanEnvelopeV1>,
	audio: Uint8Array,
) {
	return Object.freeze({
		stageVersion: 1 as const, schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
		planVersion: 8 as const, planFingerprint: envelope.fingerprint,
		planPayload: JSON.stringify(envelope.plan), projectId: 'project-1', projectRevision: 7,
		inputFingerprints: Object.freeze([{ sourceId: 'source-1', sha256: '12'.repeat(32) }]),
		derivedInputs: Object.freeze([{
			role: 'staged-audio-mix' as const, byteLength: audio.byteLength, sha256: digest(audio),
		}]),
	});
}

function claimRequest(envelope: ReturnType<typeof createNativeMediaPlanEnvelopeV1>) {
	return Object.freeze({
		schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
		derivedInputStageId: STAGE_ID, planVersion: 8 as const,
		planFingerprint: envelope.fingerprint, planPayload: JSON.stringify(envelope.plan),
		projectId: 'project-1', projectRevision: 7,
		inputFingerprints: Object.freeze([{ sourceId: 'source-1', sha256: '12'.repeat(32) }]),
	});
}

function float32Wav(sampleRate: number, frameCount: number, channels: number): Buffer {
	const dataBytes = frameCount * channels * 4;
	const output = Buffer.alloc(44 + dataBytes);
	output.write('RIFF', 0, 'ascii'); output.writeUInt32LE(output.byteLength - 8, 4);
	output.write('WAVEfmt ', 8, 'ascii'); output.writeUInt32LE(16, 16);
	output.writeUInt16LE(3, 20); output.writeUInt16LE(channels, 22);
	output.writeUInt32LE(sampleRate, 24); output.writeUInt32LE(sampleRate * channels * 4, 28);
	output.writeUInt16LE(channels * 4, 32); output.writeUInt16LE(32, 34);
	output.write('data', 36, 'ascii'); output.writeUInt32LE(dataBytes, 40);
	return output;
}

function digest(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}
