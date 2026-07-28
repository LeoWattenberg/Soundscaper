/* SPDX-License-Identifier: AGPL-3.0-only */

type FilterOperation = Readonly<Record<string, unknown>>;

export interface VideoEffectGraphContext {
	readonly filters: string[];
	readonly inputLabel: string;
	readonly outputLabel: string;
	readonly operation: FilterOperation;
	readonly width: number;
	readonly height: number;
}

function numberToken(value: unknown, name: string): string {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new RangeError(`${name} must be finite.`);
	return String(Object.is(number, -0) ? 0 : number);
}

function colorToken(value: unknown): string {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffff) {
		throw new RangeError('Packed video effect color must be a 24-bit integer.');
	}
	return `0x${number.toString(16).padStart(6, '0')}`;
}

function appendPreserveAlpha(
	filters: string[],
	inputLabel: string,
	outputLabel: string,
	expression: string,
): void {
	const color = `${outputLabel}_color`;
	const alphaSource = `${outputLabel}_alpha_source`;
	const alpha = `${outputLabel}_alpha`;
	const filtered = `${outputLabel}_filtered_color`;
	filters.push(`[${inputLabel}]format=pix_fmts=rgba,split=2[${color}][${alphaSource}]`);
	filters.push(`[${alphaSource}]alphaextract[${alpha}]`);
	filters.push(`[${color}]${expression},format=pix_fmts=rgb24[${filtered}]`);
	filters.push(`[${filtered}][${alpha}]alphamerge,format=pix_fmts=rgba,setpts=PTS-STARTPTS[${outputLabel}]`);
}

function appendMultiplyAlphaMatte(context: VideoEffectGraphContext): void {
	const { filters, inputLabel, outputLabel, operation } = context;
	const original = `${outputLabel}_original`;
	const sourceAlphaInput = `${outputLabel}_source_alpha_input`;
	const sourceAlpha = `${outputLabel}_source_alpha`;
	const matteSource = `${outputLabel}_matte_source`;
	const matteAlpha = `${outputLabel}_matte_alpha`;
	const combinedAlpha = `${outputLabel}_combined_alpha`;
	filters.push(
		`[${inputLabel}]format=pix_fmts=rgba,split=3[${original}][${sourceAlphaInput}][${matteSource}]`,
	);
	filters.push(`[${sourceAlphaInput}]alphaextract[${sourceAlpha}]`);
	if (operation.matte === 'chroma-key') {
		filters.push(
			`[${matteSource}]format=pix_fmts=yuva444p,chromakey=color=${colorToken(operation.color)}`
			+ `:similarity=${numberToken(operation.similarity, 'similarity')}`
			+ `:blend=${numberToken(operation.softness, 'softness')},alphaextract[${matteAlpha}]`,
		);
	} else if (operation.matte === 'luma-key') {
		const mode = Number(operation.mode);
		const cutoff = Number(operation.cutoff);
		const center = mode === 0 ? 0 : 1;
		const tolerance = mode === 0 ? cutoff : 1 - cutoff;
		filters.push(
			`[${matteSource}]format=pix_fmts=yuva444p,lumakey=threshold=${center}`
			+ `:tolerance=${numberToken(tolerance, 'tolerance')}`
			+ `:softness=${numberToken(operation.softness, 'softness')},alphaextract[${matteAlpha}]`,
		);
	} else {
		throw new RangeError(`Unsupported video matte operation: ${String(operation.matte)}.`);
	}
	filters.push(`[${sourceAlpha}][${matteAlpha}]blend=all_expr='A*B/255'[${combinedAlpha}]`);
	filters.push(`[${original}]format=pix_fmts=rgb24[${outputLabel}_rgb]`);
	filters.push(`[${outputLabel}_rgb][${combinedAlpha}]alphamerge,format=pix_fmts=rgba[${outputLabel}]`);
}

function appendBloom(context: VideoEffectGraphContext): void {
	const { filters, inputLabel, outputLabel, operation } = context;
	const original = `${outputLabel}_original`;
	const alphaSource = `${outputLabel}_alpha_source`;
	const brightSource = `${outputLabel}_bright_source`;
	const bright = `${outputLabel}_bright`;
	const blurred = `${outputLabel}_blurred`;
	const blended = `${outputLabel}_blended`;
	const alpha = `${outputLabel}_alpha`;
	const threshold = numberToken(operation.threshold, 'threshold');
	const sigma = numberToken(operation.sigma, 'sigma');
	const intensity = numberToken(operation.intensity, 'intensity');
	const luminance = '(0.2126*r(X,Y)+0.7152*g(X,Y)+0.0722*b(X,Y))/255';
	const factor = `max((${luminance}-${threshold})/(1-${threshold}),0)*alpha(X,Y)/255`;
	filters.push(`[${inputLabel}]format=pix_fmts=rgba,split=3[${original}][${brightSource}][${alphaSource}]`);
	filters.push(
		`[${brightSource}]geq=r='r(X,Y)*${factor}':g='g(X,Y)*${factor}':b='b(X,Y)*${factor}':a='alpha(X,Y)'`
		+ `${Number(operation.sigma) === 0 ? '' : `,gblur=sigma=${sigma}:sigmaV=${sigma}:steps=1:planes=15`}`
		+ `[${bright}]`,
	);
	filters.push(`[${original}][${bright}]blend=all_expr='255-(255-A)*(255-B*${intensity})/255'[${blended}]`);
	filters.push(`[${alphaSource}]alphaextract[${alpha}]`);
	filters.push(`[${blended}]format=pix_fmts=rgb24[${blurred}]`);
	filters.push(`[${blurred}][${alpha}]alphamerge,format=pix_fmts=rgba[${outputLabel}]`);
}

function appendAlphaUnderlay(context: VideoEffectGraphContext): void {
	const { filters, inputLabel, outputLabel, operation, width, height } = context;
	const original = `${outputLabel}_original`;
	const maskSource = `${outputLabel}_mask_source`;
	const sourceMask = `${outputLabel}_source_mask`;
	let decorationMask = `${outputLabel}_decoration_mask`;
	filters.push(`[${inputLabel}]format=pix_fmts=rgba,split=2[${original}][${maskSource}]`);
	filters.push(`[${maskSource}]alphaextract[${sourceMask}]`);
	if (operation.shape === 'outline') {
		const dilationStart = `${outputLabel}_dilation_source`;
		const originalMask = `${outputLabel}_original_mask`;
		filters.push(`[${sourceMask}]split=2[${dilationStart}][${originalMask}]`);
		let previous = dilationStart;
		const dilationCount = Number(operation.width);
		for (let index = 0; index < dilationCount; index += 1) {
			const next = `${outputLabel}_dilation_${index}`;
			filters.push(`[${previous}]dilation=coordinates=255[${next}]`);
			previous = next;
		}
		filters.push(`[${previous}][${originalMask}]blend=all_expr='max(A-B,0)'[${decorationMask}]`);
	} else if (operation.shape === 'drop-shadow') {
		const blurredMask = `${outputLabel}_blurred_mask`;
		const sigma = numberToken(operation.sigma, 'sigma');
		filters.push(
			`[${sourceMask}]${Number(operation.sigma) === 0 ? 'null' : `gblur=sigma=${sigma}:sigmaV=${sigma}:steps=1`}`
			+ `[${blurredMask}]`,
		);
		decorationMask = blurredMask;
	} else {
		throw new RangeError(`Unsupported alpha underlay shape: ${String(operation.shape)}.`);
	}
	const color = `${outputLabel}_color`;
	const decoration = `${outputLabel}_decoration`;
	const opacity = numberToken(operation.opacity, 'opacity');
	filters.push(`color=c=${colorToken(operation.color)}:s=${width}x${height},format=pix_fmts=rgb24[${color}]`);
	filters.push(`[${color}][${decorationMask}]alphamerge,format=pix_fmts=rgba,lutrgb=a=val*${opacity}[${decoration}]`);
	if (operation.shape === 'drop-shadow') {
		const base = `${outputLabel}_base`;
		const shifted = `${outputLabel}_shifted`;
		filters.push(`color=c=black@0:s=${width}x${height},format=pix_fmts=rgba[${base}]`);
		filters.push(
			`[${base}][${decoration}]overlay=x=${numberToken(operation.offsetX, 'offsetX')}`
			+ `:y=${numberToken(operation.offsetY, 'offsetY')}:eof_action=pass:repeatlast=0:format=auto[${shifted}]`,
		);
		filters.push(`[${shifted}][${original}]overlay=x=0:y=0:eof_action=pass:repeatlast=0:format=auto[${outputLabel}]`);
	} else {
		filters.push(`[${decoration}][${original}]overlay=x=0:y=0:eof_action=pass:repeatlast=0:format=auto[${outputLabel}]`);
	}
}

export function appendVideoEffectOperation(context: VideoEffectGraphContext): void {
	const { filters, inputLabel, outputLabel, operation } = context;
	if (typeof operation.expression === 'string') {
		if (operation.preserveAlpha) appendPreserveAlpha(filters, inputLabel, outputLabel, operation.expression);
		else filters.push(`[${inputLabel}]${operation.expression}[${outputLabel}]`);
		return;
	}
	switch (operation.kind) {
		case 'preserve-alpha': {
			if (operation.filter !== 'spill-suppression') throw new RangeError('Unsupported preserve-alpha operation.');
			const channel = Number(operation.screen) === 0 ? 'green' : 'blue';
			appendPreserveAlpha(
				filters,
				inputLabel,
				outputLabel,
				`despill=type=${channel}:mix=0.5:red=0`
				+ `:green=${channel === 'green' ? `-${numberToken(operation.strength, 'strength')}` : '0'}`
				+ `:blue=${channel === 'blue' ? `-${numberToken(operation.strength, 'strength')}` : '0'}`
				+ ':expand=0:brightness=0:alpha=0',
			);
			return;
		}
		case 'multiply-alpha-matte':
			appendMultiplyAlphaMatte(context);
			return;
		case 'luminance-bloom':
			appendBloom(context);
			return;
		case 'alpha-underlay':
			appendAlphaUnderlay(context);
			return;
		default:
			throw new RangeError(`Unsupported video effect operation: ${String(operation.kind)}.`);
	}
}
