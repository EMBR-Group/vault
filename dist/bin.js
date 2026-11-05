#!/usr/bin/env node
// The embr-vault command (cli.ts says what it does).
import { main } from "./cli.js";
import { TOUCH_ID_DECLINED, TouchIdDeclined } from "./index.js";
try {
    process.exit(main(process.argv.slice(2)));
}
catch (e) {
    if (e instanceof TouchIdDeclined) {
        console.error(e.message);
        process.exit(TOUCH_ID_DECLINED);
    }
    console.error(`\n${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
}
