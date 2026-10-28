// Loaded only by Playwright's test server. Never used by normal dev/start scripts.
if (process.env.EASYCHECK_E2E !== '1') throw new Error('The synthetic DriveHub adapter is only for E2E tests');

import { loadConfig } from '../../lib/server/config';
import { createRedisStores } from '../../lib/server/redis';
import { createService } from '../../lib/server/drivehub/service';
import { createHandlers, type HandlerSet } from '../../lib/server/handlers';
import { DriveHubError, type UpstreamRequest } from '../../lib/server/drivehub/transport';

async function request({ path, fields = {}, query = {} }: UpstreamRequest) {
    if (path === 'auth') return { access_token: 'synthetic-app-token', sig: 'synthetic-signature' };
    if (path.endsWith('/login')) {
        if (fields.email !== 'driver@example.com' || fields.password !== 'test-password') {
            throw new DriveHubError('DriveHub rejected the request', 401);
        }
        return { token: 'synthetic-user-token', exp_at: new Date(Date.now() + 6 * 3600_000).toISOString() };
    }
    if (path.endsWith('/rfid/trans')) {
        return {
            transaction:
                query.account_no === '123456789012'
                    ? [
                          {
                              Amount: '120.00',
                              Date: '2026-10-28T01:15:00Z',
                              Type: 'Toll',
                              Description: 'NLEX passage',
                              Plate: 'ABC1234',
                              Reference_No: 'TRX-0001',
                          },
                          {
                              Amount: '500.00',
                              Date: '2026-10-27T08:30:00Z',
                              Type: 'Reload',
                              Description: 'Account reload',
                              Plate: 'ABC1234',
                              Reference_No: 'TRX-0002',
                          },
                      ]
                    : null,
        };
    }
    if (path.endsWith('/rfid')) {
        const results =
            query.account_type === 'others'
                ? []
                : [
                      {
                          account_no: '123456789012',
                          plate_no: 'ABC1234',
                          name: 'Daily drive',
                          rfid_type: 'Easytrip',
                          balance: 1240.5,
                      },
                      {
                          account_no: '234567890123',
                          plate_no: 'DEF5678',
                          name: 'Weekend trips',
                          rfid_type: 'Easytrip',
                          balance: 85,
                      },
                  ];
        return { results, count: results.length, next: null, previous: null };
    }
    throw new Error('Unexpected synthetic API path');
}

const config = loadConfig();
const runtime = globalThis as unknown as Record<symbol, HandlerSet | undefined>;
const service = createService(config, { request });
const stores = config.redisUrl
    ? createRedisStores(config.redisUrl, config.sessionEncryptionKey || '', service)
    : undefined;
runtime[Symbol.for('easycheck.runtime')] = createHandlers(config, service, stores);
