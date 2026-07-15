import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ZodType } from 'zod';
import { AppService } from './app.service';
import { Public } from './auth.guard';
import {
  activityInput,
  mediaUploadInput,
  messageInput,
  planInput,
  postInput,
  swipeInput,
} from './domain';
import { ModelService } from './model.service';

@Controller()
export class AppController {
  constructor(
    @Inject(AppService) private readonly service: AppService,
    @Inject(ModelService) private readonly model: ModelService,
  ) {}

  @Public()
  @Get('system/health')
  health() {
    return this.service.health();
  }

  @Public()
  @Get('system/config')
  config() {
    return this.service.getConfig();
  }

  @Public()
  @Header('content-type', 'text/plain; version=0.0.4')
  @Get('metrics')
  metrics() {
    return this.service.metrics();
  }

  @Get('feed')
  feed(@Req() request: any, @Query('mode') mode?: string, @Query('cityCode') cityCode?: string) {
    return this.service.feed(request.userId, mode, cityCode);
  }

  @Get('search')
  search(@Req() request: any, @Query('q') q?: string, @Query('types') types?: string) {
    if (!q?.trim()) throw new BadRequestException('q is required');
    return this.service.search(request.userId, q, types);
  }

  @Get('activities/nearby')
  nearby(@Req() request: any, @Query() filters: Record<string, unknown>) {
    return this.service.nearbyActivities(request.userId, filters);
  }

  @Get('me/profile')
  profile(@Req() request: any) {
    return this.service.profile(request.userId);
  }

  @Patch('me/profile')
  updateProfile(@Req() request: any, @Body() body: Record<string, unknown>) {
    return this.service.updateProfile(request.userId, body);
  }

  @Get('matching/candidates')
  matchingCandidates(@Req() request: any) {
    return this.service.matchingCandidates(request.userId);
  }

  @Post('matching/swipes')
  swipe(@Req() request: any, @Body() body: unknown) {
    const input = this.parse(swipeInput, body);
    return this.service.swipe(request.userId, input.targetUserId, input.decision);
  }

  @Get('conversations')
  conversations(@Req() request: any) {
    return this.service.conversations(request.userId);
  }

  @Post('users/:userId/block')
  blockUser(
    @Req() request: any,
    @Param('userId') userId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const mode = body.mode === 'silent' ? 'silent' : 'standard';
    const reasonCode = body.reason_code ?? body.reasonCode;
    return this.service.blockUser(request.userId, userId, mode, reasonCode ? String(reasonCode) : null);
  }

  @HttpCode(204)
  @Delete('users/:userId/block')
  async unblockUser(@Req() request: any, @Param('userId') userId: string) {
    await this.service.unblockUser(request.userId, userId);
  }

  @Get('me/blocks')
  blocks(@Req() request: any) {
    return this.service.blocks(request.userId);
  }

  @Get('conversations/:conversationId/messages')
  messages(@Req() request: any, @Param('conversationId') conversationId: string) {
    return this.service.messages(request.userId, conversationId);
  }

  @Post('conversations/:conversationId/messages')
  sendMessage(
    @Req() request: any,
    @Param('conversationId') conversationId: string,
    @Body() body: unknown,
  ) {
    const input = this.parse(messageInput, body);
    return this.service.sendMessage(request.userId, conversationId, input.text, input.clientMessageId);
  }

  @Post('media/uploads')
  createMediaUpload(@Req() request: any, @Body() body: unknown) {
    return this.service.createMediaUpload(request.userId, this.parse(mediaUploadInput, body));
  }

  @HttpCode(202)
  @Post('media/uploads/:uploadId/complete')
  completeMediaUpload(@Req() request: any, @Param('uploadId') uploadId: string) {
    return this.service.completeMediaUpload(request.userId, uploadId);
  }

  @Get('media/:mediaId')
  media(@Param('mediaId') mediaId: string) {
    return this.service.media(mediaId);
  }

  @Post('posts')
  createPost(
    @Req() request: any,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.service.createPost(request.userId, this.parse(postInput, body), idempotencyKey);
  }

  @Get('posts/:postId')
  getPost(@Param('postId') postId: string) {
    return this.service.getPost(postId);
  }

  @HttpCode(202)
  @Post('posts/:postId/publish')
  publishPost(@Req() request: any, @Param('postId') postId: string) {
    return this.service.publishPost(request.userId, postId);
  }

  @Post('activities')
  createActivity(@Req() request: any, @Body() body: unknown) {
    return this.service.createActivity(request.userId, this.parse(activityInput, body));
  }

  @HttpCode(202)
  @Post('activities/:activityId/publish')
  publishActivity(@Req() request: any, @Param('activityId') activityId: string) {
    return this.service.publishActivity(request.userId, activityId);
  }

  @Post('activities/:activityId/join')
  joinActivity(@Req() request: any, @Param('activityId') activityId: string) {
    return this.service.joinActivity(request.userId, activityId);
  }

  @Post('ai/plan')
  planActivity(@Req() request: any, @Body() body: unknown) {
    const input = this.parse(planInput, body);
    return this.model.planActivity({
      ...input,
      userId: request.userId,
      correlationId: request.correlationId,
    });
  }

  @HttpCode(202)
  @Post('ai/generations')
  createAiGeneration(@Req() request: any, @Body() body: Record<string, unknown>) {
    if (!body.prompt || !body.purpose) throw new BadRequestException('purpose and prompt are required');
    return this.service.createAiGeneration(request.userId, String(body.purpose), String(body.prompt));
  }

  @Get('ai/generations/:jobId')
  aiGeneration(@Param('jobId') jobId: string) {
    return this.service.aiGeneration(jobId);
  }

  @Get('agent/manifest')
  agentManifest() {
    return this.service.agentManifest();
  }

  @Get('agent/tools')
  agentTools() {
    return this.service.agentTools();
  }

  private parse<T>(schema: ZodType<T>, body: unknown): T {
    const result = schema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    return result.data;
  }
}
