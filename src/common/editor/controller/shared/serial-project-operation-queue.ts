/* SPDX-License-Identifier: AGPL-3.0-only */

interface ProjectOperationFence {
	isCurrent(): boolean;
	assertCurrent(): void;
}

/** Serial work shares its own project commits while retaining unrelated-edit and activation fences. */
export function createSerialProjectOperationQueue<Operation extends ProjectOperationFence>(
	capture: () => Operation,
) {
	let scope: Operation | null = null;
	let tail: Promise<unknown> | null = null;
	const run = <Value>(operation: (project: Operation) => Promise<Value>): Promise<Value> => {
		let project: Operation;
		try {
			project = scope?.isCurrent() ? scope : capture();
		} catch (error) {
			return Promise.reject(error);
		}
		scope = project;
		const execute = (): Promise<Value> => {
			project.assertCurrent();
			return operation(project);
		};
		const pending = (tail ?? Promise.resolve()).then(execute, execute);
		tail = pending;
		const clear = (): void => {
			if (tail === pending) { tail = null; scope = null; }
		};
		void pending.then(clear, clear);
		return pending;
	};
	return Object.freeze({
		wrap<Arguments extends unknown[], Value>(
			operation: (project: Operation, ...args: Arguments) => Promise<Value>,
		): (...args: Arguments) => Promise<Value> {
			return (...args) => run((project) => operation(project, ...args));
		},
	});
}
