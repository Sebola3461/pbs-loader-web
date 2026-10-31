import { Env } from '../../../server/db';
import { runRoute } from '../../../server/http';
import { defaultDeps, putNickname } from '../../../server/routes';

export const onRequestPut: PagesFunction<Env> = ({ request, env }) =>
  runRoute('PUT /api/me/nickname', request, () => putNickname(request, env, defaultDeps));
