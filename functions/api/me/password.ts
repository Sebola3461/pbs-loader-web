import { Env } from '../../../server/db';
import { runRoute } from '../../../server/http';
import { defaultDeps, putPassword } from '../../../server/routes';

export const onRequestPut: PagesFunction<Env> = ({ request, env }) =>
  runRoute('PUT /api/me/password', request, () => putPassword(request, env, defaultDeps));
