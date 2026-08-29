/* SPDX-License-Identifier: AGPL-3.0-only */

import { useState } from 'react';

import {
	buildLocalDiagnosticsReport,
	createLocalDiagnosticsRuntimeIdentity,
	saveLocalDiagnosticsReport,
	type LocalDiagnosticsReport,
} from '../../local-diagnostics-report.ts';
import type {
	LocalDiagnosticsErrorSnapshot,
	LocalDiagnosticsErrorSource,
} from '../../local-diagnostics-error-journal.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';

type Copy = Readonly<Record<string, string | undefined>>;
type Phase = 'idle' | 'generating' | 'ready' | 'exporting' | 'saved' | 'error';

interface DiagnosticsController {
	getSnapshot(): unknown;
	getLocalDiagnosticsSnapshot(): Readonly<LocalDiagnosticsErrorSnapshot>;
	recordLocalDiagnosticError(error: unknown, source: LocalDiagnosticsErrorSource): void;
}

interface DiagnosticsFileService {
	readonly isDesktop?: boolean;
	getEnvironment?(): PromiseLike<unknown> | unknown;
	saveFile?(request: Readonly<Record<string, unknown>>): PromiseLike<unknown> | unknown;
}

export interface LocalDiagnosticsDialogProps {
	readonly controller: Readonly<DiagnosticsController>;
	readonly copy: Copy;
	readonly fileService: Readonly<DiagnosticsFileService>;
	readonly locale: string;
	readonly productId: string;
	readonly onClose: () => void;
}

export default function LocalDiagnosticsDialog({
	controller, copy, fileService, locale, productId, onClose,
}: LocalDiagnosticsDialogProps) {
	const [report, setReport] = useState<Readonly<LocalDiagnosticsReport> | null>(null);
	const [phase, setPhase] = useState<Phase>('idle');
	const generate = async (): Promise<void> => {
		setPhase('generating');
		try {
			const desktopEnvironment = fileService.isDesktop
				? await fileService.getEnvironment?.() ?? null
				: null;
			const runtime = createLocalDiagnosticsRuntimeIdentity({
				isDesktop: fileService.isDesktop === true,
				locale,
				desktopEnvironment,
				navigator: globalThis.navigator,
			});
			const snapshot = controller.getSnapshot();
			const next = buildLocalDiagnosticsReport({
				generatedAt: new Date().toISOString(),
				applicationVersion: typeof __SCAPE_VERSION__ === 'string' ? __SCAPE_VERSION__ : 'unknown',
				productId,
				runtime,
				capabilities: diagnosticCapabilities(snapshot),
				snapshot,
				diagnostics: controller.getLocalDiagnosticsSnapshot(),
			});
			setReport(next);
			setPhase('ready');
		} catch (error) {
			controller.recordLocalDiagnosticError(error, 'workspace');
			setPhase('error');
		}
	};
	const exportReport = async (): Promise<void> => {
		if (!report) return;
		setPhase('exporting');
		try {
			await saveLocalDiagnosticsReport(report, fileService);
			setPhase('saved');
		} catch (error) {
			controller.recordLocalDiagnosticError(error, 'workspace');
			setPhase('error');
		}
	};
	return <LocalDiagnosticsDialogView
		copy={copy}
		report={report}
		phase={phase}
		onClose={onClose}
		onGenerate={() => { void generate(); }}
		onExport={() => { void exportReport(); }}
	/>;
}

export function LocalDiagnosticsDialogView({
	copy, report, phase, onClose, onGenerate, onExport,
}: Readonly<{
	copy: Copy;
	report: Readonly<LocalDiagnosticsReport> | null;
	phase: Phase;
	onClose: () => void;
	onGenerate: () => void;
	onExport: () => void;
}>) {
	const busy = phase === 'generating' || phase === 'exporting';
	const status = phase === 'saved'
		? text(copy, 'localDiagnosticsSaved', 'The local diagnostic report was exported.')
		: phase === 'error'
			? text(copy, 'localDiagnosticsError', 'The local diagnostic report could not be created or exported.')
			: '';
	return <AudioEditorDialogShell
		title={text(copy, 'localDiagnosticsTitle', 'Local Diagnostics')}
		onClose={onClose}
		initialFocus="[data-local-diagnostics-generate]"
		width={680}
		dataAttributes={{ 'data-local-diagnostics-dialog': 'true' }}
		footer={<div className="kw-audio-editor-dialog__actions">
			<button type="button" onClick={onClose}>{text(copy, 'close', 'Close')}</button>
		</div>}
	>
		<p>{text(copy, 'localDiagnosticsDescription', 'Create a bounded local diagnostic report.')}</p>
		<p>{text(copy, 'localDiagnosticsPrivacy', 'The report stays on this device unless you explicitly export it.')}</p>
		<div className="kw-audio-editor-dialog__actions">
			<button
				type="button"
				data-local-diagnostics-generate="true"
				disabled={busy}
				onClick={onGenerate}
			>{phase === 'generating'
					? text(copy, 'localDiagnosticsGenerating', 'Generating report')
					: text(copy, 'localDiagnosticsGenerate', 'Generate local diagnostic report')}</button>
			{report && <button
				type="button"
				data-local-diagnostics-export="true"
				disabled={busy}
				onClick={onExport}
			>{phase === 'exporting'
					? text(copy, 'localDiagnosticsExporting', 'Exporting report')
					: text(copy, 'localDiagnosticsExport', 'Export local diagnostic report')}</button>}
		</div>
		{report && <ReportSummary copy={copy} report={report} />}
		<div role="status" aria-live="polite" aria-atomic="true">{status}</div>
	</AudioEditorDialogShell>;
}

function ReportSummary({ copy, report }: Readonly<{
	copy: Copy;
	report: Readonly<LocalDiagnosticsReport>;
}>) {
	const available = report.capabilities.filter(({ available: value }) => value).length;
	return <div data-local-diagnostics-summary="true">
		<SummarySection title={text(copy, 'localDiagnosticsVersions', 'Versions')}>
			<p>{format(text(copy, 'localDiagnosticsVersionSummary', '{application}; diagnostics schema {diagnostics}; Scape {scape}.'), {
				application: report.versions.application,
				diagnostics: report.versions.diagnostics,
				scape: report.versions.scapeFormat,
			})}</p>
		</SummarySection>
		<SummarySection title={text(copy, 'localDiagnosticsEnvironment', 'Environment')}>
			<p>{report.environment.kind}; {report.environment.platform}; {report.environment.architecture}; {report.environment.locale}</p>
		</SummarySection>
		<SummarySection title={text(copy, 'localDiagnosticsCapabilities', 'Capabilities')}>
			<p>{format(text(copy, 'localDiagnosticsCapabilitySummary', '{available} of {total} capabilities available.'), {
				available, total: report.capabilities.length,
			})}</p>
		</SummarySection>
		<SummarySection title={text(copy, 'localDiagnosticsErrors', 'Recent typed errors')}>
			<p>{format(text(copy, 'localDiagnosticsErrorSummary', '{count} recent typed errors retained.'), {
				count: report.errors.recent.length,
			})}</p>
		</SummarySection>
		<SummarySection title={text(copy, 'localDiagnosticsStorage', 'Storage and library')}>
			<p>{report.storage.state}; {format(text(
				copy, 'localDiagnosticsLibrarySummary', '{projects} projects in the library; {open} open.',
			), { projects: report.library.projectCount, open: report.library.openProjectCount })}</p>
		</SummarySection>
		<SummarySection title={text(copy, 'localDiagnosticsRecovery', 'Recovery journals')}>
			<p>{report.recovery.takeCycle}; {report.recovery.capture}; {report.recovery.webVcr}; {report.recovery.renderQueue}</p>
		</SummarySection>
	</div>;
}

function SummarySection({ title, children }: Readonly<{
	title: string;
	children: React.ReactNode;
}>) {
	return <section><h3>{title}</h3>{children}</section>;
}

function diagnosticCapabilities(snapshot: unknown): unknown {
	if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return {};
	const descriptor = Object.getOwnPropertyDescriptor(snapshot, 'capabilities');
	return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : {};
}

function text(copy: Copy, key: string, fallback: string): string {
	return copy[key] || fallback;
}

function format(template: string, values: Readonly<Record<string, string | number>>): string {
	return Object.entries(values).reduce(
		(result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
		template,
	);
}
