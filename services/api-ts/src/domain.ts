import { z } from 'zod';

export const postInput = z
  .object({
    body: z.string().trim().min(1).max(5000),
    cityCode: z.string().default('310100'),
    mediaIds: z.array(z.string().uuid()).max(9).default([]),
    autoGenerateCover: z.boolean().default(false),
  })
  .refine((value) => value.mediaIds.length > 0 || value.autoGenerateCover, {
    message: 'A media asset or autoGenerateCover=true is required',
  });

export const activityInput = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(1).max(5000),
  category: z.string().trim().min(1).max(60),
  minParticipants: z.number().int().min(2).max(50),
  maxParticipants: z.number().int().min(2).max(50),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  cityCode: z.string().default('310100'),
  districtCode: z.string().optional(),
  venueName: z.string().max(120).optional(),
  mediaIds: z.array(z.string().uuid()).max(9).default([]),
  autoGenerateCover: z.boolean().default(false),
}).superRefine((value, context) => {
  if (value.minParticipants > value.maxParticipants) {
    context.addIssue({ code: 'custom', message: 'minParticipants cannot exceed maxParticipants' });
  }
  if (Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
    context.addIssue({ code: 'custom', message: 'endsAt must be later than startsAt' });
  }
  if (value.mediaIds.length === 0 && !value.autoGenerateCover) {
    context.addIssue({ code: 'custom', message: 'A media asset or autoGenerateCover=true is required' });
  }
});

export const mediaUploadInput = z.object({
  filename: z.string().min(1).max(180),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']),
  byteSize: z.number().int().positive().max(200 * 1024 * 1024),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  purpose: z.enum(['profile', 'post', 'activity', 'message']).default('post'),
});

export const swipeInput = z.object({
  targetUserId: z.string().uuid(),
  decision: z.enum(['pass', 'like', 'super_like']),
});

export const messageInput = z.object({
  text: z.string().trim().min(1).max(2000),
  clientMessageId: z.string().min(1).max(80),
});

export const planInput = z.object({
  prompt: z.string().trim().min(3).max(2000),
  cityCode: z.string().default('310100'),
  participantTarget: z.number().int().min(2).max(50).default(6),
});

export type PostInput = z.infer<typeof postInput>;
export type ActivityInput = z.infer<typeof activityInput>;
