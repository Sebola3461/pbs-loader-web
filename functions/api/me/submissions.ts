import { Env } from '../../../server/db';
import { runRoute } from '../../../server/http';
import { defaultDeps, getMySubmissions } from '../../../server/routes';

export const onRequestGet: PagesFunction<Env> = ({ request, env }) =>
  runRoute('GET /api/me/submissions', request, () => getMySubmissions(request, env, defaultDeps));
