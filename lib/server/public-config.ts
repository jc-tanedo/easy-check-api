const DEFAULT_GITHUB_URL = 'https://github.com/jc-tanedo/easy-check-api';

/** Only this explicitly public value is sent to the browser; never the environment object. */
export function getGithubUrl(env: NodeJS.ProcessEnv = process.env): string | null {
    const value = (env.GITHUB_URL ?? DEFAULT_GITHUB_URL).trim();
    if (!value) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password) return null;
        return url.href;
    } catch {
        return null;
    }
}
