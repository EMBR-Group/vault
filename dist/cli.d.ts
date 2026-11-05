export interface Args {
    readonly command: 'setup' | 'run' | 'keys';
    readonly config: string;
    readonly project: string | undefined;
    readonly program: readonly string[];
}
/** argv (after the node and script) → what to do. Throws a VaultError with the usage. */
export declare function parseArgs(argv: readonly string[]): Args;
/** Do what argv says; the exit code. Throws VaultError / TouchIdDeclined (bin.ts reports them). */
export declare function main(argv: readonly string[]): number;
