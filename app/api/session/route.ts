import { getHandlers } from '../../../lib/server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
    return getHandlers().session(request);
}

export function POST(request: Request): Promise<Response> {
    return getHandlers().session(request);
}

export function DELETE(request: Request): Promise<Response> {
    return getHandlers().session(request);
}
