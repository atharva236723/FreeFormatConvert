export type ConversionErrorReason = 'unsupported-pair' | 'timeout' | 'engine-load-failed' | 'file-too-large' | 'unknown';

export class ConversionError extends Error {
	reason: ConversionErrorReason;
	constructor(reason: ConversionErrorReason, message: string) {
		super(message);
		this.name = 'ConversionError';
		this.reason = reason;
	}
}
