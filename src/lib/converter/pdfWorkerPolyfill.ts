/**
 * Safari < 17.4 (older macOS / iOS) does not implement `Promise.withResolvers`, which
 * pdfjs-dist@6 calls on both the main thread and inside its web worker. When it's missing the
 * call throws part-way through parsing, which surfaces to the user as the cryptic
 * `undefined is not a function (near '...e of t...')` mid-conversion (a downstream minified
 * `for (… of t)` iterating over the value that never got produced). Even pdfjs's `legacy` build
 * uses it, so the only fix is to polyfill it before pdfjs runs.
 *
 * This module installs the polyfill as an import side effect. It's imported *first* — ahead of the
 * pdfjs worker/main modules — so ES module evaluation order guarantees the polyfill is in place
 * before any pdfjs code executes.
 */
const P = Promise as unknown as Record<string, unknown>;

if (typeof P.withResolvers !== 'function') {
	P.withResolvers = function withResolvers<T>() {
		let resolve!: (value: T | PromiseLike<T>) => void;
		let reject!: (reason?: unknown) => void;
		const promise = new Promise<T>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		return { promise, resolve, reject };
	};
}
