/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../commands/protocol.ts';
import {
	createRegularIntervalAnnotationCommand,
	type RegularIntervalAnnotationOptions,
} from './regular-interval-annotation-service.ts';

interface Dependencies {
	readonly getProject: () => Parameters<typeof createRegularIntervalAnnotationCommand>[0];
	readonly editingBlocked: () => boolean;
	readonly createId: (prefix: string) => string;
	readonly commit: (command: AudioEditorCommand) => unknown;
}

export function createRegularIntervalAnnotationController(dependencies: Dependencies) {
	return Object.freeze({
		create(options: RegularIntervalAnnotationOptions): readonly string[] | null {
			if (dependencies.editingBlocked()) return null;
			const plan = createRegularIntervalAnnotationCommand(
				dependencies.getProject(), options, dependencies.createId,
			);
			dependencies.commit(plan.command);
			return plan.annotationIds;
		},
	});
}
