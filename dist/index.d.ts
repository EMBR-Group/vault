/** The exit code a wrapper uses when Touch ID was cancelled: nothing ran. */
export declare const TOUCH_ID_DECLINED = 75;
/** Something the vault refuses or could not do. Its message is for the person at the Mac. */
export declare class VaultError extends Error {
    name: string;
}
/** Touch ID (or the sudo password) was cancelled or refused: nothing was read. */
export declare class TouchIdDeclined extends VaultError {
    name: string;
    constructor();
}
/** Refuse unless a person is at a terminal (an agent's shell has none). */
export declare function requireTerminal(what: string): void;
/** Ask a question at the terminal; `hidden` turns echo off (tokens). */
export declare function ask(question: string, { hidden }?: {
    readonly hidden?: boolean;
}): string;
/** What the root-only file holds: the token, plus whatever the caller stored with it (project ids). */
export interface MachineConfig {
    readonly token: string;
    readonly data: Readonly<Record<string, unknown>>;
}
/** The file's text → its config. Throws a VaultError naming the file when it is not one. */
export declare function parseMachineConfig(text: string, path: string): MachineConfig;
/** Read the root-only file through `sudo -k` (Touch ID every time, no sudo ticket left behind). */
export declare function readMachineConfig(path: string): MachineConfig;
/**
 * Write the root-only file (Touch ID), then check it really is unreadable
 * without sudo. Its folder is made root-only too.
 */
export declare function storeMachineConfig(path: string, config: {
    readonly token: string;
} & Readonly<Record<string, unknown>>): void;
export declare const RATE_LIMIT_DELAYS_MS: readonly number[];
export declare function isRateLimited(stderr: string): boolean;
export declare function retryWhileRateLimited<R extends {
    readonly status: number | null;
    readonly stderr: string;
}>(attempt: () => R, { delays, sleep }?: {
    readonly delays?: readonly number[];
    readonly sleep?: (ms: number) => void;
}): R;
/** `retryWhileRateLimited` for a caller that must keep answering while it waits. */
export declare function retryWhileRateLimitedAsync<R extends {
    readonly status: number | null;
    readonly stderr: string;
}>(attempt: () => Promise<R>, { delays, sleep }?: {
    readonly delays?: readonly number[];
    readonly sleep?: (ms: number) => Promise<void>;
}): Promise<R>;
/**
 * `read`, shared: a call while one is in flight, or within `freshMs` of one
 * that succeeded, gets that one's result. A failed read is never reused.
 */
export declare function shareRecentRead<T>(read: () => Promise<T>, { freshMs, now }: {
    readonly freshMs: number;
    readonly now?: () => number;
}): () => Promise<T>;
/** One bws call (JSON out), retried while rate limited. Throws what Bitwarden said. */
export declare function bws(token: string, args: readonly string[]): unknown;
/** `bws` without blocking the event loop. */
export declare function bwsAsync(token: string, args: readonly string[]): Promise<unknown>;
export interface Secret {
    readonly id: string;
    readonly key: string;
    readonly value: string;
    readonly revisionDate: string;
    readonly projectId: string | undefined;
    readonly organizationId: string | undefined;
}
export interface Project {
    readonly id: string;
    readonly name: string;
}
/** `bws secret list` output → secrets. */
export declare function parseSecrets(json: unknown): Secret[];
/** `bws project list` output → projects. */
export declare function parseProjects(json: unknown): Project[];
/** Every secret the token reads; with a project id, only that project's (refusing any other). */
export declare function listSecrets(token: string, projectId?: string): Secret[];
/** Every project the token reads. */
export declare function listProjects(token: string): Project[];
/**
 * The environment a command gets: `base` without any Bitwarden token, plus
 * each secret under its key. Refuses a key that is not an env var name, or
 * two secrets under one key (which would win is not something to guess).
 */
export declare function envFor(secrets: readonly Secret[], base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
/** A project's page in the Bitwarden web app, for telling a person where a value goes. */
export declare function projectLink(organizationId: string | undefined, projectId: string): string;
