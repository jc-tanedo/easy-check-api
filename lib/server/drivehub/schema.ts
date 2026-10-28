import { camelCase, mapKeys } from 'lodash';
import { DriveHubError } from './transport';

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function records(values: unknown, label: string): JsonRecord[] {
    if (!Array.isArray(values) || !values.every(isRecord)) {
        throw new DriveHubError(`Unexpected DriveHub ${label}`, 502);
    }
    return values;
}

export function normalizeRecord(record: JsonRecord): JsonRecord {
    return mapKeys(record, (_value, key) => camelCase(key));
}
