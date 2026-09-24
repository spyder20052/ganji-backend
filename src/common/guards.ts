import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@prisma/client';
import { AuthUser, IS_PUBLIC, ROLES } from './auth-user';

export const SESSION_COOKIE = 'ganji_session';

/** Garde globale : session obligatoire sauf routes @Public(), puis contrôle de rôle @Roles(). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const token: string | undefined = req.cookies?.[SESSION_COOKIE];

    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<AuthUser & { sub: string }>(token);
        req.user = { ...payload, id: payload.sub } satisfies AuthUser;
      } catch {
        if (!isPublic) throw new UnauthorizedException('Session expirée, reconnectez-vous');
      }
    }
    if (isPublic) return true;
    if (!req.user) throw new UnauthorizedException('Connexion requise');

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !roles.includes(req.user.role)) {
      throw new ForbiddenException("Votre profil n'a pas accès à cette fonction");
    }
    return true;
  }
}
