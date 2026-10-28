// Avoid Date.parse's server-local interpretation of "YYYY-MM-DD HH:mm:ss".
export function parseExpiry(value: unknown, utcOffset = '+08:00'): number {
    if (typeof value !== 'string') return Number.NaN;
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})?$/.exec(
        value.trim(),
    );
    if (!match) return Number.NaN;
    const [, year, month, day, hour, minute, second, fraction = '', zone = utcOffset] = match;
    const wall = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second));
    if (
        wall.getUTCFullYear() !== +year ||
        wall.getUTCMonth() !== +month - 1 ||
        wall.getUTCDate() !== +day ||
        +hour > 23 ||
        +minute > 59 ||
        +second > 59
    ) {
        return Number.NaN;
    }
    return Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}${fraction}${zone}`);
}
