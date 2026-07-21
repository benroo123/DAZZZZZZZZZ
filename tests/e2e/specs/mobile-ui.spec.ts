import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('feed-card-activity').first()).toBeVisible();
});

test.afterEach(async () => {
  await fetch('http://127.0.0.1:3100/v1/users/22222222-2222-4222-8222-222222222222/block', {
    method: 'DELETE',
    headers: { Authorization: 'Bearer demo-user' },
  });
});

test('home combines activity and posts with search and filters', async ({ page }) => {
  await expect(page.getByTestId('feed-card-activity').first()).toBeVisible();
  await expect(page.getByTestId('feed-card-post').first()).toBeVisible();

  await page.getByTestId('feed-city').click();
  await expect(page.getByText('同城 · 上海')).toBeVisible();

  await page.getByTestId('filter-button').click();
  await expect(page.getByTestId('filter-panel')).toBeVisible();
  await page.getByTestId('filter-panel').getByText('运动', { exact: true }).click();
  await page.getByTestId('apply-filter').click();
  await expect(page.getByText('周三下班羽毛球')).toBeVisible();

  const search = page.getByTestId('home-search');
  await search.fill('羽毛球');
  await search.press('Enter');
  await expect(page.getByText('周三下班羽毛球')).toBeVisible();
});

test('all five mobile tabs have real data and interactions', async ({ page }) => {
  await fetch('http://127.0.0.1:3100/v1/users/22222222-2222-4222-8222-222222222222/block', {
    method: 'DELETE',
    headers: { Authorization: 'Bearer demo-user' },
  });
  await page.getByTestId('tab-match').click();
  await expect(page.getByTestId('match-screen')).toBeVisible();
  await expect(page.getByText(/ID [A-Z0-9]+/)).toBeVisible();
  await page.getByTestId('swipe-like').click();
  await expect(page.getByTestId('swipe-status')).toBeVisible();

  await page.getByTestId('tab-messages').click();
  await expect(page.getByText('我的关注')).toBeVisible();
  await page.getByLabel(/^打开私信：/).click();
  await expect(page.getByTestId('chat-screen')).toBeVisible();
  const messageText = `E2E 本地测试消息 ${Date.now()}`;
  await page.getByLabel('输入消息').fill(messageText);
  await page.getByLabel('发送消息').click();
  await expect(page.getByText(messageText)).toBeVisible();
  const blockButton = page.getByTestId('silent-block');
  await blockButton.click();
  await expect(page.getByText('静默拉黑 · 对方不会收到提示')).toBeVisible();
  await expect(page.getByLabel('输入消息')).not.toBeEditable();

  await page.getByTestId('tab-profile').click();
  await expect(page.getByText('ID DC10001 · 30 岁 · 产品经理')).toBeVisible();
  await expect(page.locator('[data-testid^="theme-"]')).toHaveCount(8);
  await page.getByTestId('theme-midnight-red').click();
  await expect(page.getByText('午夜红')).toBeVisible();
});

test('AI-first publish removes form work and finishes a post', async ({ page }) => {
  await page.getByTestId('tab-publish').click();
  await page.getByTestId('publish-post').click();
  await page.getByTestId('publish-content').fill(`E2E 手机端 AI 配图发布 ${Date.now()}`);
  await page.getByTestId('publish-submit').click();
  await expect(page.getByTestId('publish-status')).toContainText('发布成功', { timeout: 25_000 });
});

test('AI creates an editable activity plan before publishing', async ({ page }) => {
  await page.getByTestId('tab-publish').click();
  await page.getByRole('button', { name: '✦ AI 补齐时间表与安全提示' }).click();
  await expect(page.getByTestId('ai-plan')).toBeVisible();
  await expect(page.getByText('公开页面只展示模糊集合点')).toBeVisible();
});
