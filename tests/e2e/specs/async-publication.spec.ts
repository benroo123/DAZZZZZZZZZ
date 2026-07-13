import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const backends = [
  { name: 'TypeScript', baseUrl: 'http://127.0.0.1:3100/v1' },
  { name: 'Python', baseUrl: 'http://127.0.0.1:8100/v1' },
] as const;
const headers = { Authorization: 'Bearer demo-user' };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json();
  expect(response.ok, `${response.status}: ${JSON.stringify(payload)}`).toBeTruthy();
  return payload as T;
}

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 20_000;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    value = await read();
  }
  expect(done(value)).toBe(true);
  return value;
}

for (const backend of backends) {
  test(`${backend.name} completes AI-cover publication through MQ worker`, async () => {
    const body = `E2E ${backend.name} AI 自动配图 ${randomUUID()}`;
    const key = `e2e-${randomUUID()}`;
    const draft = await api<{ id: string; status: string }>(`${backend.baseUrl}/posts`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ body, cityCode: '310100', mediaIds: [], autoGenerateCover: true }),
    });
    const sameDraft = await api<{ id: string }>(`${backend.baseUrl}/posts`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ body, cityCode: '310100', mediaIds: [], autoGenerateCover: true }),
    });
    expect(sameDraft.id).toBe(draft.id);

    const accepted = await api<{ status: string }>(`${backend.baseUrl}/posts/${draft.id}/publish`, {
      method: 'POST',
    });
    expect(['pending_review', 'published']).toContain(accepted.status);

    const published = await eventually(
      () => api<{ status: string; moderationStatus: string; mediaIds: string[] }>(`${backend.baseUrl}/posts/${draft.id}`),
      (post) => post.status === 'published' && post.mediaIds.length === 1,
    );
    expect(published.moderationStatus).toBe('approved');
  });

  test(`${backend.name} handles direct object upload asynchronously`, async () => {
    const bytes = new TextEncoder().encode(`fake-png-${backend.name}-${randomUUID()}`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const upload = await api<{ uploadId: string; mediaId: string; uploadUrl: string }>(
      `${backend.baseUrl}/media/uploads`,
      {
        method: 'POST',
        body: JSON.stringify({
          filename: 'e2e.png',
          contentType: 'image/png',
          byteSize: bytes.length,
          sha256,
          purpose: 'post',
        }),
      },
    );
    const put = await fetch(upload.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: bytes,
    });
    expect(put.ok).toBe(true);
    await api(`${backend.baseUrl}/media/uploads/${upload.uploadId}/complete`, { method: 'POST' });
    const media = await eventually(
      () => api<{ moderationStatus: string; url: string }>(`${backend.baseUrl}/media/${upload.mediaId}`),
      (asset) => asset.moderationStatus === 'approved',
    );
    expect(media.url).toContain('127.0.0.1:9000');
  });
}
