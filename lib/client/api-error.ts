import axios from 'axios';

interface ApiErrorBody {
    error?: unknown;
}

export function apiErrorMessage(error: unknown, fallback: string): string {
    if (!axios.isAxiosError<ApiErrorBody>(error)) return fallback;
    const message = error.response?.data?.error;
    return typeof message === 'string' ? message : fallback;
}

export function isUnauthorized(error: unknown): boolean {
    return axios.isAxiosError(error) && error.response?.status === 401;
}
