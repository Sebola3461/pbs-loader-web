import { Env } from '../../server/db';
import { runRoute } from '../../server/http';
import { getStats } from '../../server/routes';

export const onRequestGet: PagesFunction<Env> = ({ request, env }) =>
  runRoute('GET /api/stats', request, () => getStats(request, env));
