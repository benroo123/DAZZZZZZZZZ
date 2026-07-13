import { expect, test } from '@playwright/test';

const backends = [
  { name: 'TypeScript', baseUrl: 'http://127.0.0.1:3100/v1', implementation: 'ts' },
  { name: 'Python', baseUrl: 'http://127.0.0.1:8100/v1', implementation: 'python' },
] as const;

const headers = {
  Authorization: 'Bearer demo-user',
  'content-type': 'application/json',
};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
  const payload = await response.json();
  expect(response.ok, JSON.stringify(payload)).toBeTruthy();
  return payload as T;
}

for (const backend of backends) {
  test(`${backend.name} exposes the same mobile and agent contract`, async () => {
    const health = await json<{ status: string; implementation: string; dependencies: Record<string, string> }>(
      `${backend.baseUrl}/system/health`,
    );
    expect(health.status).toBe('ready');
    expect(health.implementation).toBe(backend.implementation);
    expect(Object.values(health.dependencies)).toEqual(['up', 'up', 'up', 'up']);

    const config = await json<{ themes: Record<string, unknown>; featureFlags: Record<string, boolean> }>(
      `${backend.baseUrl}/system/config`,
    );
    expect(Object.keys(config.themes)).toHaveLength(8);
    expect(config.featureFlags.aiCover).toBe(true);
    expect(config.featureFlags.agentGateway).toBe(true);

    const feed = await json<{ items: Array<{ entityType: string }> }>(`${backend.baseUrl}/feed`);
    expect(feed.items.some((item) => item.entityType === 'activity')).toBe(true);
    expect(feed.items.some((item) => item.entityType === 'post')).toBe(true);

    const candidates = await json<{ items: Array<{ publicId: string; interests: string[] }> }>(
      `${backend.baseUrl}/matching/candidates`,
    );
    expect(candidates.items.length).toBeGreaterThanOrEqual(4);
    expect(candidates.items[0].publicId).toBeTruthy();
    expect(Array.isArray(candidates.items[0].interests)).toBe(true);

    const profile = await json<{ publicId: string; age: number; followingCount: number }>(
      `${backend.baseUrl}/me/profile`,
    );
    expect(profile.publicId).toBe('DC10001');
    expect(profile.age).toBeGreaterThanOrEqual(18);

    const plan = await json<{ title: string; agenda: unknown[]; safetyNotes: unknown[] }>(
      `${backend.baseUrl}/ai/plan`,
      {
        method: 'POST',
        body: JSON.stringify({ prompt: '周六组织六个人打羽毛球', cityCode: '310100', participantTarget: 6 }),
      },
    );
    expect(plan.title).toContain('羽毛球');
    expect(plan.agenda.length).toBeGreaterThanOrEqual(3);
    expect(plan.safetyNotes.length).toBeGreaterThanOrEqual(1);

    const manifest = await json<{ protocol: string; policies: { dryRun: boolean; approvalRequiredFor: string[] } }>(
      `${backend.baseUrl}/agent/manifest`,
    );
    expect(manifest.protocol).toBe('typed-tools-v1');
    expect(manifest.policies.dryRun).toBe(true);
    expect(manifest.policies.approvalRequiredFor).toContain('publish');

    const tools = await json<{ tools: unknown[] }>(`${backend.baseUrl}/agent/tools`);
    expect(tools.tools.length).toBeGreaterThan(10);
  });
}

test('both implementations enforce authentication and validation', async () => {
  for (const backend of backends) {
    const unauthorized = await fetch(`${backend.baseUrl}/feed`);
    expect(unauthorized.status).toBe(401);

    const invalid = await fetch(`${backend.baseUrl}/posts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body: '没有图片也没有申请 AI', mediaIds: [], autoGenerateCover: false }),
    });
    expect([400, 422]).toContain(invalid.status);
  }
});
