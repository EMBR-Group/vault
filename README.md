# @embr/vault

> **This repository contains no secrets, and it is meant to be public.**
> There are no passwords, API keys, tokens, project ids or client data in it,
> and there never will be. It is only the small piece of code that *fetches*
> secrets from Bitwarden on a person's own Mac, after they approve it with
> Touch ID. The secrets themselves stay in Bitwarden Secrets Manager. Making
> this code public is like publishing how a lock works: it does not hand out
> the key. It is public so EMBR's private repos can install it without extra
> access setup.

Run one command with secrets from Bitwarden Secrets Manager, after Touch ID.

## How it works

1. **Bitwarden holds the secrets.** Each repo has its own project in
   Bitwarden Secrets Manager (for example *Makes Cents*), and its own
   *machine account* that can only **read** that project.
2. **Once per Mac, the machine account's token is stored where only root can
   read it**, for example `/Library/EMBR/makes-cents.json` (mode 400, owner
   root). Nothing else goes on the Mac.
3. **Every run asks for Touch ID** (`sudo -k`, so no sudo session is left
   behind for anything else to use), reads that token, fetches the project's
   secrets with one `bws` call, and runs the one command you named with the
   secrets as environment variables. The Bitwarden token itself never
   reaches the command, and nothing is written to disk.
4. **It refuses without a terminal.** A script or an AI agent's shell has
   none, so a Touch ID prompt only ever appears because the person at the
   Mac asked for it.

## Use

Needs [`bws`](https://bitwarden.com/help/secrets-manager-cli/) on the PATH,
Node 22+, and Touch ID set up for `sudo`.

```jsonc
// package.json
"dependencies": { "@embr/vault": "github:EMBR-Group/vault#v0.1.0" },
"scripts": {
  "vault:setup": "embr-vault setup --config /Library/EMBR/<repo>.json --project <bitwarden-project-id>",
  "vault": "embr-vault run --config /Library/EMBR/<repo>.json --"
}
```

```bash
pnpm vault:setup                        # once per Mac: paste the read-only machine token (hidden)
pnpm vault -- scripts/some-script.sh    # Touch ID, then the script runs with the secrets
pnpm exec embr-vault keys --config /Library/EMBR/<repo>.json   # the key names (never values)
```

A Bitwarden project id is not a secret either: it only names a project, and
reading one still needs a token with access to it.

A repo with a more involved layout (several projects, keys per site) uses the
library instead: `readMachineConfig`, `storeMachineConfig`, `listSecrets`,
`bws` / `bwsAsync` (with rate-limit retries), `envFor` and `shareRecentRead`.
See `src/index.ts`.

## Develop

```bash
pnpm install
pnpm check   # typecheck, tests, build; fails if dist/ is out of date
```

`dist/` is committed, because repos install this straight from GitHub and
Node does not run TypeScript from `node_modules`. Release by building,
committing `dist/`, and tagging `vX.Y.Z`.
