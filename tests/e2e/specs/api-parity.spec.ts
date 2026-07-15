import { expect, test } from '@playwright/test';

const backends = [
  { name: 'TypeScript', baseUrl: 'http://127.0.0.1:3100/v1', implementation: 'ts' },
  { name: 'Python', baseUrl: 'http://127.0.0.1:8100/v1', implementation: 'python' },
] as const;

const headers = {
  Authorization: 'Bearer demo-user',
  'content-type': 'application/json',
};
const authHeaders = { Authorization: 'Bearer demo-user' };

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

  test(`${backend.name} persists silent blocks and enforces them across product surfaces`, async () => {
    const conversations = await json<{
      items: Array<{ id: string; type: string; peerUserId?: string | null }>;
    }>(`${backend.baseUrl}/conversations`);
    const direct = conversations.items.find((item) => item.type === 'direct' && item.peerUserId);
    expect(direct).toBeTruthy();
    const peerUserId = direct!.peerUserId!;

    await fetch(`${backend.baseUrl}/users/${peerUserId}/block`, { method: 'DELETE', headers: authHeaders });
    try {
      const before = await json<{ items: Array<{ title: string }> }>(`${backend.baseUrl}/feed`);
      expect(before.items.some((item) => item.title.includes('林夏') || item.title.includes('Citywalk'))).toBe(true);

      const result = await json<{ accepted: boolean; mode: string; notified: boolean }>(
        `${backend.baseUrl}/users/${peerUserId}/block`,
        {
          method: 'POST',
          body: JSON.stringify({ mode: 'silent', reason_code: 'e2e_safety_test' }),
        },
      );
      expect(result).toMatchObject({ accepted: true, mode: 'silent', notified: false });

      const blocks = await json<{ items: Array<{ id: string; mode: string }> }>(`${backend.baseUrl}/me/blocks`);
      expect(blocks.items).toContainEqual(expect.objectContaining({ id: peerUserId, mode: 'silent' }));

      const blockedMessage = await fetch(`${backend.baseUrl}/conversations/${direct!.id}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: '这条消息必须被服务端拦截', clientMessageId: `blocked-${Date.now()}` }),
      });
      expect(blockedMessage.status).toBe(409);

      const feed = await json<{ items: Array<{ title: string }> }>(`${backend.baseUrl}/feed`);
      expect(feed.items.some((item) => item.title.includes('林夏') || item.title.includes('Citywalk'))).toBe(false);

      const candidates = await json<{ items: Array<{ id: string }> }>(`${backend.baseUrl}/matching/candidates`);
      expect(candidates.items.some((item) => item.id === peerUserId)).toBe(false);
    } finally {
      const response = await fetch(`${backend.baseUrl}/users/${peerUserId}/block`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      expect(response.status).toBe(204);
    }

    const restored = await json<{ items: Array<{ title: string }> }>(`${backend.baseUrl}/feed`);
    expect(restored.items.some((item) => item.title.includes('林夏') || item.title.includes('Citywalk'))).toBe(true);
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
