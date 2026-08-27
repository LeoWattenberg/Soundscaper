/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	access, chmod, copyFile, mkdir, mkdtemp, readFile, realpath, readdir, rm, stat, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import type {
	FramescaperMediaHostDescriptor,
	FramescaperMediaHostExecutableDescriptor,
} from '../desktop/framescaper-media-host-payload.ts';
import {
	createIsolatedNativeMediaHostProcessInvoker,
} from '../desktop/native-media-isolated-host-process.ts';
import type { HelperDataPlaneByteSink } from '../desktop/helper-data-plane-io.ts';
import type { NativeMediaHostInvocation } from '../desktop/native-media-helper-job.ts';

const ROOT = resolve(import.meta.dirname, '..');
const LAUNCHER_ROOT = join(ROOT, 'native/milestone-5-native-isolation-launcher');
const PROFILE_PATH = join(LAUNCHER_ROOT, 'profiles/linux-v1.json');
const BROKER_PATH = join(LAUNCHER_ROOT, 'profiles/linux-broker-v1.json');
const execute = promisify(execFile);

test('the media invoker uses its machine-authenticated loader closure, fd3, and no-clobber output grant', {
	skip: process.platform !== 'linux' || process.arch !== 'x64',
}, async (context) => {
	const fixture = await isolatedMediaFixture(context);
	const outputPath = join(fixture.outputRoot, 'render.tmp');
	const invocation = mediaInvocation(fixture.descriptor, fixture, outputPath);
	const handle = createIsolatedNativeMediaHostProcessInvoker(fixture.descriptor)(invocation);
	assert.deepEqual(handle.inputs?.map(({ role }) => role), [
		'evaluated-rgba-frame-pack', 'staged-audio-mix',
	]);
	await Promise.all([
		writeInput(handle.inputs![0]!.sink, Buffer.from('video-body')),
		writeInput(handle.inputs![1]!.sink, Buffer.from('audio-body')),
	]);
	const result = await handle.completion;
	assert.equal(result.exitCode, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout), {
		readBackDenied: true, inheritedArtifactsClosed: true,
	});
	assert.equal(String(await readFile(outputPath)), 'video-body|audio-body');

	const duplicate = createIsolatedNativeMediaHostProcessInvoker(fixture.descriptor)(invocation);
	await Promise.all([
		writeInput(duplicate.inputs![0]!.sink, Buffer.from('changed-video')),
		writeInput(duplicate.inputs![1]!.sink, Buffer.from('changed-audio')),
	]);
	assert.notEqual((await duplicate.completion).exitCode, 0);
	assert.equal(String(await readFile(outputPath)), 'video-body|audio-body');
});

test('machine containment refuses changed media bytes before the isolated payload can run', {
	skip: process.platform !== 'linux' || process.arch !== 'x64',
}, async (context) => {
	const fixture = await isolatedMediaFixture(context);
	const changed: FramescaperMediaHostDescriptor = Object.freeze({
		...fixture.descriptor, sha256: 'ff'.repeat(32),
	});
	const outputPath = join(fixture.outputRoot, 'wrong.tmp');
	const handle = createIsolatedNativeMediaHostProcessInvoker(changed)(
		mediaInvocation(changed, fixture, outputPath),
	);
	await assert.rejects(handle.completion, /changed identity, bytes, or digest/iu);
	await assert.rejects(access(outputPath), /ENOENT/u);
});

async function isolatedMediaFixture(context: test.TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-isolated-media-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const runtime = join(root, 'runtime');
	const outputRoot = join(root, 'output');
	const scratchPath = join(root, 'scratch');
	const hostPath = join(root, 'framescaper-media-host');
	const launcherPath = join(root, 'milestone5-native-isolation-launcher');
	const sourcePath = join(root, 'media-host-fixture.c');
	const planPath = join(root, 'plan.json');
	await Promise.all([
		mkdir(runtime), mkdir(outputRoot), mkdir(scratchPath),
		writeFile(sourcePath, MEDIA_HOST_SOURCE), writeFile(planPath, '{}'),
	]);
	await Promise.all([
		execute('cc', ['-std=c17', '-O2', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
			sourcePath, '-o', hostPath]),
		execute('cc', ['-std=c17', '-O2', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
			join(LAUNCHER_ROOT, 'src/linux_launcher.c'), '-o', launcherPath]),
	]);
	await Promise.all([chmod(hostPath, 0o700), chmod(launcherPath, 0o700)]);
	await stageElfClosure(hostPath, runtime);
	const runtimeLibraries = Object.freeze((await Promise.all(
		(await readdir(runtime)).map((name) => descriptor(join(runtime, name))),
	)).sort((left, right) => basename(left.path).localeCompare(basename(right.path), 'en')));
	const [host, launcher, profile, broker] = await Promise.all([
		descriptor(hostPath), descriptor(launcherPath), descriptor(PROFILE_PATH), descriptor(BROKER_PATH),
	]);
	const descriptorValue: FramescaperMediaHostDescriptor = Object.freeze({
		target: 'linux-x64', runtime: 'linux-x64', path: host.path,
		byteLength: host.byteLength, sha256: host.sha256,
		hostVersion: '1.0.0', ffmpegVersion: '9.0.1', identity: host.identity,
		isolation: Object.freeze({ launcher, sandboxProfile: profile, brokerPolicy: broker, runtimeLibraries }),
		m9ReleaseReview: Object.freeze({
			scope: 'stable-1.0-release', status: 'pending',
			detail: 'Human acceptance is intentionally absent from this runtime test.',
		}),
	});
	return { root, outputRoot, scratchPath, planPath: await realpath(planPath), descriptor: descriptorValue };
}

function mediaInvocation(
	descriptorValue: FramescaperMediaHostDescriptor,
	fixture: Awaited<ReturnType<typeof isolatedMediaFixture>>,
	outputPath: string,
): NativeMediaHostInvocation {
	const reservation = (streamId: string, byteLength: number) => Object.freeze({
		dataPlaneVersion: 1 as const, transport: 'message-port' as const, streamId,
		direction: 'host-to-helper' as const, authentication: 'trailer-sha256-v1' as const,
		byteLength, maximumChunkBytes: 16 * 1024 ** 2, maximumInFlightChunks: 1,
	});
	return Object.freeze({
		executablePath: descriptorValue.path, operation: 'media-render',
		plan: Object.freeze({ path: fixture.planPath, sha256: digest(Buffer.from('{}')) }),
		sources: Object.freeze([
			Object.freeze({ path: null, sha256: null, byteLength: 10,
				role: 'evaluated-rgba-frame-pack' as const, liveInput: reservation('11'.repeat(20), 10) }),
			Object.freeze({ path: null, sha256: null, byteLength: 10,
				role: 'staged-audio-mix' as const, liveInput: reservation('22'.repeat(20), 10) }),
		]),
		videoTimingAssets: Object.freeze([]), backend: 'native-cpu', maximumOutputBytes: 1_024,
		scratchPath: fixture.scratchPath, decodeOutputPath: null,
		destinationRoot: fixture.outputRoot, temporaryOutputPath: outputPath,
		proxyRecipe: null, imageSequence: null,
	});
}

async function writeInput(
	sink: HelperDataPlaneByteSink,
	bytes: Buffer,
): Promise<void> {
	await sink.write(bytes);
	await sink.complete();
}

async function stageElfClosure(executable: string, runtime: string): Promise<void> {
	const [{ stdout: programHeaders }, { stdout: dependencies }] = await Promise.all([
		execute('readelf', ['-l', executable]), execute('ldd', [executable]),
	]);
	const interpreter = /Requesting program interpreter:\s*([^\]]+)/u.exec(programHeaders)?.[1];
	if (!interpreter) throw new Error('The dynamic media fixture has no ELF interpreter.');
	const paths = new Set<string>([interpreter]);
	for (const match of dependencies.matchAll(/\/[^\s()]+/gu)) {
		try { await access(match[0]); paths.add(match[0]); } catch { /* virtual dependency */ }
	}
	await Promise.all([...paths].map((path) => copyFile(path, join(runtime, basename(path)))));
	await chmod(join(runtime, basename(interpreter)), 0o700);
}

async function descriptor(path: string): Promise<FramescaperMediaHostExecutableDescriptor> {
	const canonical = await realpath(path);
	const [bytes, metadata] = await Promise.all([readFile(canonical), stat(canonical)]);
	return Object.freeze({
		path: canonical, byteLength: bytes.byteLength, sha256: digest(bytes),
		identity: Object.freeze({ dev: Number(metadata.dev), ino: Number(metadata.ino) }),
	});
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

const MEDIA_HOST_SOURCE = String.raw`
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
static int read_all(int fd, char *bytes, size_t maximum) {
	size_t offset = 0; ssize_t count = 0;
	while ((count = read(fd, bytes + offset, maximum - offset)) > 0) offset += (size_t)count;
	return count == 0 ? (int)offset : -1;
}
int main(int argc, char **argv) {
	const char *output = NULL;
	for (int index = 1; index + 1 < argc; ++index) {
		if (strcmp(argv[index], "--temporary-output") == 0) output = argv[index + 1];
	}
	if (output == NULL) return 64;
	char video[64] = {0}; char audio[64] = {0};
	int video_bytes = read_all(STDIN_FILENO, video, sizeof(video));
	int audio_bytes = read_all(3, audio, sizeof(audio));
	if (video_bytes < 0 || audio_bytes < 0) return 65;
	int file = open(output, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
	if (file < 0) return errno == EEXIST ? 73 : 66;
	if (write(file, video, (size_t)video_bytes) != video_bytes || write(file, "|", 1) != 1
		|| write(file, audio, (size_t)audio_bytes) != audio_bytes || close(file) != 0) return 67;
	int read_back = open(output, O_RDONLY | O_CLOEXEC);
	int read_back_denied = read_back < 0 && (errno == EACCES || errno == EPERM);
	int inherited_closed = 1;
	for (int fd = 4; fd < 64; ++fd) if (fcntl(fd, F_GETFD) >= 0) inherited_closed = 0;
	printf("{\"readBackDenied\":%s,\"inheritedArtifactsClosed\":%s}\n",
		read_back_denied ? "true" : "false",
		inherited_closed ? "true" : "false");
	if (read_back >= 0) close(read_back);
	return 0;
}
`;
