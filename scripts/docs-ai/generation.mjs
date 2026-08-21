const MAX_MODEL_ATTEMPTS = 3;
const MAX_FEEDBACK_CHARS = 180;

export class InvalidModelOutputError extends Error {
	constructor(message, options) {
		super(message, options);
		this.name = 'InvalidModelOutputError';
	}
}

export function asInvalidModelOutput(error, fallbackMessage = 'Model output failed validation.') {
	if (error instanceof InvalidModelOutputError) return error;
	return new InvalidModelOutputError(
		error instanceof Error && error.message ? error.message : fallbackMessage,
		{ cause: error },
	);
}

function conciseFeedback(error) {
	const message = error.message.replace(/\s+/gu, ' ').trim();
	return message.length <= MAX_FEEDBACK_CHARS
		? message
		: `${message.slice(0, MAX_FEEDBACK_CHARS - 1)}…`;
}

export async function generateValidated(options) {
	let feedback = '';
	for (let attempt = 1; attempt <= MAX_MODEL_ATTEMPTS; attempt += 1) {
		const prompt = feedback
			? `${options.prompt}\n\nPrevious response failed validation: ${feedback}\nReturn corrected JSON only; follow the original closed request exactly.`
			: options.prompt;
		try {
			const response = await options.client.generateJson({ system: options.system, prompt });
			const value = await options.validate(response);
			return { response, value, attempts: attempt };
		} catch (error) {
			if (!(error instanceof InvalidModelOutputError) || attempt === MAX_MODEL_ATTEMPTS) throw error;
			feedback = conciseFeedback(error);
		}
	}
	throw new Error('Unreachable Docs AI retry state.');
}
