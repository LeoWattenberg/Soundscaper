/* SPDX-License-Identifier: AGPL-3.0-only */

import { constants, copyFileSync, lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface ArtifactCompilation {
	readonly arguments: readonly string[];
	readonly outputPath: string;
	readonly label: string;
}

interface ExecutableCompilation {
	readonly sources: readonly string[];
	readonly arguments: readonly string[];
	readonly objectArguments?: readonly string[];
	readonly linkArguments?: readonly string[];
	readonly outputPath: string;
	readonly label: string;
}

interface NativeFixtureCompilerOptions {
	readonly directory: string;
	readonly invoke: (arguments_: readonly string[], label: string) => void;
}

/** A compiler scope belongs to one fresh fixture directory and one toolchain. */
export function createNativeFixtureCompiler(options: NativeFixtureCompilerOptions) {
	let objectIndex = 0;
	const builtArtifacts = new Map<string, string>();
	const builtObjects = new Map<string, string>();
	function artifact(compilation: ArtifactCompilation): string {
		const identity = JSON.stringify(compilation.arguments);
		const previous = builtArtifacts.get(compilation.outputPath);
		if (previous !== undefined) {
			if (previous !== identity) throw new Error(`Native fixture artifact ${compilation.outputPath} has a different compilation.`);
			return compilation.outputPath;
		}
		options.invoke([...compilation.arguments, '-o', compilation.outputPath], compilation.label);
		builtArtifacts.set(compilation.outputPath, identity);
		return compilation.outputPath;
	}

	function executable(compilation: ExecutableCompilation): string {
		const objects = compilation.sources.map((source) => {
			const arguments_ = [...compilation.arguments, ...compilation.objectArguments ?? [], '-c', source];
			const identity = JSON.stringify(arguments_);
			const previous = builtObjects.get(identity);
			if (previous !== undefined) return previous;
			const outputPath = join(options.directory, `fixture-object-${objectIndex++}.o`);
			artifact({
				arguments: arguments_,
				outputPath,
				label: `${compilation.label} object ${source}`,
			});
			builtObjects.set(identity, outputPath);
			return outputPath;
		});
		return artifact({
			arguments: [...compilation.arguments, ...objects, ...compilation.linkArguments ?? []],
			outputPath: compilation.outputPath,
			label: compilation.label,
		});
	}

	return Object.freeze({ artifact, executable });
}

/** Delay fixture artifacts until a case uses them; a failed build stays retryable. */
export function lazyNativeFixtureValue<Value>(create: () => Value): () => Value {
	let built = false;
	let value: Value;
	return () => {
		if (!built) {
			value = create();
			built = true;
		}
		return value;
	};
}

interface PrivateNativeFixtureArtifactOptions {
	readonly prefix: string;
	readonly fileName: string;
	readonly build: (outputPath: string) => void;
}

/** Compile once per suite, but give every case a private executable and scratch tree. */
export function createPrivateNativeFixtureArtifact(options: PrivateNativeFixtureArtifactOptions) {
	let compiled: { directory: string; path: string } | undefined;
	function source(): string {
		if (compiled !== undefined) return compiled.path;
		const directory = mkdtempSync(join(tmpdir(), options.prefix));
		const path = join(directory, options.fileName);
		try {
			options.build(path);
			if (!lstatSync(path).isFile()) throw new TypeError('Native fixture compilation must produce a regular artifact.');
			compiled = { directory, path };
			return path;
		} catch (error) {
			rmSync(directory, { recursive: true, force: true });
			throw error;
		}
	}
	return Object.freeze({
		copyTo(outputPath: string): string {
			copyFileSync(source(), outputPath, constants.COPYFILE_EXCL);
			return outputPath;
		},
		cleanup(): void {
			if (compiled === undefined) return;
			rmSync(compiled.directory, { recursive: true, force: true });
			compiled = undefined;
		},
	});
}
