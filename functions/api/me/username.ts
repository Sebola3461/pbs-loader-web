import { Env } from '../../../server/db';
import { runRoute } from '../../../server/http';
import { defaultDeps, putUsername } from '../../../server/routes';

export const onRequestPut: PagesFunction<Env> = ({ request, env }) =>
  runRoute('PUT /api/me/username', request, () => putUsername(request, env, defaultDeps));
