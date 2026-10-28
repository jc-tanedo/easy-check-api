const peso = new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
});

export function formatPeso(value: number): string {
    return peso.format(value);
}

export function parseAmount(value: unknown): number | null {
    if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return null;
    const amount = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(amount) ? amount : null;
}
