import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthUser, CurrentUser, Public } from '../common/auth-user';
import { SESSION_COOKIE } from '../common/guards';
import { OtpRequestDto, OtpVerifyDto, RegisterDto } from './auth.dto';
import { AuthService } from './auth.service';

function setSession(res: Response, token: string, ttlSeconds: number) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ttlSeconds * 1000,
  });
}

@ApiTags('M1 · Identité')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('otp/request')
  @HttpCode(200)
  request(@Body() dto: OtpRequestDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(200)
  async verify(@Body() dto: OtpVerifyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const s = await this.auth.verifyOtp(dto.phone, dto.code, req.ip);
    setSession(res, s.token, s.ttlSeconds);
    return s.user;
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('register')
  @HttpCode(200)
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Get('demo')
  personas() {
    return this.auth.listPersonas();
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('demo/:persona')
  @HttpCode(200)
  async demo(@Param('persona') persona: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const s = await this.auth.demoLogin(persona, req.ip);
    setSession(res, s.token, s.ttlSeconds);
    return s.user;
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }
}
