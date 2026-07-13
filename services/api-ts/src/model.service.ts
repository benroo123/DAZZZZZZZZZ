import { BadGatewayException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { config } from './config';
import { InfraService } from './infra.service';

export interface ActivityPlan {
  title: string;
  summary: string;
  agenda: Array<{ time: string; item: string }>;
  suggestedTags: string[];
  safetyNotes: string[];
  generatedBy: { provider: string; model: string; localFallback: boolean };
}

@Injectable()
export class ModelService {
  constructor(@Inject(InfraService) private readonly infra: InfraService) {}

  async planActivity(input: {
    prompt: string;
    cityCode: string;
    participantTarget: number;
    userId: string;
    correlationId?: string;
  }): Promise<ActivityPlan> {
    const started = performance.now();
    let plan: ActivityPlan;
    let status = 'succeeded';
    try {
      plan = config.model.baseUrl
        ? await this.callCompatibleModel(input)
        : this.localPlan(input.prompt, input.participantTarget);
    } catch (error) {
      status = 'failed';
      await this.record(input, status, started);
      throw new BadGatewayException(`Model gateway failed: ${(error as Error).message}`);
    }
    await this.record(input, status, started);
    return plan;
  }

  private localPlan(prompt: string, participants: number): ActivityPlan {
    const subject = prompt.replace(/[。！？].*$/u, '').slice(0, 24) || '一起出发';
    return {
      title: subject,
      summary: `为 ${participants} 人生成的活动方案：${prompt}`,
      agenda: [
        { time: '00:00', item: '集合、实名成员确认与安全说明' },
        { time: '00:15', item: '破冰和活动分组' },
        { time: '00:30', item: '开始主要活动' },
        { time: '02:00', item: '合照、评价和下次组局建议' },
      ],
      suggestedTags: ['同城', '新手友好', participants <= 6 ? '小组活动' : '多人活动'],
      safetyNotes: ['公开页面只展示模糊集合点', '活动开始前向已批准成员开放精确位置'],
      generatedBy: {
        provider: config.model.provider,
        model: config.model.name,
        localFallback: true,
      },
    };
  }

  private async callCompatibleModel(input: {
    prompt: string;
    participantTarget: number;
  }): Promise<ActivityPlan> {
    const response = await fetch(`${config.model.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.model.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model.name,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Return JSON with title, summary, agenda, suggestedTags and safetyNotes for a safe mainland China social activity.',
          },
          {
            role: 'user',
            content: `${input.participantTarget} participants. ${input.prompt}`,
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as any;
    const parsed = JSON.parse(payload.choices[0].message.content);
    return {
      ...parsed,
      generatedBy: {
        provider: config.model.provider,
        model: config.model.name,
        localFallback: false,
      },
    };
  }

  private async record(
    input: { prompt: string; userId: string; correlationId?: string },
    status: string,
    started: number,
  ): Promise<void> {
    const promptHash = createHash('sha256').update(input.prompt).digest('hex');
    await this.infra.pool.query(
      `insert into app.model_invocations
       (id, user_id, capability, provider, model, prompt_hash, status, latency_ms, correlation_id)
       values ($1, $2, 'activity_plan', $3, $4, $5, $6, $7, $8)`,
      [
        randomUUID(),
        input.userId,
        config.model.provider,
        config.model.name,
        promptHash,
        status,
        Math.round(performance.now() - started),
        input.correlationId ?? null,
      ],
    );
  }
}
