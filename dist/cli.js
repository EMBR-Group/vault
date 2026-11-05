// embr-vault: the vault for a repo whose secrets are one Bitwarden project.
//
//   embr-vault setup --config /Library/EMBR/<repo>.json --project <project-id>
//       Once per Mac. Asks for the repo's read-only machine-account token
//       (hidden), checks it reads that project, lists the keys it holds (never
//       a value), and stores token + project id in the root-only file.
//
//   embr-vault run --config /Library/EMBR/<repo>.json -- <command> [args...]
//       Touch ID, then <command> runs with every secret in the project as an
//       environment variable. The Bitwarden token never reaches it.
//
//   embr-vault keys --config /Library/EMBR/<repo>.json
//       Touch ID, then the key names the project holds (no values).
//
// A repo wires these into package.json, e.g.
//   "vault": "embr-vault run --config /Library/EMBR/makes-cents.json --"
import { spawnSync } from 'node:child_process';
import { VaultError, ask, envFor, listProjects, listSecrets, readMachineConfig, requireTerminal, storeMachineConfig, } from "./index.js";
const USAGE = `Usage:
  embr-vault setup --config <path> --project <project-id>
  embr-vault run   --config <path> -- <command> [args...]
  embr-vault keys  --config <path>`;
/** argv (after the node and script) → what to do. Throws a VaultError with the usage. */
export function parseArgs(argv) {
    const [command, ...rest] = argv;
    if (command !== 'setup' && command !== 'run' && command !== 'keys')
        throw new VaultError(USAGE);
    let config;
    let project;
    let i = 0;
    for (; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--') {
            i++;
            break;
        }
        if (a === '--config')
            config = rest[++i];
        else if (a === '--project')
            project = rest[++i];
        else
            break;
    }
    // `pnpm vault -- cmd` can hand us a second `--`.
    let program = rest.slice(i);
    while (program[0] === '--')
        program = program.slice(1);
    if (config === undefined)
        throw new VaultError(`--config is required.\n${USAGE}`);
    if (command === 'setup' && project === undefined)
        throw new VaultError(`setup needs --project <project-id>.\n${USAGE}`);
    if (command === 'run' && program.length === 0)
        throw new VaultError(`run needs a command after --.\n${USAGE}`);
    return { command, config, project, program };
}
function projectOf(data, config) {
    const id = data['projectId'];
    if (typeof id !== 'string' || id === '')
        throw new VaultError(`${config} names no project. Run embr-vault setup again.`);
    return id;
}
const shq = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
/** Do what argv says; the exit code. Throws VaultError / TouchIdDeclined (bin.ts reports them). */
export function main(argv) {
    const args = parseArgs(argv);
    switch (args.command) {
        case 'setup': {
            requireTerminal('embr-vault setup');
            const project = args.project ?? '';
            const token = ask('Machine account access token (hidden): ', { hidden: true });
            if (!token)
                throw new VaultError('The token is needed.');
            const projects = listProjects(token);
            const mine = projects.find((p) => p.id === project);
            if (!mine)
                throw new VaultError(`That token cannot read project ${project}. In Bitwarden, give its machine account "Can read" on it.`);
            const others = projects.filter((p) => p.id !== project);
            if (others.length)
                console.error(`Note: this token also reads ${others.map((p) => p.name).join(', ')}. One read-only machine account per repo keeps each repo to its own secrets.`);
            const keys = listSecrets(token, project).map((s) => s.key).sort();
            console.error(`${mine.name} holds: ${keys.join(', ') || '(nothing yet)'}`);
            console.error(`\nTouch ID stores the token in ${args.config}, readable by root alone.`);
            storeMachineConfig(args.config, { token, projectId: project });
            console.error('Stored. `embr-vault run` now asks for Touch ID to read it.');
            return 0;
        }
        case 'keys': {
            requireTerminal('embr-vault keys');
            const { token, data } = readMachineConfig(args.config);
            for (const k of listSecrets(token, projectOf(data, args.config)).map((s) => s.key).sort())
                console.log(k);
            return 0;
        }
        case 'run': {
            requireTerminal('embr-vault run');
            const [program = '', ...programArgs] = args.program;
            console.error(`\nTouch ID approves: ${args.program.map(shq).join(' ')}`);
            const { token, data } = readMachineConfig(args.config);
            const env = envFor(listSecrets(token, projectOf(data, args.config)));
            const child = spawnSync(program, programArgs, { stdio: 'inherit', env });
            if (child.error)
                throw new VaultError(`Could not run ${program}: ${child.error.message}`);
            return child.status ?? 1;
        }
    }
}
