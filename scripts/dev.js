'use strict';

const fs = require('node:fs');

// Load PORT before Next starts, without an execArgv flag that its dev worker
// would copy into NODE_OPTIONS (where --env-file-if-exists is not allowed).
if (fs.existsSync('.env')) process.loadEnvFile('.env');
process.argv.splice(2, 0, 'dev', '--webpack');
require('next/dist/bin/next');
