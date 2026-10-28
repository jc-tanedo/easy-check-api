import { test, expect, type Page, type Route } from '@playwright/test';

async function signIn(page: Page) {
    await page.goto('/');
    await page.getByLabel('Email address').fill('driver@example.com');
    await page.getByLabel('Password', { exact: true }).fill('test-password');
    await page.getByRole('button', { name: 'Connect my account' }).click();
    await expect(page.getByRole('heading', { name: 'ABC1234' })).toBeVisible();
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

async function delayedBalance(page: Page) {
    const started = deferred<void>();
    const release = deferred<void>();
    const finished = deferred<void>();
    await page.route(
        '**/api/balances?**',
        async (route: Route) => {
            const response = await route.fetch();
            const json: Record<string, unknown> = await response.json();
            started.resolve();
            await release.promise;
            try {
                await route.fulfill({
                    json: { ...json, accounts: [{ accountNo: 'late', plateNo: 'STALE-RESPONSE', balance: 999 }] },
                });
            } finally {
                finished.resolve();
            }
        },
        { times: 1 },
    );
    return { started, release, finished };
}

test('logout discards an outstanding balance response', async ({ page }) => {
    await signIn(page);
    const delayed = await delayedBalance(page);
    await page.getByRole('button', { name: 'Refresh balances' }).click();
    await delayed.started.promise;
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome to EasyCheck' })).toBeVisible();
    delayed.release.resolve();
    await delayed.finished.promise;
    await expect(page.getByText('STALE-RESPONSE')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Welcome to EasyCheck' })).toBeVisible();
});

test('switching account categories discards the older balance response', async ({ page }) => {
    await signIn(page);
    const delayed = await delayedBalance(page);
    await page.getByRole('button', { name: 'Refresh balances' }).click();
    await delayed.started.promise;
    await page.getByRole('tab', { name: 'Other accounts' }).click();
    await expect(page.getByRole('heading', { name: 'No accounts here yet' })).toBeVisible();
    delayed.release.resolve();
    await delayed.finished.promise;
    await expect(page.getByText('STALE-RESPONSE')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Other accounts' })).toHaveAttribute('aria-selected', 'true');
});

test('unrelated parent updates do not restart transaction requests', async ({ page }) => {
    await signIn(page);
    let calls = 0;
    await page.route('**/api/transactions?**', async (route) => {
        calls++;
        await route.continue();
    });
    await page
        .getByRole('article')
        .filter({ has: page.getByRole('heading', { name: 'ABC1234' }) })
        .getByRole('button', { name: 'View transactions' })
        .click();
    const dialog = page.getByRole('dialog', { name: 'Transaction history' });
    await expect(dialog.getByText('TRX-0001', { exact: true })).toBeVisible();
    expect(calls).toBe(1);
    // The modal blocks pointer input outside it, but a background balance refresh
    // can still finish while it is open. Trigger the same dashboard handler.
    await page
        .getByRole('button', { name: 'Refresh balances' })
        .evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByRole('button', { name: 'Refresh balances' })).toBeEnabled();
    await expect(dialog.getByText('TRX-0001', { exact: true })).toBeVisible();
    expect(calls).toBe(1);
});
