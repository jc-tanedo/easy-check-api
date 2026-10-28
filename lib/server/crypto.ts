import { createHmac, timingSafeEqual } from 'node:crypto';

export function sign(message: string, key: string): string {
    return createHmac('sha512', key).update(message, 'utf8').digest('hex');
}

export function equalSecrets(actual: string | null, expected: string): boolean {
    if (typeof actual !== 'string') return false;
    const actualBytes = Buffer.from(actual);
    const expectedBytes = Buffer.from(expected);
    return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
