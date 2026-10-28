import { getHandlers } from '../../../lib/server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
    return getHandlers().transactions(request);
}
