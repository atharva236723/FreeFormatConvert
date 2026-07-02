/// <reference types="astro/client" />

// Mammoth ships a prebuilt, self-contained browser bundle but no type declarations for
// that subpath — documentEngine.ts imports it to avoid pulling mammoth's Node-only deps.
declare module 'mammoth/mammoth.browser.js';
