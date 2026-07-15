import { describe, expect, it } from 'vitest';
import { activityInput, postInput } from './domain';

describe('publishing domain validation', () => {
  it('requires media or AI cover generation', () => {
    expect(postInput.safeParse({ body: 'hello' }).success).toBe(false);
    expect(postInput.safeParse({ body: 'hello', autoGenerateCover: true }).success).toBe(true);
  });

  it('enforces the 2 to 50 activity boundary', () => {
    const base = {
      title: '周末活动',
      description: '一起活动',
      category: '运动',
      startsAt: '2027-01-01T10:00:00.000Z',
      endsAt: '2027-01-01T12:00:00.000Z',
      autoGenerateCover: true,
    };
    expect(activityInput.safeParse({ ...base, minParticipants: 2, maxParticipants: 50 }).success).toBe(true);
    expect(activityInput.safeParse({ ...base, minParticipants: 1, maxParticipants: 5 }).success).toBe(false);
    expect(activityInput.safeParse({ ...base, minParticipants: 8, maxParticipants: 4 }).success).toBe(false);
  });
});
