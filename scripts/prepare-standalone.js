'use strict';

const fs = require('node:fs');
const path = require('node:path');

const standaloneDir = path.resolve('.next/standalone');
const staticDir = path.resolve('.next/static');
const publicDir = path.resolve('public');

if (!fs.statSync(staticDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error('Next.js static assets are missing; build the application before packaging');
}
if (!fs.statSync(standaloneDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error('Next.js standalone output is missing; build with output: standalone');
}

// Next.js leaves static assets out of standalone output by default.
fs.cpSync(staticDir, path.join(standaloneDir, '.next/static'), { recursive: true, force: true });
if (fs.statSync(publicDir, { throwIfNoEntry: false })?.isDirectory()) {
    fs.cpSync(publicDir, path.join(standaloneDir, 'public'), { recursive: true, force: true });
}

// Ensure secrets are removed anywhere in the generated runtime tree. Do not
// follow symlinks: a matching symlink is unlinked, never traversed.
function removeRuntimeSecrets(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.name.startsWith('.env') || entry.name === '.drivehub-client.json') {
            fs.rmSync(target, { recursive: true, force: true });
        } else if (entry.isDirectory()) {
            removeRuntimeSecrets(target);
        }
    }
}

removeRuntimeSecrets(standaloneDir);
