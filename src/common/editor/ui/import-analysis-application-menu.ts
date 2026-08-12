/* SPDX-License-Identifier: AGPL-3.0-only */

interface MenuContext {
	readonly productId: string;
	readonly copy: Record<string, string>;
	readonly snapshot: (Readonly<Record<string, unknown>> & {
		readonly analysisRepeatable?: boolean;
		readonly generators?: Readonly<{ readonly canRepeatLast?: boolean }>;
	}) | null;
	readonly editBlocked: boolean;
	readonly blocked: boolean;
	readonly analyzerBlocked: boolean;
	readonly actionRuntime: Readonly<{
		readonly generators: Readonly<{ repeatLast(): unknown }>;
		readonly analysis: Readonly<{ repeatLast(): unknown }>;
		readonly io: Readonly<{ importRawData(): unknown }>;
		readonly timelineAnnotations: Readonly<{ openRegularInterval(): unknown }>;
	}> | null;
}

const NO_ACTION = () => undefined;

export function createRepeatGeneratorMenuItem(context: MenuContext) {
	return {
		id: 'repeat-generator', label: context.copy.repeatLastGenerator,
		disabled: context.editBlocked || !context.snapshot?.generators?.canRepeatLast,
		onClick: context.actionRuntime?.generators.repeatLast ?? NO_ACTION,
	};
}

export function createRepeatAnalyzerMenuItem(context: MenuContext) {
	return {
		id: 'repeat-analyzer', label: context.copy.repeatLastAnalyzer,
		disabled: context.analyzerBlocked || !context.snapshot?.analysisRepeatable,
		onClick: context.actionRuntime?.analysis.repeatLast ?? NO_ACTION,
	};
}

export function createImportAnalysisToolMenuItems(context: MenuContext) {
	if (context.productId !== 'soundscaper') return [];
	return [
		{
			id: 'raw-data-import', label: context.copy.audacityParityLabelImportRawData,
			disabled: context.blocked, onClick: context.actionRuntime?.io.importRawData ?? NO_ACTION,
		},
		{
			id: 'regular-interval-labels', label: context.copy.regularIntervalLabels,
			disabled: context.editBlocked, onClick: context.actionRuntime?.timelineAnnotations.openRegularInterval ?? NO_ACTION,
		},
	];
}
