import { getHandlers } from '../../../lib/server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: RouteContext<'/bal/[token]'>): Promise<Response> {
    const { token } = await context.params;
    return getHandlers().publicBalance(_request, token);
}
