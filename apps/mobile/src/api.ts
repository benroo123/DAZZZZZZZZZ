export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3100/v1'
).replace(/\/$/, '');

export type FeedItem = {
  id: string;
  entityType: 'activity' | 'post' | 'user' | 'place';
  title?: string;
  body?: string;
  category?: string;
  startsAt?: string;
  venueName?: string;
  distanceKm?: number;
  participants?: { approved: number; max: number };
  author?: { displayName: string; realNameVerified: boolean };
  imageUrl?: string | null;
  displayName?: string;
  publicId?: string;
};

export type Candidate = {
  id: string;
  publicId: string;
  displayName: string;
  age: number;
  bio: string;
  occupation?: string;
  personalityLabel?: string;
  realNameVerified: boolean;
  interests: string[];
  imageUrl?: string | null;
};

export type Profile = {
  id: string;
  publicId: string;
  displayName: string;
  age: number;
  bio: string;
  occupation: string;
  personalityLabel: string;
  realNameStatus: string;
  completionPercent: number;
  attendanceRate: number;
  rating: number;
  followingCount: number;
  followerCount: number;
  extraAttributes?: { interests?: string[] };
};

export type Conversation = {
  id: string;
  type: string;
  title: string;
  lastMessage?: string;
  lastMessageAt?: string;
};

export type Message = {
  id: string;
  senderId?: string;
  type: string;
  text: string;
  createdAt: string;
};

type RequestOptions = RequestInit & { idempotencyKey?: string };

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { idempotencyKey, ...init } = options;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: 'Bearer demo-user',
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({ message: response.statusText }));
  if (!response.ok) {
    throw new Error(payload.message ?? payload.detail ?? `API ${response.status}`);
  }
  return payload as T;
}

export const api = {
  config: () => request<{ implementation: string; themes: Record<string, unknown> }>('/system/config'),
  feed: (mode: 'recommended' | 'city') =>
    request<{ items: FeedItem[] }>(`/feed?mode=${mode}&cityCode=310100`),
  search: (query: string) =>
    request<{ items: FeedItem[] }>(
      `/search?q=${encodeURIComponent(query)}&types=activity,post,user,place`,
    ),
  nearby: (filters: { category?: string; people: number }) => {
    const params = new URLSearchParams({ cityCode: '310100', participantMax: String(filters.people) });
    if (filters.category && filters.category !== '全部') params.set('categories', filters.category);
    return request<{ items: FeedItem[] }>(`/activities/nearby?${params}`);
  },
  candidates: () => request<{ items: Candidate[] }>('/matching/candidates'),
  swipe: (targetUserId: string, decision: 'pass' | 'like' | 'super_like') =>
    request<{ matched: boolean }>('/matching/swipes', {
      method: 'POST',
      body: JSON.stringify({ targetUserId, decision }),
    }),
  profile: () => request<Profile>('/me/profile'),
  updateProfile: (payload: Partial<Profile>) =>
    request<Profile>('/me/profile', { method: 'PATCH', body: JSON.stringify(payload) }),
  conversations: () =>
    request<{ items: Conversation[]; social: { following: number; followers: number } }>(
      '/conversations',
    ),
  messages: (conversationId: string) =>
    request<{ items: Message[] }>(`/conversations/${conversationId}/messages`),
  sendMessage: (conversationId: string, text: string) =>
    request<Message>(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text, clientMessageId: `mobile-${Date.now()}-${Math.random()}` }),
    }),
  plan: (prompt: string, participantTarget: number) =>
    request<{
      title: string;
      summary: string;
      agenda: Array<{ time: string; item: string }>;
      suggestedTags: string[];
      safetyNotes: string[];
    }>('/ai/plan', {
      method: 'POST',
      body: JSON.stringify({ prompt, cityCode: '310100', participantTarget }),
    }),
  createPost: (body: string) =>
    request<{ id: string; status: string; aiJobId?: string }>('/posts', {
      method: 'POST',
      idempotencyKey: `mobile-post-${Date.now()}-${Math.random()}`,
      body: JSON.stringify({ body, cityCode: '310100', mediaIds: [], autoGenerateCover: true }),
    }),
  publishPost: (id: string) =>
    request<{ id: string; status: string }>(`/posts/${id}/publish`, { method: 'POST' }),
  post: (id: string) =>
    request<{ id: string; status: string; moderationStatus: string; mediaIds: string[] }>(
      `/posts/${id}`,
    ),
  createActivity: (payload: Record<string, unknown>) =>
    request<{ id: string; status: string; aiJobId?: string }>('/activities', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  publishActivity: (id: string) =>
    request<{ id: string; status: string }>(`/activities/${id}/publish`, { method: 'POST' }),
};

export async function waitForPublished(postId: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const post = await api.post(postId);
    if (post.status === 'published' && post.mediaIds.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error('发布处理超时，请稍后在动态中查看');
}
