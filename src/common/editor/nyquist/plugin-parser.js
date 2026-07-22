const HEADER_DIRECTIVES = new Set([
	"author",
	"control",
	"copyright",
	"debugbutton",
	"debugflags",
	"i18n-hint",
	"mergeclips",
	"name",
	"nyquist",
	"preview",
	"release",
	"restoresplits",
	"type",
	"version",
]);

const NUMERIC_CONTROL_TYPES = new Set([
	"float",
	"float-text",
	"int",
	"int-text",
	"real",
	"time",
]);

function scanExpressionState(text, initial = { depth: 0, inString: false, escaped: false }) {
	const state = { ...initial };
	let inComment = false;

	for (const character of text) {
		if (inComment) {
			if (character === "\n" || character === "\r") {
				inComment = false;
			}
			continue;
		}
		if (state.inString) {
			if (state.escaped) {
				state.escaped = false;
			} else if (character === "\\") {
				state.escaped = true;
			} else if (character === '"') {
				state.inString = false;
			}
			continue;
		}
		if (character === ";") {
			inComment = true;
		} else if (character === '"') {
			state.inString = true;
		} else if (character === "(") {
			state.depth += 1;
		} else if (character === ")") {
			state.depth -= 1;
		}
	}

	return state;
}

function splitSourceLines(source) {
	const lines = [];
	const pattern = /.*(?:\r\n|\n|\r|$)/g;
	let match;
	let offset = 0;

	while ((match = pattern.exec(source)) && match[0]) {
		lines.push({ text: match[0], offset });
		offset += match[0].length;
	}
	return lines;
}

function collectHeaderDirectives(source) {
	const lines = splitSourceLines(source);
	const directives = [];

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		let content = line.text.replace(/[\r\n]+$/, "");
		if (index === 0) {
			content = content.replace(/^\uFEFF/, "");
		}
		const match = content.match(/^\s*([$;])([a-z][a-z0-9-]*)(?:[ \t]+(.*))?\s*$/i);
		if (!match) {
			continue;
		}

		let name = match[2].toLowerCase();
		let firstPayload = match[3] ?? "";
		if (name === "nyquist" && !["plug-in", "plugin"].includes(firstPayload.trim().toLowerCase())) {
			continue;
		}
		if (!HEADER_DIRECTIVES.has(name)) {
			continue;
		}

		let payload = firstPayload;
		let endIndex = index;
		let state = scanExpressionState(firstPayload);
		while ((state.depth > 0 || state.inString) && endIndex + 1 < lines.length) {
			endIndex += 1;
			payload += `\n${lines[endIndex].text.replace(/[\r\n]+$/, "")}`;
			state = scanExpressionState(lines[endIndex].text, state);
		}

		const endOffset = lines[endIndex].offset + lines[endIndex].text.length;
		directives.push({
			name,
			marker: match[1],
			payload: payload.trim(),
			raw: source.slice(line.offset, endOffset),
			startOffset: line.offset,
			endOffset,
			line: index + 1,
		});
		index = endIndex;
	}

	return directives;
}

function decodeStringEscape(character) {
	switch (character) {
		case "n":
			return "\n";
		case "r":
			return "\r";
		case "t":
			return "\t";
		default:
			return character;
	}
}

function tokenize(payload) {
	const tokens = [];
	let index = 0;

	while (index < payload.length) {
		const character = payload[index];
		if (/\s/.test(character)) {
			index += 1;
			continue;
		}
		if (character === ";") {
			while (index < payload.length && payload[index] !== "\n" && payload[index] !== "\r") {
				index += 1;
			}
			continue;
		}
		if (character === "(" || character === ")") {
			tokens.push({ type: character });
			index += 1;
			continue;
		}
		if (character === '"') {
			let value = "";
			let closed = false;
			index += 1;
			while (index < payload.length) {
				const next = payload[index];
				index += 1;
				if (next === '"') {
					closed = true;
					break;
				}
				if (next === "\\" && index < payload.length) {
					value += decodeStringEscape(payload[index]);
					index += 1;
				} else {
					value += next;
				}
			}
			if (!closed) {
				throw new SyntaxError("Unterminated string in Nyquist plug-in header");
			}
			tokens.push({ type: "value", value });
			continue;
		}

		const start = index;
		while (index < payload.length && !/[\s();]/.test(payload[index])) {
			index += 1;
		}
		const atom = payload.slice(start, index);
		if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(atom)) {
			tokens.push({ type: "value", value: Number(atom) });
		} else if (atom.toLowerCase() === "nil") {
			tokens.push({ type: "value", value: null });
		} else if (atom.toLowerCase() === "true") {
			tokens.push({ type: "value", value: true });
		} else if (atom.toLowerCase() === "false") {
			tokens.push({ type: "value", value: false });
		} else {
			tokens.push({ type: "value", value: atom });
		}
	}

	return tokens;
}

function parseTokens(tokens) {
	let index = 0;

	function parseValue() {
		const token = tokens[index];
		if (!token) {
			throw new SyntaxError("Unexpected end of Nyquist plug-in header expression");
		}
		index += 1;
		if (token.type === "value") {
			return token.value;
		}
		if (token.type === ")") {
			throw new SyntaxError("Unexpected ')' in Nyquist plug-in header expression");
		}

		const values = [];
		while (tokens[index]?.type !== ")") {
			values.push(parseValue());
			if (index >= tokens.length) {
				throw new SyntaxError("Unclosed list in Nyquist plug-in header expression");
			}
		}
		index += 1;
		return values;
	}

	const values = [];
	while (index < tokens.length) {
		values.push(parseValue());
	}
	return values;
}

function parsePayload(payload) {
	return parseTokens(tokenize(payload));
}

function unwrapText(value) {
	if (value === null || value === undefined) {
		return "";
	}
	if (!Array.isArray(value)) {
		return String(value);
	}
	if (value[0] === "_" && value.length > 1) {
		return unwrapText(value[1]);
	}
	if (value.length === 1) {
		return unwrapText(value[0]);
	}
	return value.map(unwrapText).filter(Boolean).join(" ");
}

function scalarValue(value) {
	if (Array.isArray(value)) {
		return unwrapText(value);
	}
	return value;
}

function controlKind(type) {
	if (type === "choice") {
		return "choice";
	}
	if (type === "string") {
		return "string";
	}
	if (type === "file") {
		return "file";
	}
	if (type === "text") {
		return "text";
	}
	return NUMERIC_CONTROL_TYPES.has(type) ? "number" : "unknown";
}

function parseChoiceOptions(value) {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map((option, index) => {
		if (Array.isArray(option) && option[0] === "_") {
			const label = unwrapText(option);
			return { value: index, symbol: label, label };
		}
		if (Array.isArray(option)) {
			const symbol = unwrapText(option[0]);
			const label = option.length > 1 ? unwrapText(option[1]) : symbol;
			return { value: index, symbol, label };
		}
		const label = unwrapText(option);
		return { value: index, symbol: label, label };
	});
}

function parseControl(directive) {
	const values = parsePayload(directive.payload);
	const variable = unwrapText(values[0]);
	// Static text controls use the two-field form `$control text "…"`.
	// `TEXT` is also a valid, case-sensitive plug-in variable name (used by
	// Audacity's Label Sounds string control), so the name alone is not enough.
	if (variable === "text" && values.length < 3) {
		return {
			variable: null,
			type: "text",
			kind: "text",
			label: unwrapText(values[1]),
			unit: "",
			defaultValue: null,
			min: null,
			max: null,
			options: [],
			line: directive.line,
		};
	}

	const type = unwrapText(values[2]).toLowerCase();
	if (!type) {
		throw new SyntaxError(`Missing control type at line ${directive.line}`);
	}
	const choice = type === "choice";
	return {
		variable,
		type,
		kind: controlKind(type),
		label: unwrapText(values[1]),
		unit: choice ? "" : unwrapText(values[3]),
		defaultValue: scalarValue(values[4]),
		min: choice ? null : scalarValue(values[5]),
		max: choice ? null : scalarValue(values[6]),
		options: choice ? parseChoiceOptions(values[3]) : [],
		fileFilters: type === "file" ? (values[5] ?? null) : null,
		line: directive.line,
	};
}

function firstDirectiveValue(directives, name) {
	const directive = directives.find((candidate) => candidate.name === name);
	if (!directive) {
		return null;
	}
	const values = parsePayload(directive.payload);
	return scalarValue(values[0]);
}

function stripDirectives(source, directives) {
	let cursor = 0;
	let code = "";
	for (const directive of directives) {
		code += source.slice(cursor, directive.startOffset);
		code += source.slice(directive.startOffset, directive.endOffset).replace(/[^\r\n]/g, "");
		cursor = directive.endOffset;
	}
	return code + source.slice(cursor);
}

function inferRole(declaredTypes) {
	if (declaredTypes.includes("process")) {
		return "process";
	}
	if (declaredTypes.includes("generate")) {
		return "generate";
	}
	if (declaredTypes.includes("analyze")) {
		return "analyze";
	}
	return "tool";
}

export function parseNyquistPluginHeader(source) {
	if (typeof source !== "string") {
		throw new TypeError("Nyquist plug-in source must be a string");
	}
	const directives = collectHeaderDirectives(source);
	if (!directives.some((directive) => directive.name === "nyquist")) {
		throw new SyntaxError("Missing 'nyquist plug-in' header");
	}

	const typeDirective = directives.find((directive) => directive.name === "type");
	const declaredTypes = typeDirective
		? parsePayload(typeDirective.payload).map((value) => unwrapText(value).toLowerCase())
		: [];
	const role = inferRole(declaredTypes);
	const preview = directives
		.filter((directive) => directive.name === "preview")
		.flatMap((directive) => parsePayload(directive.payload))
		.map((value) => unwrapText(value).toLowerCase());
	const controls = directives
		.filter((directive) => directive.name === "control")
		.map(parseControl);
	const debugButton = firstDirectiveValue(directives, "debugbutton");

	return {
		version: firstDirectiveValue(directives, "version"),
		type: declaredTypes[0] ?? "process",
		role,
		declaredTypes,
		isTool: declaredTypes.includes("tool"),
		spectral: declaredTypes.includes("spectral"),
		name: firstDirectiveValue(directives, "name") ?? "Untitled Nyquist Plug-in",
		author: firstDirectiveValue(directives, "author") ?? "",
		release: firstDirectiveValue(directives, "release") ?? "",
		copyright: firstDirectiveValue(directives, "copyright") ?? "",
		mergeClips: firstDirectiveValue(directives, "mergeclips"),
		restoreSplits: firstDirectiveValue(directives, "restoresplits"),
		debugFlags: directives
			.filter((directive) => directive.name === "debugflags")
			.flatMap((directive) => parsePayload(directive.payload).map(unwrapText)),
		debugButton,
		debugEnabled: debugButton !== false && debugButton !== "disabled",
		preview,
		controls,
		directives: directives.map(({ name, payload, marker, line }) => ({ name, payload, marker, line })),
	};
}

export function stripNyquistPluginHeader(source) {
	if (typeof source !== "string") {
		throw new TypeError("Nyquist plug-in source must be a string");
	}
	return stripDirectives(source, collectHeaderDirectives(source));
}

export function parseNyquistPlugin(source) {
	return {
		...parseNyquistPluginHeader(source),
		source,
		code: stripNyquistPluginHeader(source),
	};
}
