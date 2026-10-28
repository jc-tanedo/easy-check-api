'use strict';

const path = require('node:path');

// The generated server changes cwd to .next/standalone. Resolve runtime secrets
// first, so npm start can still read the ignored file in the repository root.
process.env.DRIVEHUB_CLIENT_CONFIG = path.resolve(process.env.DRIVEHUB_CLIENT_CONFIG || '.drivehub-client.json');
process.env.HOSTNAME = process.env.BIND_HOST || '0.0.0.0';
require('../.next/standalone/server.js');
