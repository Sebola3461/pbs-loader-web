import { Env } from '../../../server/db';
import { runRoute } from '../../../server/http';
import { defaultDeps, getMyRatings } from '../../../server/routes';

export const onRequestGet: PagesFunction<Env> = ({ request, env }) =>
  runRoute('GET /api/me/ratings', request, () => getMyRatings(request, env, defaultDeps));
