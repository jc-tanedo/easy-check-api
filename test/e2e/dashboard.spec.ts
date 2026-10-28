import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page): Promise<void> {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Welcome to EasyCheck' })).toBeVisible();
    await page.getByLabel('Email address').fill('driver@example.com');
    await page.getByLabel('Password', { exact: true }).fill('test-password');
    await page.getByRole('button', { name: 'Connect my account' }).click();
}

test('sign in, show linked balances, restore session, switch accounts, and sign out', async ({ page }, info) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Welcome to EasyCheck' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('signin-desktop.png'), fullPage: true });
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'ABC1234' })).toBeVisible();
    await expect(page.getByText('₱1,325.50', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('dashboard-desktop.png'), fullPage: true });
    await expect(page.getByText('123456789012', { exact: true })).not.toBeVisible();
    await page.getByRole('button', { name: 'Show account numbers' }).click();
    await expect(page.getByText('123456789012', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'ABC1234' })).toBeVisible();
    await page.getByRole('tab', { name: 'Other accounts' }).click();
    await expect(page.getByRole('heading', { name: 'No accounts here yet' })).toBeVisible();
    await page.getByRole('tab', { name: 'My accounts' }).click();
    await expect(page.getByRole('heading', { name: 'DEF5678' })).toBeVisible();
    await page.getByRole('button', { name: 'Refresh balances' }).click();
    await expect(page.getByRole('heading', { name: 'ABC1234' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome to EasyCheck' })).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Welcome to EasyCheck' })).toBeVisible();
});

test('mobile sign-in and dashboard fit the viewport', async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Welcome to EasyCheck' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('signin-mobile.png'), fullPage: true });
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'ABC1234' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('dashboard-mobile.png'), fullPage: true });
});

test('failed sign-in shows a recoverable error', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email address').fill('wrong@example.com');
    await page.getByLabel('Password', { exact: true }).fill('wrong-password');
    await page.getByRole('button', { name: 'Connect my account' }).click();
    await expect(page.getByRole('region', { name: 'Welcome to EasyCheck' }).getByRole('alert')).toContainText(
        'DriveHub rejected the request',
    );
    await expect(page.getByRole('button', { name: 'Connect my account' })).toBeEnabled();
});

test('a balance error can be retried successfully', async ({ page }) => {
    let fail = true;
    await page.route('**/api/balances?**', (route) => {
        if (!fail) return route.continue();
        fail = false;
        return route.fulfill({
            status: 502,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Temporary connection issue' }),
        });
    });
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'We couldn’t load your accounts' })).toBeVisible();
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'ABC1234' })).toBeVisible();
});

test('legacy and namespaced machine API routes both work', async ({ request }) => {
    for (const path of ['/check-balance', '/api/check-balance']) {
        const unauthorized = await request.get(path);
        expect(unauthorized.status()).toBe(401);
        const response = await request.get(path + '?id=123456789012', {
            headers: { 'X-API-Key': 'synthetic-test-api-key-at-least-32-characters' },
        });
        expect(response.status()).toBe(200);
        expect((await response.json()).accounts[0].accountNo).toBe('123456789012');
    }
});

test('numeric string balances render correctly alongside zero and missing values', async ({ page }) => {
    await page.route('**/api/balances?**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                accounts: [
                    { accountNo: '123456789012', plateNo: 'STRING1', balance: '1240.50' },
                    { accountNo: '234567890123', plateNo: 'ZERO123', balance: '0.00' },
                    { accountNo: '345678901234', plateNo: 'MISSING', balance: null },
                ],
                pagination: { count: 3, hasNext: false, hasPrevious: false },
            }),
        }),
    );
    await signIn(page);
    const stringAccount = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'STRING1' }) });
    await expect(stringAccount.getByText('₱1,240.50', { exact: true })).toBeVisible();
    const zeroAccount = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'ZERO123' }) });
    await expect(zeroAccount.getByText('₱0.00', { exact: true })).toBeVisible();
    const missingAccount = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'MISSING' }) });
    await expect(missingAccount.getByText('Unavailable', { exact: true })).toBeVisible();
    await expect(page.locator('.summary-amount')).toHaveText('₱1,240.50');
});

test('view, refresh, and close transaction history; handle empty history', async ({ page }) => {
    await signIn(page);
    const account = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'ABC1234' }) });
    await account.getByRole('button', { name: 'View transactions' }).click();
    const dialog = page.getByRole('dialog', { name: 'Transaction history' });
    await expect(dialog).toBeVisible();
    const firstTransaction = dialog.locator('.transaction-item').first();
    const plate = firstTransaction.getByLabel('License plate ABC1234', { exact: true });
    await expect(plate).toBeVisible();
    const plateBounds = await plate.boundingBox();
    const amountBounds = await firstTransaction.locator('.timeline-marker').boundingBox();
    await expect(firstTransaction.locator('.transaction-date')).toContainText('ABC1234');
    expect(plateBounds).not.toBeNull();
    expect(amountBounds).not.toBeNull();
    expect(plateBounds!.x + plateBounds!.width).toBeLessThan(amountBounds!.x);
    await expect(dialog.getByText('TRX-0001', { exact: true })).toBeVisible();
    await expect(dialog.getByText('₱120.00', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Reload', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(dialog.getByText('TRX-0002', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    const emptyAccount = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'DEF5678' }) });
    await emptyAccount.getByRole('button', { name: 'View transactions' }).click();
    await expect(dialog.getByRole('heading', { name: 'No transactions returned' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close transaction history' }).click();
    await expect(dialog).not.toBeVisible();
});

test('transaction history recovers from a failed request', async ({ page }) => {
    let fail = true;
    await page.route('**/api/transactions?**', (route) => {
        if (!fail) return route.continue();
        fail = false;
        return route.fulfill({
            status: 502,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Temporary history error' }),
        });
    });
    await signIn(page);
    await page
        .getByRole('article')
        .filter({ has: page.getByRole('heading', { name: 'ABC1234' }) })
        .getByRole('button', { name: 'View transactions' })
        .click();
    const dialog = page.getByRole('dialog', { name: 'Transaction history' });
    await expect(dialog.getByRole('alert')).toContainText('Temporary history error');
    await dialog.getByRole('button', { name: 'Try again' }).click();
    await expect(dialog.getByText('TRX-0001', { exact: true })).toBeVisible();
});

test('transaction history fits a mobile viewport', async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await page
        .getByRole('article')
        .filter({ has: page.getByRole('heading', { name: 'ABC1234' }) })
        .getByRole('button', { name: 'View transactions' })
        .click();
    const dialog = page.getByRole('dialog', { name: 'Transaction history' });
    await expect(dialog.getByText('TRX-0001', { exact: true })).toBeVisible();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('transactions-mobile.png'), fullPage: true });
});

test('transaction timeline stays bounded and scrolls independently with all details visible', async ({
    page,
}, info) => {
    await page.route('**/api/transactions?**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                transactions: Array.from({ length: 12 }, (_, index) => ({
                    amount: '120.00',
                    date: '2026-10-28T01:15:00Z',
                    type: 'Toll',
                    description: `NLEX passage ${index + 1}`,
                    plate: 'ABC1234',
                    referenceNo: `TRX-LONG-${index + 1}`,
                })),
            }),
        }),
    );
    await signIn(page);
    await page
        .getByRole('article')
        .filter({ has: page.getByRole('heading', { name: 'ABC1234' }) })
        .getByRole('button', { name: 'View transactions' })
        .click();
    const dialog = page.getByRole('dialog', { name: 'Transaction history' });
    const timeline = dialog.getByRole('list', { name: 'Transactions' });
    await expect(timeline.getByRole('listitem')).toHaveCount(12);
    const first = timeline.getByRole('listitem').first();
    for (const detail of ['Oct 28, 2026', '1:15:00 AM', 'Toll', 'NLEX passage 1', 'ABC1234', 'TRX-LONG-1', '₱120.00']) {
        await expect(first.getByText(detail, { exact: true })).toBeVisible();
    }
    const box = await dialog.boundingBox();
    if (!box) throw new Error('Transaction dialog has no bounding box');
    expect(box.width).toBeLessThanOrEqual(760);
    expect(box.height).toBeLessThanOrEqual(640);
    const dateBox = await first.locator('.transaction-date').boundingBox();
    const amountBox = await first.locator('.transaction-amount').boundingBox();
    if (!dateBox || !amountBox) throw new Error('Transaction row has no bounding box');
    expect(dateBox.x).toBeLessThan(amountBox.x);
    const body = dialog.locator('.history-body');
    expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await dialog.screenshot({ path: info.outputPath('timeline-desktop.png') });
    await body.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
    });
    await expect(dialog.getByText('TRX-LONG-12', { exact: true })).toBeInViewport();
    await expect(dialog.getByRole('heading', { name: 'Transaction history' })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Refresh', exact: true })).toBeInViewport();
    await page.setViewportSize({ width: 390, height: 844 });
    await body.evaluate((element) => {
        element.scrollTop = 0;
    });
    const mobileBox = await dialog.boundingBox();
    if (!mobileBox) throw new Error('Mobile transaction dialog has no bounding box');
    expect(mobileBox.width).toBeLessThanOrEqual(366);
    expect(mobileBox.height).toBeLessThanOrEqual(640);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await dialog.screenshot({ path: info.outputPath('timeline-mobile.png') });
});

test('generate a cookie-free balance URL, reuse its cache, and invalidate it on logout', async ({ page, request }) => {
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'ABC1234' })).toBeVisible();
    await page.getByRole('button', { name: 'Balance URL', exact: true }).click();
    await page.getByRole('button', { name: 'Generate URL', exact: true }).click();
    const field = page.getByRole('textbox', { name: 'Balance fetching URL', exact: true });
    await expect(field).toHaveValue(/\/bal\/[A-Za-z0-9_-]{12}$/);
    const url = await field.inputValue();
    const first = await request.get(url);
    expect(first.status()).toBe(200);
    expect((await request.get(url.replace('/bal/', '/api/balance/'))).status()).toBe(404);
    const data = await first.json();
    expect(data.accounts).toHaveLength(2);
    expect(data.cached).toBe(false);
    expect(first.headers()['cache-control']).toBe('no-store');
    const second = await request.get(url + '?nocache=1');
    expect((await second.json()).cached).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: 'Balance URL', exact: true }).click();
    await expect(field).toHaveValue(url);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome to EasyCheck' })).toBeVisible();
    expect((await request.get(url)).status()).toBe(404);
});

test('balance URL can be revoked and replaced from the mobile panel', async ({ page, request }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'ABC1234' })).toBeVisible();
    await page.getByRole('button', { name: 'Balance URL', exact: true }).click();
    await page.getByRole('button', { name: 'Generate URL', exact: true }).click();
    const field = page.getByRole('textbox', { name: 'Balance fetching URL', exact: true });
    await expect(field).toHaveValue(/\/bal\/[A-Za-z0-9_-]{12}$/);
    const old = await field.inputValue();
    await expect(page.getByRole('button', { name: 'Copy URL', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('balance-url-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: 'Revoke URL', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Generate URL', exact: true })).toBeVisible();
    expect((await request.get(old)).status()).toBe(404);
    await page.getByRole('button', { name: 'Generate URL', exact: true }).click();
    await expect(field).toHaveValue(/\/bal\/[A-Za-z0-9_-]{12}$/);
    expect(await field.inputValue()).not.toBe(old);
});

test.describe('transaction wall-clock timestamps', () => {
    test.use({ timezoneId: 'America/Los_Angeles' });
    test('preserves supplied local dates and times without applying another offset', async ({ page }) => {
        const records = [
            { date: '2026-10-28T01:15:00Z', expectedDate: 'Oct 28, 2026', expectedTime: '1:15:00 AM' },
            { date: '2026-10-28T01:15:00+08:00', expectedDate: 'Oct 28, 2026', expectedTime: '1:15:00 AM' },
            { date: '2026-10-28 13:20:00', expectedDate: 'Oct 28, 2026', expectedTime: '1:20:00 PM' },
            { date: '2026-10-28T23:45:00.000Z', expectedDate: 'Oct 28, 2026', expectedTime: '11:45:00 PM' },
        ];
        await page.route('**/api/transactions?**', (route) =>
            route.fulfill({
                json: {
                    transactions: records.map((record, index) => ({
                        date: record.date,
                        amount: '120.00',
                        type: 'Passage',
                        description: 'Timezone regression',
                        plate: 'ABC1234',
                        referenceNo: `TIME-${index}`,
                    })),
                },
            }),
        );
        await signIn(page);
        await page
            .getByRole('article')
            .filter({ has: page.getByRole('heading', { name: 'ABC1234' }) })
            .getByRole('button', { name: 'View transactions' })
            .click();
        const items = page.getByRole('dialog', { name: 'Transaction history' }).getByRole('listitem');
        await expect(items).toHaveCount(records.length);
        for (let index = 0; index < records.length; index++) {
            const time = items.nth(index).locator('time');
            await expect(time.locator('strong')).toHaveText(records[index].expectedDate);
            await expect(time.locator('span')).toHaveText(records[index].expectedTime);
        }
    });
});
