'use strict';

process.env.HOSTNAME = process.env.BIND_HOST || '0.0.0.0';
require('../.next/standalone/server.js');
