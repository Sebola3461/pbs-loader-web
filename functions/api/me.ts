import { Env } from '../../server/db';
import { runRoute } from '../../server/http';
import { defaultDeps, getMe } from '../../server/routes';

export const onRequestGet: PagesFunction<Env> = ({ request, env }) =>
  runRoute('GET /api/me', request, () => getMe(request, env, defaultDeps));
