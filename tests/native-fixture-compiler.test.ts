/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
	createNativeFixtureCompiler,
	createPrivateNativeFixtureArtifact,
	lazyNativeFixtureValue,
} from './helpers/native-fixture-compiler.ts';

function fixture(directory = '/fixture') {
	const commands: { arguments: readonly string[]; label: string }[] = [];
	const compiler = createNativeFixtureCompiler({
		directory,
		invoke(arguments_, label) { commands.push({ arguments: [...arguments_], label }); },
	});
	return { compiler, commands };
}

function executable(outputPath: string, entry: string, flags = ['-DFIXTURE=1']) {
	return {
		arguments: ['-std=c++20', ...flags],
		objectArguments: ['-pthread'],
		linkArguments: ['-ldl', '-pthread'],
		sources: ['/source/common.cpp', entry],
		outputPath,
		label: 'native executable',
	};
}

test('native fixture executables reuse common objects with their complete compilation flags', () => {
	const { compiler, commands } = fixture();
	compiler.executable(executable('/fixture/scanner', '/source/scanner.cpp'));
	compiler.executable(executable('/fixture/runtime', '/source/runtime.cpp'));
	const objects = commands.filter(({ arguments: args }) => args.includes('-c'));
	assert.equal(objects.length, 3);
	assert.deepEqual(objects.map(({ arguments: args }) => args[args.indexOf('-c') + 1]), [
		'/source/common.cpp', '/source/scanner.cpp', '/source/runtime.cpp',
	]);
	assert.equal(objects.every(({ arguments: args }) => args.includes('-DFIXTURE=1') && args.includes('-pthread')), true);
	const links = commands.filter(({ arguments: args }) => !args.includes('-c'));
	assert.equal(links.length, 2);
	assert.equal(links[0]?.arguments.includes(join('/fixture', 'fixture-object-0.o')), true);
	assert.equal(links[1]?.arguments.includes(join('/fixture', 'fixture-object-0.o')), true);
	assert.deepEqual(links[1]?.arguments.slice(-4), ['-ldl', '-pthread', '-o', '/fixture/runtime']);
});

test('native fixture compilation isolates macro, include and object flags', () => {
	const { compiler, commands } = fixture();
	compiler.executable(executable('/fixture/normal', '/source/entry.cpp'));
	compiler.executable(executable('/fixture/blocked', '/source/entry.cpp', []));
	compiler.executable(executable('/fixture/include', '/source/entry.cpp', ['-DFIXTURE=1', '-I', '/other']));
	compiler.executable({ ...executable('/fixture/threadless', '/source/entry.cpp'), objectArguments: [] });
	assert.equal(commands.filter(({ arguments: args }) => args.includes('-c')).length, 8);
});

test('a completed artifact compiles once and conflicting output arguments fail', () => {
	const { compiler, commands } = fixture();
	const request = { arguments: ['-shared', '-fPIC', '/source/plugin.cpp'], outputPath: '/fixture/plugin.so', label: 'plugin' };
	assert.equal(compiler.artifact(request), request.outputPath);
	assert.equal(compiler.artifact(request), request.outputPath);
	assert.equal(commands.length, 1);
	assert.throws(() => compiler.artifact({ ...request, arguments: ['-shared', '/other.cpp'] }), /different compilation/u);
});

test('failed compilation is retried and never marks an object or artifact complete', () => {
	let fail = true;
	const commands: (readonly string[])[] = [];
	const compiler = createNativeFixtureCompiler({
		directory: '/fixture',
		invoke(arguments_) {
			commands.push([...arguments_]);
			if (fail) { fail = false; throw new Error('compiler failure'); }
		},
	});
	const request = executable('/fixture/runtime', '/source/runtime.cpp');
	assert.throws(() => compiler.executable(request), /compiler failure/u);
	compiler.executable(request);
	compiler.executable(request);
	assert.equal(commands.length, 4);
	assert.equal(commands.filter((args) => args.includes('/source/common.cpp')).length, 2);
});

test('separate native fixture compiler invocations have no shared object or artifact cache', () => {
	for (const directory of ['/first', '/second']) {
		const { compiler, commands } = fixture(directory);
		const request = executable(join(directory, 'runtime'), '/source/runtime.cpp');
		compiler.executable(request);
		assert.equal(commands.length, 3);
		assert.equal(commands[0]?.arguments.includes(join(directory, 'fixture-object-0.o')), true);
	}
});

test('lazy native fixture values build only when used and retry a failed build', () => {
	let builds = 0;
	const artifact = { path: '/fixture/plugin.so' };
	const value = lazyNativeFixtureValue(() => {
		builds += 1;
		if (builds === 1) throw new Error('compiler failure');
		return artifact;
	});
	assert.equal(builds, 0);
	assert.throws(value, /compiler failure/u);
	assert.equal(value(), artifact);
	assert.equal(value(), artifact);
	assert.equal(builds, 2);
});

test('private native artifacts compile once and preserve executable modes without sharing inodes', (context) => {
	const directory = mkdtempSync(join(tmpdir(), 'native-fixture-copies-test-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	let builds = 0;
	let source = '';
	const fixture = createPrivateNativeFixtureArtifact({
		prefix: 'native-fixture-template-test-', fileName: 'program',
		build(outputPath) { builds += 1; source = outputPath; writeFileSync(outputPath, 'original', { mode: 0o755 }); },
	});
	context.after(() => fixture.cleanup());
	assert.equal(builds, 0);
	const first = fixture.copyTo(join(directory, 'first'));
	writeFileSync(first, 'changed');
	const second = fixture.copyTo(join(directory, 'second'));
	assert.equal(builds, 1);
	assert.equal(readFileSync(second, 'utf8'), 'original');
	assert.equal(readFileSync(source, 'utf8'), 'original');
	assert.equal(statSync(second).mode & 0o777, statSync(source).mode & 0o777);
	if (statSync(first).ino !== 0) {
		assert.notEqual(statSync(first).ino, statSync(second).ino);
		assert.notEqual(statSync(source).ino, statSync(second).ino);
	}
	fixture.cleanup();
	fixture.cleanup();
	assert.equal(existsSync(dirname(source)), false);
	fixture.copyTo(join(directory, 'third'));
	assert.equal(builds, 2, 'a new invocation after cleanup cannot reuse a deleted artifact');
});

test('failed native artifact compilation removes partial builds and remains retryable', (context) => {
	const directory = mkdtempSync(join(tmpdir(), 'native-fixture-failure-test-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	let builds = 0;
	let source = '';
	const fixture = createPrivateNativeFixtureArtifact({
		prefix: 'native-fixture-failed-template-test-', fileName: 'program',
		build(outputPath) {
			builds += 1; source = outputPath; writeFileSync(outputPath, 'partial');
			if (builds === 1) throw new Error('compiler failure');
		},
	});
	context.after(() => fixture.cleanup());
	assert.throws(() => fixture.copyTo(join(directory, 'first')), /compiler failure/u);
	assert.equal(existsSync(dirname(source)), false);
	assert.equal(fixture.copyTo(join(directory, 'first')), join(directory, 'first'));
	assert.equal(builds, 2);
});

test('private native artifact copies refuse overwrites and preserve the compiled fixture on copy failure', (context) => {
	const directory = mkdtempSync(join(tmpdir(), 'native-fixture-overwrite-test-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	let builds = 0;
	const fixture = createPrivateNativeFixtureArtifact({
		prefix: 'native-fixture-overwrite-template-test-', fileName: 'program',
		build(outputPath) { builds += 1; writeFileSync(outputPath, 'compiled'); },
	});
	context.after(() => fixture.cleanup());
	writeFileSync(join(directory, 'occupied'), 'private case data');
	assert.throws(() => fixture.copyTo(join(directory, 'occupied')), { code: 'EEXIST' });
	assert.equal(readFileSync(join(directory, 'occupied'), 'utf8'), 'private case data');
	fixture.copyTo(join(directory, 'available'));
	assert.equal(builds, 1);
});

test('private native artifact scopes with the same names never share compiled bytes', (context) => {
	const directory = mkdtempSync(join(tmpdir(), 'native-fixture-scopes-test-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	for (const content of ['first compiler', 'second compiler']) {
		const fixture = createPrivateNativeFixtureArtifact({
			prefix: 'native-fixture-same-template-test-', fileName: 'program',
			build(outputPath) { writeFileSync(outputPath, content); },
		});
		context.after(() => fixture.cleanup());
		assert.equal(readFileSync(fixture.copyTo(join(directory, content)), 'utf8'), content);
	}
});
